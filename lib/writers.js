const fs = require('fs');
const path = require('path');
const os = require('os');

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function buildServerEntry(mcp, { execCommand }) {
  if (mcp.type === 'http' || mcp.url) {
    const out = { type: 'http', url: mcp.url };
    if (mcp.headers) out.headers = mcp.headers;
    return out;
  }
  if (mcp.requiredSecrets && mcp.requiredSecrets.length > 0) {
    return {
      type: 'stdio',
      command: execCommand,
      args: ['exec', ...mcp.requiredSecrets, '--', mcp.command, ...(mcp.args || [])],
      env: mcp.env || {},
    };
  }
  return {
    type: 'stdio',
    command: mcp.command,
    args: mcp.args || [],
    env: mcp.env || {},
  };
}

function writeProjectMcpJson(repoRoot, mcps) {
  const target = path.join(repoRoot, '.mcp.json');
  const existing = readJsonSafe(target) || {};
  const servers = existing.mcpServers || {};
  for (const mcp of mcps) {
    servers[mcp.name] = buildServerEntry(mcp, { execCommand: 'claude-init' });
  }
  existing.mcpServers = servers;
  writeJson(target, existing);
}

function writeUserMcpEntry(name, mcp, execCommandAbsPath) {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');
  const data = readJsonSafe(claudeJsonPath);
  if (!data) throw new Error(`cannot read ${claudeJsonPath}`);
  data.mcpServers = data.mcpServers || {};
  data.mcpServers[name] = buildServerEntry({ ...mcp, name }, { execCommand: execCommandAbsPath });
  writeJson(claudeJsonPath, data);
}

function writeLocalMcpEntry(repoRoot, name, mcp, execCommandAbsPath) {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');
  const data = readJsonSafe(claudeJsonPath);
  if (!data) throw new Error(`cannot read ${claudeJsonPath}`);
  data.projects = data.projects || {};
  data.projects[repoRoot] = data.projects[repoRoot] || {};
  data.projects[repoRoot].mcpServers = data.projects[repoRoot].mcpServers || {};
  data.projects[repoRoot].mcpServers[name] = buildServerEntry({ ...mcp, name }, { execCommand: execCommandAbsPath });
  writeJson(claudeJsonPath, data);
}

function mergeSettingsJson(repoRoot, updates) {
  const target = path.join(repoRoot, '.claude', 'settings.json');
  const data = readJsonSafe(target) || {};
  if (updates.enabledMcpjsonServers !== undefined) {
    if (updates.enabledMcpjsonServers.length > 0) {
      const merged = new Set([...(data.enabledMcpjsonServers || []), ...updates.enabledMcpjsonServers]);
      data.enabledMcpjsonServers = [...merged].sort();
    } else if (data.enabledMcpjsonServers) {
      delete data.enabledMcpjsonServers;
    }
  }
  if (updates.skillOverrides) {
    const overrides = data.skillOverrides || {};
    for (const [name, val] of Object.entries(updates.skillOverrides)) {
      if (val === null) delete overrides[name];
      else overrides[name] = val;
    }
    if (Object.keys(overrides).length > 0) data.skillOverrides = overrides;
    else delete data.skillOverrides;
  }
  if (Object.keys(data).length === 0) {
    if (fs.existsSync(target)) fs.rmSync(target);
    return;
  }
  writeJson(target, data);
}

function addToGitignore(repoRoot, line, comment) {
  const p = path.join(repoRoot, '.gitignore');
  let body = '';
  if (fs.existsSync(p)) body = fs.readFileSync(p, 'utf8');
  const lines = body.split('\n').map((s) => s.trim());
  if (lines.includes(line)) return;
  if (body && !body.endsWith('\n')) body += '\n';
  body += '\n';
  if (comment) body += `# ${comment}\n`;
  body += line + '\n';
  fs.writeFileSync(p, body);
}

function removeFromProjectMcpJson(repoRoot, names) {
  const target = path.join(repoRoot, '.mcp.json');
  const existing = readJsonSafe(target);
  if (!existing || !existing.mcpServers) return;
  for (const n of names) delete existing.mcpServers[n];
  if (Object.keys(existing.mcpServers).length === 0) {
    if (Object.keys(existing).length === 1) {
      fs.rmSync(target);
      return;
    }
    delete existing.mcpServers;
  }
  writeJson(target, existing);
}

function readProjectServer(repoRoot, name) {
  const target = path.join(repoRoot, '.mcp.json');
  const existing = readJsonSafe(target);
  if (!existing || !existing.mcpServers) return null;
  return existing.mcpServers[name] || null;
}

module.exports = {
  buildServerEntry,
  writeProjectMcpJson,
  writeUserMcpEntry,
  writeLocalMcpEntry,
  mergeSettingsJson,
  addToGitignore,
  removeFromProjectMcpJson,
  readProjectServer,
};
