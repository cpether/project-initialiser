const fs = require('fs');
const path = require('path');
const picker = require('./picker');
const writers = require('./writers');
const wizard = require('./wizard');
const manifest = require('./manifest');

function bold(s) { return `\x1b[1m${s}\x1b[22m`; }
function dim(s) { return `\x1b[2m${s}\x1b[22m`; }
function green(s) { return `\x1b[32m${s}\x1b[39m`; }

function selfPath() { return fs.realpathSync(__filename.replace('/lib/mcp-add.js', '/bin/claude-init')); }

function parseArgsString(s) {
  if (!s.trim()) return [];
  const tokens = [];
  let cur = '';
  let quote = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { tokens.push(cur); cur = ''; }
    } else cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function extractSecretEnvVars(envEntries) {
  // envEntries: [{key, value}] where value may be 'KEY' (assume secret-by-name) or 'literal'
  const secrets = [];
  const env = {};
  for (const { key, value } of envEntries) {
    if (value === '' || value === '@secret') secrets.push(key);
    else if (value.startsWith('${') && value.endsWith('}')) {
      const inner = value.slice(2, -1).split(':-')[0];
      if (inner === key) secrets.push(key); else env[key] = value;
    } else env[key] = value;
  }
  return { secrets, env };
}

async function runAdd({ root, isGit }) {
  console.log(bold('claude-init mcp add') + dim(' — interactive'));

  const name = await picker.input({
    message: 'Server name (used as the MCP identifier):',
    validate: (v) => /^[A-Za-z0-9_-]+$/.test(v) || 'use letters, numbers, _ or -',
  });

  const transport = await picker.select({
    message: 'Transport:',
    choices: [
      { name: 'stdio (local executable)', value: 'stdio' },
      { name: 'http (remote URL)', value: 'http' },
    ],
  });

  let mcpDef;
  let requiresSecrets = [];

  if (transport === 'stdio') {
    const command = await picker.input({
      message: 'Command (e.g. npx, node, /path/to/server):',
      validate: (v) => v.length > 0 || 'required',
    });
    const argsStr = await picker.input({
      message: 'Arguments (space-separated, quote things with spaces):',
      default: '',
    });
    const args = parseArgsString(argsStr);
    const envStr = await picker.input({
      message: 'Env vars (KEY=value, comma-separated; for a SECRET use just KEY):',
      default: '',
    });
    const envEntries = envStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const idx = entry.indexOf('=');
        if (idx < 0) return { key: entry, value: '' };
        return { key: entry.slice(0, idx).trim(), value: entry.slice(idx + 1).trim() };
      });
    const parsed = extractSecretEnvVars(envEntries);
    requiresSecrets = parsed.secrets;
    mcpDef = { command, args, env: parsed.env, requiredSecrets: requiresSecrets };
  } else {
    const url = await picker.input({
      message: 'URL:',
      validate: (v) => /^https?:\/\//.test(v) || 'must start with http:// or https://',
    });
    mcpDef = { type: 'http', url };
  }

  const scope = await picker.select({
    message: 'Scope:',
    choices: [
      { name: 'User (everywhere on your machine)', value: 'user' },
      { name: 'Project (.mcp.json — committable, shared with team)', value: 'project' },
      { name: 'Local (this repo only, your machine only)', value: 'local' },
    ],
  });

  // Configure secrets BEFORE writing the MCP entry so the wrapper resolves them
  if (requiresSecrets.length > 0) {
    const projData = manifest.read(root) || { version: 1, mcps: [], skills: [], secrets: {} };
    for (const secretName of requiresSecrets) {
      await wizard.configureSecret(secretName, root, projData);
    }
    manifest.write(root, projData);
  }

  if (scope === 'project') {
    writers.writeProjectMcpJson(root, [{ name, ...mcpDef }]);
    if (isGit) {
      writers.addToGitignore(root, '.claude/.project-initialiser.json', 'claude-init manifest (per-user secret refs, no values)');
      writers.addToGitignore(root, '.claude/settings.local.json', 'Claude Code per-user settings (permissions allowlists, etc.)');
    }
    // Track in enabledMcpjsonServers so it's auto-approved
    writers.mergeSettingsJson(root, { enabledMcpjsonServers: [name] });
    console.log(green(`\nWrote .mcp.json with ${name}.`) + dim(' Teammates need claude-init on PATH.'));
  } else if (scope === 'user') {
    writers.writeUserMcpEntry(name, mcpDef, selfPath());
    console.log(green(`\nAdded ${name} at user scope.`) + dim(' Available in every project; secrets resolve per-project with user fallback.'));
  } else {
    writers.writeLocalMcpEntry(root, name, mcpDef, selfPath());
    console.log(green(`\nAdded ${name} at local scope for ${root}.`));
  }
  console.log(dim('Restart Claude Code in this directory to pick up the new MCP.'));
}

module.exports = { runAdd };
