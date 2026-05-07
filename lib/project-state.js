const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function projectSettingsPath(repoRoot) {
  return path.join(repoRoot, '.claude', 'settings.json');
}

function setDisabledMcps(repoRoot, candidates, disabled) {
  const data = readJsonSafe(CLAUDE_JSON);
  if (!data) throw new Error(`cannot read ${CLAUDE_JSON}`);
  data.projects = data.projects || {};
  data.projects[repoRoot] = data.projects[repoRoot] || {};
  const project = data.projects[repoRoot];
  const candidateSet = new Set(candidates);
  const preserved = (project.disabledMcpServers || []).filter((n) => !candidateSet.has(n));
  const next = [...new Set([...preserved, ...disabled])].sort();
  if (next.length === 0) delete project.disabledMcpServers;
  else project.disabledMcpServers = next;
  writeJson(CLAUDE_JSON, data);
  return next;
}

function setPluginState(repoRoot, pluginId, state) {
  const p = projectSettingsPath(repoRoot);
  const existed = fs.existsSync(p);
  const data = readJsonSafe(p) || {};
  data.enabledPlugins = data.enabledPlugins || {};
  if (state === 'enable') data.enabledPlugins[pluginId] = true;
  else if (state === 'disable') data.enabledPlugins[pluginId] = false;
  else if (state === 'unset') delete data.enabledPlugins[pluginId];
  else throw new Error(`unknown plugin state: ${state}`);
  if (Object.keys(data.enabledPlugins).length === 0) delete data.enabledPlugins;
  if (Object.keys(data).length === 0) {
    if (existed) fs.rmSync(p);
    return;
  }
  writeJson(p, data);
}

function getProjectState(repoRoot) {
  const claudeJson = readJsonSafe(CLAUDE_JSON) || {};
  const project = (claudeJson.projects || {})[repoRoot] || {};
  const settings = readJsonSafe(projectSettingsPath(repoRoot)) || {};
  return {
    disabledMcpServers: project.disabledMcpServers || [],
    enabledPlugins: settings.enabledPlugins || {},
  };
}

module.exports = { setDisabledMcps, setPluginState, getProjectState };
