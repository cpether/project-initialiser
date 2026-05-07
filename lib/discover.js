const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function extractEnvVars(server) {
  const vars = new Set();
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;
  const scan = (s) => {
    if (typeof s !== 'string') return;
    for (const m of s.matchAll(pattern)) {
      if (m[1] === 'CLAUDE_PLUGIN_ROOT') continue;
      vars.add(m[1]);
    }
  };
  if (server.env) for (const v of Object.values(server.env)) scan(v);
  if (server.args) for (const a of server.args) scan(a);
  scan(server.command);
  scan(server.url);
  if (server.headers) for (const v of Object.values(server.headers)) scan(v);
  return [...vars];
}

function isClaudeInitWrapped(cfg) {
  if (!cfg || !Array.isArray(cfg.args)) return false;
  if (typeof cfg.command !== 'string') return false;
  if (!/(^|\/)claude-init$/.test(cfg.command)) return false;
  return cfg.args[0] === 'exec' && cfg.args.includes('--');
}

function expandPluginRoot(value, pluginRoot) {
  if (typeof value !== 'string') return value;
  return value.split('${CLAUDE_PLUGIN_ROOT}').join(pluginRoot);
}

function normalizeServer(name, cfg, source, extra = {}) {
  return {
    name,
    type: cfg.type || (cfg.url ? 'http' : 'stdio'),
    command: cfg.command,
    args: cfg.args || [],
    env: cfg.env || {},
    url: cfg.url,
    headers: cfg.headers,
    requiredSecrets: extractEnvVars(cfg),
    source,
    ...extra,
  };
}

function discoverUserMcps() {
  const data = readJsonSafe(path.join(os.homedir(), '.claude.json'));
  if (!data || !data.mcpServers) return [];
  return Object.entries(data.mcpServers).map(([name, cfg]) =>
    normalizeServer(name, cfg, 'user'),
  );
}

function discoverPluginMcps() {
  const idx = readJsonSafe(
    path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'),
  );
  if (!idx || !idx.plugins) return [];
  const out = [];
  for (const [pluginKey, installs] of Object.entries(idx.plugins)) {
    if (!Array.isArray(installs)) continue;
    for (const inst of installs) {
      if (!inst || !inst.installPath) continue;
      const data = readJsonSafe(path.join(inst.installPath, '.mcp.json'));
      if (!data || !data.mcpServers) continue;
      for (const [name, rawCfg] of Object.entries(data.mcpServers)) {
        const cfg = {
          ...rawCfg,
          command: expandPluginRoot(rawCfg.command, inst.installPath),
          args: (rawCfg.args || []).map((a) => expandPluginRoot(a, inst.installPath)),
        };
        out.push(
          normalizeServer(name, cfg, 'plugin', {
            pluginName: pluginKey,
            managed: true,
          }),
        );
      }
    }
  }
  return out;
}

function discoverClaudeAiMcps() {
  let raw;
  try {
    raw = execSync('claude mcp list', {
      encoding: 'utf8',
      timeout: 15000,
      cwd: os.homedir(),
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^(claude\.ai [^:]+):\s+(https?:\/\/\S+)\s+-\s+/);
    if (!m) continue;
    const name = m[1];
    const url = m[2];
    out.push(
      normalizeServer(name, { type: 'http', url }, 'claudeai', {
        managed: true,
      }),
    );
  }
  return out;
}

function discoverProjectMcps(repoRoot) {
  if (!repoRoot) return [];
  const p = path.join(repoRoot, '.mcp.json');
  const data = readJsonSafe(p);
  if (!data || !data.mcpServers) return [];
  return Object.entries(data.mcpServers).map(([name, cfg]) => {
    const wrapped = isClaudeInitWrapped(cfg);
    return {
      ...normalizeServer(name, cfg, 'project'),
      claudeInitWrapped: wrapped,
    };
  });
}

function discoverMcps(repoRoot) {
  const all = [
    ...discoverProjectMcps(repoRoot),
    ...discoverUserMcps(),
    ...discoverPluginMcps(),
    ...discoverClaudeAiMcps(),
  ];
  const seen = new Set();
  return all.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

function discoverSkills() {
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => {
      if (e.isDirectory()) return true;
      if (!e.isSymbolicLink()) return false;
      try {
        return fs.statSync(path.join(skillsDir, e.name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((e) => {
      const skillFile = path.join(skillsDir, e.name, 'SKILL.md');
      let description = '';
      if (fs.existsSync(skillFile)) {
        const content = fs.readFileSync(skillFile, 'utf8');
        const fm = content.match(/^---\n([\s\S]*?)\n---/);
        if (fm) {
          const desc = fm[1].match(/^description:\s*(.+)$/m);
          if (desc) description = desc[1].trim();
        }
      }
      return { name: e.name, description };
    });
}

module.exports = { discoverMcps, discoverProjectMcps, discoverSkills };
