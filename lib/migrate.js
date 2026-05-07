function isClaudeInitWrapped(cfg) {
  if (!cfg || !Array.isArray(cfg.args)) return false;
  if (typeof cfg.command !== 'string') return false;
  if (!/(^|\/)claude-init$/.test(cfg.command)) return false;
  return cfg.args[0] === 'exec' && cfg.args.includes('--');
}

function unwrap(cfg) {
  if (!isClaudeInitWrapped(cfg)) return cfg;
  const dashIdx = cfg.args.indexOf('--');
  return {
    type: 'stdio',
    command: cfg.args[dashIdx + 1],
    args: cfg.args.slice(dashIdx + 2),
    env: cfg.env || {},
  };
}

function planMigration(cfg) {
  if (cfg.url || cfg.type === 'http') {
    return { canMigrate: false, reason: 'http transport — header/url secrets not yet supported' };
  }
  if (isClaudeInitWrapped(cfg)) {
    return { canMigrate: false, reason: 'already wrapped through claude-init exec' };
  }
  const secrets = [];
  const stripEnvKeys = [];
  for (const [k, v] of Object.entries(cfg.env || {})) {
    if (typeof v !== 'string') continue;
    const m = v.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
    if (m && m[1] === k) {
      secrets.push(k);
      stripEnvKeys.push(k);
    }
  }
  const argvVars = new Set();
  for (const a of cfg.args || []) {
    if (typeof a !== 'string') continue;
    for (const m of a.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) argvVars.add(m[1]);
  }
  if (secrets.length === 0 && argvVars.size === 0) {
    return { canMigrate: false, reason: 'no ${VAR} references — nothing to migrate' };
  }
  if (secrets.length === 0) {
    return {
      canMigrate: false,
      reason: `only argv references found (${[...argvVars].join(', ')}); claude-init exec injects via env, not argv`,
    };
  }
  return {
    canMigrate: true,
    secrets,
    stripEnvKeys,
    argvWarnings: [...argvVars].filter((v) => !secrets.includes(v)),
  };
}

function rewrap(cfg, plan, { execCommand }) {
  const newEnv = { ...(cfg.env || {}) };
  for (const k of plan.stripEnvKeys) delete newEnv[k];
  return {
    type: 'stdio',
    command: execCommand,
    args: ['exec', ...plan.secrets, '--', cfg.command, ...(cfg.args || [])],
    env: newEnv,
  };
}

module.exports = { isClaudeInitWrapped, unwrap, planMigration, rewrap };
