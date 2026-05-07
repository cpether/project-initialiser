const fs = require('fs');
const path = require('path');
const manifest = require('./manifest');
const userManifest = require('./user-manifest');
const discover = require('./discover');
const projectState = require('./project-state');
const writers = require('./writers');
const picker = require('./picker');
const secretsResolve = require('./secrets-resolve');
const migrate = require('./migrate');
const backends = {
  keychain: require('./backends/keychain'),
  op: require('./backends/op'),
};

function bold(s) { return `\x1b[1m${s}\x1b[22m`; }
function dim(s) { return `\x1b[2m${s}\x1b[22m`; }
function green(s) { return `\x1b[32m${s}\x1b[39m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[39m`; }
function red(s) { return `\x1b[31m${s}\x1b[39m`; }

async function configureSecret(secretName, repoRoot, projData) {
  const existing = secretsResolve.resolve(repoRoot, secretName);
  let scope;
  if (existing) {
    console.log('');
    const choice = await picker.select({
      message: `${bold(secretName)} is set at ${existing.scope} scope:`,
      choices: [
        { name: 'Use existing value', value: 'use' },
        { name: 'Override for this repo', value: 'override' },
        { name: 'Skip this secret', value: 'skip' },
      ],
    });
    if (choice === 'use' || choice === 'skip') return;
    scope = 'project';
  } else {
    console.log('');
    scope = await picker.select({
      message: `Where to store ${bold(secretName)}?`,
      choices: [
        { name: 'User scope (shared across all your projects)', value: 'user' },
        { name: 'Project scope (this repo only)', value: 'project' },
        { name: 'Skip', value: 'skip' },
      ],
    });
    if (scope === 'skip') return;
  }
  const backend = await picker.select({
    message: `Backend for ${secretName}:`,
    choices: [
      { name: 'macOS Keychain', value: 'keychain' },
      { name: '1Password (op://...)', value: 'op' },
    ],
  });
  let ref;
  let isolated = false;
  if (backend === 'keychain') {
    const value = await picker.password({ message: `Value for ${secretName}:` });
    if (!value) { console.log(dim(`  empty — skipped ${secretName}`)); return; }
    if (scope === 'project') {
      isolated = await picker.confirm({ message: 'Isolate this secret per-repo?', default: false });
    }
    ref = backends.keychain.set({ name: secretName, value, isolated, repoHash: manifest.repoHash(repoRoot) });
  } else {
    const opRef = await picker.input({
      message: `1Password reference for ${secretName}:`,
      validate: (v) => v.startsWith('op://') || 'must start with op://',
    });
    ref = backends.op.set({ name: secretName, opRef });
  }
  const entry = { ...ref, isolated: isolated || undefined };
  if (scope === 'project') {
    projData.secrets = projData.secrets || {};
    projData.secrets[secretName] = entry;
  } else {
    const ud = userManifest.load();
    ud.secrets = ud.secrets || {};
    ud.secrets[secretName] = entry;
    userManifest.write(ud);
  }
  console.log(green(`  stored ${secretName} (${scope}, ${backend})`));
}

async function pickProjectActions(projectMcps, root) {
  const settings = (() => {
    const p = path.join(root, '.claude', 'settings.json');
    if (!fs.existsSync(p)) return {};
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
  })();
  const enabledList = settings.enabledMcpjsonServers || [];
  const disabledList = settings.disabledMcpjsonServers || [];
  const explicitlyDisabled = new Set(disabledList);
  const explicitlyEnabled = new Set(enabledList);

  console.log('');
  const enabledNames = await picker.checkbox({
    message: `Project-scope MCPs in .mcp.json — enable per repo (unselect to disable):`,
    choices: projectMcps.map((m) => ({
      name: m.name,
      value: m.name,
      checked: !explicitlyDisabled.has(m.name),
      description: m.claudeInitWrapped
        ? 'wrapped via claude-init exec'
        : (m.requiredSecrets.length ? `uses ${m.requiredSecrets.join(', ')}` : ''),
    })),
  });

  const migrateCandidates = projectMcps
    .map((m) => {
      const cfg = writers.readProjectServer(root, m.name);
      const plan = migrate.planMigration(cfg || {});
      return { name: m.name, cfg, plan };
    })
    .filter((x) => x.plan.canMigrate);

  let toMigrate = [];
  if (migrateCandidates.length > 0) {
    console.log('');
    toMigrate = await picker.checkbox({
      message: `Migrate project entries to claude-init exec? (removes \${VAR} env coupling)`,
      hint: '↑/↓ move · space toggle · enter confirm · q skip · default: none',
      choices: migrateCandidates.map((x) => ({
        name: x.name,
        value: x.name,
        description: `secrets ${x.plan.secrets.join(', ')}${x.plan.argvWarnings.length ? ` · argv \${${x.plan.argvWarnings.join(', ${')}} also referenced` : ''}`,
      })),
    });
  }

  return {
    enabledNames,
    disabledNames: projectMcps.map((m) => m.name).filter((n) => !enabledNames.includes(n)),
    toMigrate,
    migrateCandidates,
  };
}

async function applyProjectMigrations(root, projectMcps, plan, projData) {
  if (plan.toMigrate.length === 0) return;
  for (const name of plan.toMigrate) {
    const candidate = plan.migrateCandidates.find((x) => x.name === name);
    if (!candidate) continue;
    console.log(yellow(`\nMigrating ${name} — configuring secrets…`));
    for (const secretName of candidate.plan.secrets) {
      await configureSecret(secretName, root, projData);
    }
    const newCfg = migrate.rewrap(candidate.cfg, candidate.plan, { execCommand: 'claude-init' });
    writers.writeProjectMcpJson(root, [{
      name,
      type: newCfg.type,
      command: newCfg.command,
      args: newCfg.args,
      env: newCfg.env,
      requiredSecrets: [],
    }]);
    if (candidate.plan.argvWarnings.length) {
      console.log(yellow(`  warning: argv references ${candidate.plan.argvWarnings.map(v=>'${'+v+'}').join(', ')} remain — Claude Code will expand from your shell env at parse time`));
    }
    console.log(green(`  migrated ${name}`));
  }
}

async function runInit({ root, isGit }) {
  console.log(bold('claude-init') + dim(' — ' + root + (isGit ? '' : ' (no git)')));

  const existing = manifest.read(root);
  if (existing) {
    const proceed = await picker.confirm({
      message: 'A claude-init manifest exists. Re-run the wizard?',
      default: true,
    });
    if (!proceed) { console.log(dim('No changes.')); return; }
  }

  console.log(dim('discovering MCPs and skills…'));
  const mcps = discover.discoverMcps(root);
  const skills = discover.discoverSkills();
  const state = projectState.getProjectState(root);

  const userMcps = mcps.filter((m) => m.source === 'user');
  const projectMcps = mcps.filter((m) => m.source === 'project');
  const claudeaiMcps = mcps.filter((m) => m.source === 'claudeai');
  const pluginGroups = {};
  for (const m of mcps.filter((x) => x.source === 'plugin')) {
    if (!pluginGroups[m.pluginName]) pluginGroups[m.pluginName] = [];
    pluginGroups[m.pluginName].push(m.name);
  }
  const pluginIds = Object.keys(pluginGroups);

  if (mcps.length === 0 && skills.length === 0) {
    console.log('Nothing to configure: no user/project MCPs, no plugins, no claude.ai connectors, no skills.');
    return;
  }

  // 1. user-scope MCPs to enable in this repo
  let selectedUserMcpNames = [];
  if (userMcps.length > 0) {
    const prevSet = new Set((existing && existing.mcps) || []);
    selectedUserMcpNames = await picker.checkbox({
      message: 'User-scope MCPs to enable in this repo:',
      choices: userMcps.map((m) => ({
        name: m.name,
        value: m.name,
        checked: prevSet.has(m.name),
        description: m.requiredSecrets.length ? `needs ${m.requiredSecrets.join(', ')}` : '',
      })),
    });
  }

  // 2. project-scope MCPs (.mcp.json) — enable/disable + optional ${VAR} migration
  let projectPlan = { enabledNames: [], disabledNames: [], toMigrate: [], migrateCandidates: [] };
  if (projectMcps.length > 0) {
    projectPlan = await pickProjectActions(projectMcps, root);
  }

  // Collision check: user-scope name collides with an existing project-scope entry
  const projectNames = new Set(projectMcps.map((m) => m.name));
  const collisions = selectedUserMcpNames.filter((n) => projectNames.has(n));
  if (collisions.length > 0) {
    console.log(red(`\nName collision: ${collisions.join(', ')} exists at both user and project scope.`));
    console.log(dim('Project takes precedence in Claude Code. Wrapping skipped to avoid overwriting the project entry.'));
    console.log(dim('Tip: `claude-init mcp move <name> --to user` (or vice versa) resolves it.'));
    selectedUserMcpNames = selectedUserMcpNames.filter((n) => !collisions.includes(n));
  }

  // 3. plugins (whole-plugin per-repo enable/disable)
  let pluginsToEnable = pluginIds;
  if (pluginIds.length > 0) {
    const currentlyDisabled = new Set(Object.entries(state.enabledPlugins).filter(([, v]) => v === false).map(([k]) => k));
    pluginsToEnable = await picker.checkbox({
      message: 'Plugins enabled in this repo (unselect to disable the WHOLE plugin per-repo):',
      choices: pluginIds.map((id) => ({
        name: id,
        value: id,
        checked: !currentlyDisabled.has(id),
        description: `provides MCP: ${pluginGroups[id].join(', ')}`,
      })),
    });
  }

  // 4. claude.ai connectors
  let claudeaiToEnable = claudeaiMcps.map((m) => m.name);
  if (claudeaiMcps.length > 0) {
    const currentlyDisabled = new Set(state.disabledMcpServers || []);
    claudeaiToEnable = await picker.checkbox({
      message: 'claude.ai connectors enabled in this repo (unselect to disable per-repo):',
      choices: claudeaiMcps.map((m) => ({
        name: m.name,
        value: m.name,
        checked: !currentlyDisabled.has(m.name),
      })),
    });
  }

  // 5. skills
  let selectedSkills = skills.map((s) => s.name);
  if (skills.length > 0) {
    const prev = existing && existing.skills;
    const prevSet = new Set(prev || skills.map((s) => s.name));
    selectedSkills = await picker.checkbox({
      message: 'Skills enabled in this repo (unselect to turn off per-repo):',
      choices: skills.map((s) => ({
        name: s.name,
        value: s.name,
        checked: prevSet.has(s.name),
        description: s.description ? s.description.slice(0, 80) : '',
      })),
    });
  }

  // 6. configure secrets for selected user-scope MCPs
  const projData = existing || { version: 1, mcps: [], skills: [], secrets: {} };
  projData.mcps = selectedUserMcpNames;
  projData.skills = selectedSkills;
  projData.secrets = projData.secrets || {};
  const selectedMcpObjs = userMcps.filter((m) => selectedUserMcpNames.includes(m.name));
  for (const mcp of selectedMcpObjs) {
    for (const secretName of mcp.requiredSecrets || []) {
      await configureSecret(secretName, root, projData);
    }
  }

  // 7. apply project migrations (mutates .mcp.json entries in place)
  await applyProjectMigrations(root, projectMcps, projectPlan, projData);

  // 8. write user-scope MCP wrapper into .mcp.json (only those not colliding)
  if (selectedMcpObjs.length > 0) writers.writeProjectMcpJson(root, selectedMcpObjs);

  // 10. plugins
  for (const id of pluginIds) {
    const wantEnabled = pluginsToEnable.includes(id);
    const isCurrentlyDisabled = state.enabledPlugins[id] === false;
    if (!wantEnabled && !isCurrentlyDisabled) projectState.setPluginState(root, id, 'disable');
    else if (wantEnabled && isCurrentlyDisabled) projectState.setPluginState(root, id, 'unset');
  }

  // 11. claude.ai
  if (claudeaiMcps.length > 0) {
    const allNames = claudeaiMcps.map((m) => m.name);
    const toDisable = allNames.filter((n) => !claudeaiToEnable.includes(n));
    projectState.setDisabledMcps(root, allNames, toDisable);
  }

  // 12. settings.json — enabledMcpjsonServers (user-scope wrappers + project enables) + skill overrides
  const allEnabledMcpJson = [...selectedUserMcpNames, ...projectPlan.enabledNames];
  const skillOverrides = {};
  const enabledSkillSet = new Set(selectedSkills);
  for (const s of skills) {
    if (!enabledSkillSet.has(s.name)) skillOverrides[s.name] = 'off';
    else skillOverrides[s.name] = null;
  }
  writers.mergeSettingsJson(root, {
    enabledMcpjsonServers: allEnabledMcpJson,
    skillOverrides,
  });

  // 12b. write disabledMcpjsonServers for project entries explicitly disabled
  if (projectPlan.disabledNames.length > 0) {
    const target = path.join(root, '.claude', 'settings.json');
    const data = (() => {
      try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return {}; }
    })();
    data.disabledMcpjsonServers = [...new Set([...(data.disabledMcpjsonServers || []), ...projectPlan.disabledNames])];
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  }

  // 13. .gitignore — never commit per-user files
  if (isGit) {
    writers.addToGitignore(root, '.claude/.project-initialiser.json', 'claude-init manifest (per-user secret refs, no values)');
    writers.addToGitignore(root, '.claude/settings.local.json', 'Claude Code per-user settings (permissions allowlists, etc.)');
  }

  // 14. manifest
  manifest.write(root, projData);

  // 15. summary
  const pluginsDisabled = pluginIds.filter((id) => !pluginsToEnable.includes(id));
  const claudeaiDisabled = claudeaiMcps.map((m) => m.name).filter((n) => !claudeaiToEnable.includes(n));
  const skillsOff = skills.map((s) => s.name).filter((n) => !selectedSkills.includes(n));
  console.log('\n' + bold('Summary'));
  console.log(`  root: ${root}${isGit ? '' : dim(' (no git)')}`);
  if (selectedUserMcpNames.length) console.log(`  ${green('user MCPs enabled:')} ${selectedUserMcpNames.join(', ')}`);
  if (projectPlan.enabledNames.length) console.log(`  ${green('project MCPs enabled:')} ${projectPlan.enabledNames.join(', ')}`);
  if (projectPlan.disabledNames.length) console.log(`  ${yellow('project MCPs disabled:')} ${projectPlan.disabledNames.join(', ')}`);
  if (projectPlan.toMigrate.length) console.log(`  ${green('migrated to claude-init:')} ${projectPlan.toMigrate.join(', ')}`);
  if (collisions.length) console.log(`  ${red('skipped (collision):')} ${collisions.join(', ')}`);
  if (pluginsDisabled.length) console.log(`  ${yellow('plugins disabled:')} ${pluginsDisabled.join(', ')} ${dim('(whole plugin)')}`);
  if (claudeaiDisabled.length) console.log(`  ${yellow('claude.ai disabled:')} ${claudeaiDisabled.join(', ')}`);
  if (selectedSkills.length) console.log(`  ${green('skills enabled:')} ${selectedSkills.join(', ')}`);
  if (skillsOff.length) console.log(`  ${dim('skills off:')} ${skillsOff.join(', ')}`);
  console.log(dim('\n  changes apply on next Claude Code launch in this directory.'));
}

module.exports = { runInit, configureSecret };
