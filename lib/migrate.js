function isClaudeInitWrapped(cfg) {
  if (!cfg || !Array.isArray(cfg.args)) return false;
  if (typeof cfg.command !== 'string') return false;
  if (!/(^|\/)claude-init$/.test(cfg.command)) return false;
  return cfg.args[0] === 'exec' && cfg.args.includes('--');
}

function unwrap(cfg) {
  if (!isClaudeInitWrapped(cfg)) return { ...cfg, secretTokens: [] };
  const dashIdx = cfg.args.indexOf('--');
  return {
    type: 'stdio',
    command: cfg.args[dashIdx + 1],
    args: cfg.args.slice(dashIdx + 2),
    env: cfg.env || {},
    secretTokens: cfg.args.slice(1, dashIdx),
  };
}

function collectSecretsFromEnv(env) {
  // Returns env keys that have ${VAR}-shaped values. The default "secret name" for each
  // is the env key itself; the wizard may override via mappings at rewrap time.
  const secrets = [];
  const stripEnvKeys = [];
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v !== 'string') continue;
    if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v)) {
      secrets.push(k);
      stripEnvKeys.push(k);
    }
  }
  return { secrets, stripEnvKeys };
}

function parseTokensFromWrapped(secretTokens) {
  // Wrapped configs carry secret tokens as `NAME` or `ENV_KEY=NAME`.
  const out = [];
  for (const tok of secretTokens || []) {
    if (tok.includes('=')) {
      const eq = tok.indexOf('=');
      out.push({ envKey: tok.slice(0, eq), secretName: tok.slice(eq + 1) });
    } else {
      out.push({ envKey: tok, secretName: tok });
    }
  }
  return out;
}

function normalize(cfg) {
  const u = unwrap(cfg);
  const env = { ...(u.env || {}) };
  const { stripEnvKeys, secrets: envSecretKeys } = collectSecretsFromEnv(env);
  for (const k of stripEnvKeys) delete env[k];
  // Unwrapped env-only form: each ${VAR} value is canonicalised to {envKey: K, secretName: K} — the wizard's
  // default migration policy renames source-of-value to the env key. A literal mapping in the wrapped form
  // (e.g. `GSAT=GRAFANA_DEV_TOKEN`) preserves whatever the user chose.
  const mappings = [
    ...envSecretKeys.map((k) => ({ envKey: k, secretName: k })),
    ...parseTokensFromWrapped(u.secretTokens),
  ];
  mappings.sort((a, b) => (a.envKey + '|' + a.secretName).localeCompare(b.envKey + '|' + b.secretName));
  return {
    type: u.type || (u.url ? 'http' : 'stdio'),
    command: u.command,
    args: u.args || [],
    env,
    mappings,
    url: u.url,
  };
}

function stableStringify(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  if (obj && typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
  }
  return JSON.stringify(obj);
}

function equivalent(a, b) {
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  return stableStringify(na) === stableStringify(nb);
}

function planMigration(cfg) {
  if (cfg.url || cfg.type === 'http') {
    return { canMigrate: false, reason: 'http transport — header/url secrets not yet supported' };
  }
  if (isClaudeInitWrapped(cfg)) {
    return { canMigrate: false, reason: 'already wrapped through claude-init exec' };
  }
  const { secrets, stripEnvKeys } = collectSecretsFromEnv(cfg.env || {});
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
    argvWarnings: [...argvVars],
  };
}

function rewrap(cfg, plan, { execCommand, mappings }) {
  const newEnv = { ...(cfg.env || {}) };
  for (const k of plan.stripEnvKeys) delete newEnv[k];
  // Default mappings: each env key is its own secret name. Caller may pass explicit mappings to remap.
  const effectiveMappings = mappings && mappings.length > 0
    ? mappings
    : (plan.secrets || []).map((k) => ({ envKey: k, secretName: k }));
  const tokens = [];
  for (const { envKey, secretName } of effectiveMappings) {
    const tok = envKey === secretName ? secretName : `${envKey}=${secretName}`;
    if (!tokens.includes(tok)) tokens.push(tok);
  }
  return {
    type: 'stdio',
    command: execCommand,
    args: ['exec', ...tokens, '--', cfg.command, ...(cfg.args || [])],
    env: newEnv,
  };
}

function readWrappedTokens(cfg) {
  if (!isClaudeInitWrapped(cfg)) return null;
  const dashIdx = cfg.args.indexOf('--');
  return parseTokensFromWrapped(cfg.args.slice(1, dashIdx));
}

function rewriteWrappedTokens(cfg, mappings) {
  if (!isClaudeInitWrapped(cfg)) throw new Error('not a claude-init exec wrapped config');
  const dashIdx = cfg.args.indexOf('--');
  const trailing = cfg.args.slice(dashIdx);
  const tokens = mappings.map(({ envKey, secretName }) =>
    envKey === secretName ? secretName : `${envKey}=${secretName}`,
  );
  return { ...cfg, args: ['exec', ...tokens, ...trailing] };
}

module.exports = {
  isClaudeInitWrapped,
  unwrap,
  normalize,
  equivalent,
  planMigration,
  rewrap,
  readWrappedTokens,
  rewriteWrappedTokens,
};
