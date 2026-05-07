const fs = require('fs');
const path = require('path');
const os = require('os');
const writers = require('./writers');
const migrate = require('./migrate');

function selfPath() {
  return fs.realpathSync(path.resolve(__dirname, '..', 'bin', 'claude-init'));
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function getClaudeJsonPath() { return path.join(os.homedir(), '.claude.json'); }

function locateEntry(repoRoot, name) {
  const claudeJson = readJsonSafe(getClaudeJsonPath()) || {};
  if (claudeJson.projects && claudeJson.projects[repoRoot] && claudeJson.projects[repoRoot].mcpServers
      && claudeJson.projects[repoRoot].mcpServers[name]) {
    return { scope: 'local', cfg: claudeJson.projects[repoRoot].mcpServers[name] };
  }
  const projCfg = writers.readProjectServer(repoRoot, name);
  if (projCfg) return { scope: 'project', cfg: projCfg };
  if (claudeJson.mcpServers && claudeJson.mcpServers[name]) {
    return { scope: 'user', cfg: claudeJson.mcpServers[name] };
  }
  return null;
}

function listAllByScope(repoRoot) {
  const claudeJson = readJsonSafe(getClaudeJsonPath()) || {};
  const projData = readJsonSafe(path.join(repoRoot, '.mcp.json')) || {};
  const out = [];
  for (const n of Object.keys(projData.mcpServers || {})) out.push({ name: n, scope: 'project' });
  for (const n of Object.keys(claudeJson.mcpServers || {})) out.push({ name: n, scope: 'user' });
  const local = (claudeJson.projects && claudeJson.projects[repoRoot] && claudeJson.projects[repoRoot].mcpServers) || {};
  for (const n of Object.keys(local)) out.push({ name: n, scope: 'local' });
  return out;
}

function adjustWrapperPath(cfg, targetScope) {
  if (!migrate.isClaudeInitWrapped(cfg)) return cfg;
  const desired = targetScope === 'project' ? 'claude-init' : selfPath();
  return { ...cfg, command: desired };
}

function targetHasName(repoRoot, scope, name) {
  if (scope === 'project') return !!writers.readProjectServer(repoRoot, name);
  const claudeJson = readJsonSafe(getClaudeJsonPath()) || {};
  if (scope === 'user') return !!(claudeJson.mcpServers && claudeJson.mcpServers[name]);
  if (scope === 'local') {
    const local = (claudeJson.projects && claudeJson.projects[repoRoot] && claudeJson.projects[repoRoot].mcpServers) || {};
    return !!local[name];
  }
  return false;
}

function removeFromScope(repoRoot, scope, name) {
  if (scope === 'project') { writers.removeFromProjectMcpJson(repoRoot, [name]); return; }
  const p = getClaudeJsonPath();
  const data = readJsonSafe(p);
  if (!data) throw new Error(`cannot read ${p}`);
  if (scope === 'user' && data.mcpServers) delete data.mcpServers[name];
  if (scope === 'local' && data.projects && data.projects[repoRoot] && data.projects[repoRoot].mcpServers) {
    delete data.projects[repoRoot].mcpServers[name];
  }
  writeJson(p, data);
}

function writeToScope(repoRoot, scope, name, cfg) {
  if (scope === 'project') {
    const target = path.join(repoRoot, '.mcp.json');
    const existing = readJsonSafe(target) || {};
    existing.mcpServers = existing.mcpServers || {};
    existing.mcpServers[name] = cfg;
    writeJson(target, existing);
    return;
  }
  const p = getClaudeJsonPath();
  const data = readJsonSafe(p);
  if (!data) throw new Error(`cannot read ${p}`);
  if (scope === 'user') {
    data.mcpServers = data.mcpServers || {};
    data.mcpServers[name] = cfg;
  } else if (scope === 'local') {
    data.projects = data.projects || {};
    data.projects[repoRoot] = data.projects[repoRoot] || {};
    data.projects[repoRoot].mcpServers = data.projects[repoRoot].mcpServers || {};
    data.projects[repoRoot].mcpServers[name] = cfg;
  }
  writeJson(p, data);
}

function move(repoRoot, name, toScope) {
  const valid = ['user', 'project', 'local'];
  if (!valid.includes(toScope)) throw new Error(`unknown scope: ${toScope}`);
  const located = locateEntry(repoRoot, name);
  if (!located) throw new Error(`MCP "${name}" not found in any scope for ${repoRoot}`);
  if (located.scope === toScope) throw new Error(`"${name}" is already in ${toScope} scope`);
  if (targetHasName(repoRoot, toScope, name)) {
    throw new Error(`${toScope} scope already has "${name}" — resolve manually first`);
  }
  const adjusted = adjustWrapperPath(located.cfg, toScope);
  writeToScope(repoRoot, toScope, name, adjusted);
  removeFromScope(repoRoot, located.scope, name);
  return { from: located.scope, to: toScope };
}

module.exports = { locateEntry, listAllByScope, move };
