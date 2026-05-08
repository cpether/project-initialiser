const fs = require('fs');
const path = require('path');
const os = require('os');
const jsonFile = require('./json-file');

const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

function projectSettingsPath(repoRoot) {
  return path.join(repoRoot, '.claude', 'settings.json');
}

function setDisabledMcps(repoRoot, candidates, disabled) {
  const data = jsonFile.readOr(CLAUDE_JSON, {});
  data.projects = data.projects || {};
  data.projects[repoRoot] = data.projects[repoRoot] || {};
  const project = data.projects[repoRoot];
  const candidateSet = new Set(candidates);
  const preserved = (project.disabledMcpServers || []).filter((n) => !candidateSet.has(n));
  const next = [...new Set([...preserved, ...disabled])].sort();
  if (next.length === 0) delete project.disabledMcpServers;
  else project.disabledMcpServers = next;
  jsonFile.write(CLAUDE_JSON, data);
  return next;
}

function setProjectMcpjsonState(repoRoot, candidates, enabled) {
  const p = projectSettingsPath(repoRoot);
  const existed = fs.existsSync(p);
  const data = jsonFile.readOr(p, {});
  const candidateSet = new Set(candidates);
  const enabledSet = new Set(enabled);
  const preservedEnabled = (data.enabledMcpjsonServers || []).filter((n) => !candidateSet.has(n));
  const preservedDisabled = (data.disabledMcpjsonServers || []).filter((n) => !candidateSet.has(n));
  const nextEnabled = [...new Set([...preservedEnabled, ...enabled])].sort();
  const nextDisabled = [...new Set([
    ...preservedDisabled,
    ...candidates.filter((n) => !enabledSet.has(n)),
  ])].sort();
  if (nextEnabled.length === 0) delete data.enabledMcpjsonServers;
  else data.enabledMcpjsonServers = nextEnabled;
  if (nextDisabled.length === 0) delete data.disabledMcpjsonServers;
  else data.disabledMcpjsonServers = nextDisabled;
  if (Object.keys(data).length === 0) {
    if (existed) fs.rmSync(p);
    return { enabledMcpjsonServers: [], disabledMcpjsonServers: [] };
  }
  jsonFile.write(p, data);
  return {
    enabledMcpjsonServers: data.enabledMcpjsonServers || [],
    disabledMcpjsonServers: data.disabledMcpjsonServers || [],
  };
}

function setProjectMcpjsonServer(repoRoot, name, enabled) {
  const p = projectSettingsPath(repoRoot);
  const settings = jsonFile.readOr(p, {});
  const known = new Set([
    name,
    ...(settings.enabledMcpjsonServers || []),
    ...(settings.disabledMcpjsonServers || []),
  ]);
  const enabledNames = new Set((settings.enabledMcpjsonServers || []).filter((n) => n !== name));
  if (enabled) enabledNames.add(name);
  return setProjectMcpjsonState(repoRoot, [...known], [...enabledNames]);
}

function clearProjectMcpjsonState(repoRoot, names) {
  const p = projectSettingsPath(repoRoot);
  const existed = fs.existsSync(p);
  const data = jsonFile.readOr(p, {});
  const nameSet = new Set(names);
  const nextEnabled = (data.enabledMcpjsonServers || []).filter((n) => !nameSet.has(n));
  const nextDisabled = (data.disabledMcpjsonServers || []).filter((n) => !nameSet.has(n));
  if (nextEnabled.length === 0) delete data.enabledMcpjsonServers;
  else data.enabledMcpjsonServers = nextEnabled;
  if (nextDisabled.length === 0) delete data.disabledMcpjsonServers;
  else data.disabledMcpjsonServers = nextDisabled;
  if (Object.keys(data).length === 0) {
    if (existed) fs.rmSync(p);
    return;
  }
  jsonFile.write(p, data);
}

function setPluginState(repoRoot, pluginId, state) {
  const p = projectSettingsPath(repoRoot);
  const existed = fs.existsSync(p);
  const data = jsonFile.readOr(p, {});
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
  jsonFile.write(p, data);
}

function getProjectState(repoRoot) {
  const claudeJson = jsonFile.readOr(CLAUDE_JSON, {});
  const project = (claudeJson.projects || {})[repoRoot] || {};
  const settings = jsonFile.readOr(projectSettingsPath(repoRoot), {});
  return {
    disabledMcpServers: project.disabledMcpServers || [],
    enabledMcpjsonServers: settings.enabledMcpjsonServers || [],
    disabledMcpjsonServers: settings.disabledMcpjsonServers || [],
    enabledPlugins: settings.enabledPlugins || {},
  };
}

module.exports = {
  setDisabledMcps,
  setProjectMcpjsonState,
  setProjectMcpjsonServer,
  clearProjectMcpjsonState,
  setPluginState,
  getProjectState,
};
