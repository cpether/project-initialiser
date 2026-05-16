const discover = require('./discover');
const manifest = require('./manifest');
const projectState = require('./project-state');
const picker = require('./picker');

// claude.ai connectors are intentionally excluded: `claude mcp list` can make
// HTTP calls and we don't want to slow down every `cc` invocation.
const SCOPES = ['user', 'plugin', 'local'];

function bold(s) { return `\x1b[1m${s}\x1b[22m`; }
function dim(s) { return `\x1b[2m${s}\x1b[22m`; }
function green(s) { return `\x1b[32m${s}\x1b[39m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[39m`; }

function snapshot(root) {
  return {
    user:   discover.discoverUserMcps().map((m) => m.name).sort(),
    plugin: discover.discoverPluginMcps().map((m) => m.name).sort(),
    local:  discover.discoverLocalMcps(root).map((m) => m.name).sort(),
  };
}

function emptyByScope() {
  const out = {};
  for (const s of SCOPES) out[s] = [];
  return out;
}

function detect(root, manifestData) {
  const baseline = snapshot(root);
  const known = manifestData && manifestData.known;
  if (!known) {
    return { isLegacy: true, baseline, newByScope: emptyByScope(), hasAny: false };
  }
  const newByScope = {};
  for (const scope of SCOPES) {
    const knownSet = new Set(known[scope] || []);
    newByScope[scope] = (baseline[scope] || []).filter((n) => !knownSet.has(n));
  }
  const hasAny = SCOPES.some((s) => newByScope[s].length > 0);
  return { isLegacy: false, baseline, newByScope, hasAny };
}

function recordKnown(manifestData, baseline) {
  manifestData.known = {
    user:   [...(baseline.user || [])].sort(),
    plugin: [...(baseline.plugin || [])].sort(),
    local:  [...(baseline.local || [])].sort(),
  };
  return manifestData;
}

function refreshKnown(root) {
  const data = manifest.read(root);
  if (!data) return false;
  recordKnown(data, snapshot(root));
  manifest.write(root, data);
  return true;
}

async function handleCheck(root, manifestData) {
  const result = detect(root, manifestData);
  if (result.isLegacy) {
    recordKnown(manifestData, result.baseline);
    manifest.write(root, manifestData);
    return { action: 'bootstrap' };
  }
  if (!result.hasAny) return { action: 'noop' };

  const entries = [];
  for (const scope of SCOPES) {
    for (const name of result.newByScope[scope]) entries.push({ scope, name });
  }

  const allDiscovered = discover.discoverMcps(root);
  const pluginByMcpName = new Map();
  for (const m of allDiscovered) {
    if (m.source === 'plugin') pluginByMcpName.set(m.name, m.pluginName);
  }

  console.log(`${bold('claude-init')}: ${entries.length} new MCP${entries.length > 1 ? 's' : ''} detected since last setup in ${root}.`);
  const choices = entries.map((e) => {
    const scopeLabel = e.scope === 'plugin' && pluginByMcpName.has(e.name)
      ? `plugin: ${pluginByMcpName.get(e.name)}`
      : e.scope;
    return {
      name: e.name,
      value: `${e.scope}|${e.name}`,
      checked: true,
      description: scopeLabel,
    };
  });

  let enabled;
  try {
    enabled = await picker.checkbox({
      message: 'Enable in this repo (uncheck to disable per-repo):',
      choices,
    });
  } catch {
    console.log(dim('No changes; will ask again next session.'));
    return { action: 'deferred' };
  }

  const save = await picker.confirm({
    message: 'Save these choices? (No = ask again next session)',
    default: true,
  }).catch(() => false);
  if (!save) {
    console.log(dim('No changes; will ask again next session.'));
    return { action: 'deferred' };
  }

  const enabledSet = new Set(enabled);
  const toDisableByScope = { user: [], plugin: [], local: [] };
  const toEnableByScope  = { user: [], plugin: [], local: [] };
  for (const e of entries) {
    const key = `${e.scope}|${e.name}`;
    if (enabledSet.has(key)) toEnableByScope[e.scope].push(e.name);
    else toDisableByScope[e.scope].push(e.name);
  }

  const sharedDisabledNames = [
    ...result.newByScope.user,
    ...result.newByScope.local,
  ];
  const sharedDisables = [
    ...toDisableByScope.user,
    ...toDisableByScope.local,
  ];
  if (sharedDisabledNames.length > 0) {
    projectState.setDisabledMcps(root, sharedDisabledNames, sharedDisables);
  }

  const pluginsToDisable = new Set();
  for (const mcpName of toDisableByScope.plugin) {
    const pluginId = pluginByMcpName.get(mcpName);
    if (pluginId) pluginsToDisable.add(pluginId);
  }
  for (const pluginId of pluginsToDisable) {
    projectState.setPluginState(root, pluginId, 'disable');
  }

  const enabledUserMcps = toEnableByScope.user;
  if (enabledUserMcps.length > 0) {
    manifestData.mcps = [...new Set([...(manifestData.mcps || []), ...enabledUserMcps])];
  }

  recordKnown(manifestData, result.baseline);
  manifest.write(root, manifestData);

  console.log(green('claude-init: choices saved.'));
  for (const e of entries) {
    const action = enabledSet.has(`${e.scope}|${e.name}`) ? green('enabled') : yellow('disabled');
    console.log(`  ${e.name} ${dim('[' + e.scope + ']')} ${action}`);
  }
  if (pluginsToDisable.size > 0) {
    console.log(dim(`  (plugin disable affects the whole plugin: ${[...pluginsToDisable].join(', ')})`));
  }
  return { action: 'saved', enabled: [...enabledSet], disabledPlugins: [...pluginsToDisable] };
}

module.exports = { snapshot, detect, recordKnown, refreshKnown, handleCheck, SCOPES };
