const fs = require('fs');
const path = require('path');
const os = require('os');

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
    for (const m of s.matchAll(pattern)) vars.add(m[1]);
  };
  if (server.env) for (const v of Object.values(server.env)) scan(v);
  if (server.args) for (const a of server.args) scan(a);
  scan(server.command);
  return [...vars];
}

function discoverMcps() {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');
  const data = readJsonSafe(claudeJsonPath);
  if (!data || !data.mcpServers) return [];
  return Object.entries(data.mcpServers).map(([name, cfg]) => ({
    name,
    type: cfg.type || 'stdio',
    command: cfg.command,
    args: cfg.args || [],
    env: cfg.env || {},
    url: cfg.url,
    headers: cfg.headers,
    requiredSecrets: extractEnvVars(cfg),
  }));
}

function discoverSkills() {
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
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

module.exports = { discoverMcps, discoverSkills };
