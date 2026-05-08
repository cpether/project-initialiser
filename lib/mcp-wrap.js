const fs = require('fs');
const path = require('path');
const manifest = require('./manifest');
const scopeMove = require('./scope-move');
const migrate = require('./migrate');
const wizard = require('./wizard');

function selfPath() {
  return fs.realpathSync(path.resolve(__dirname, '..', 'bin', 'claude-init'));
}

async function runWrap({ root }, name) {
  const located = scopeMove.locateEntry(root, name);
  if (!located) throw new Error(`MCP "${name}" not found in user, project, or local scope for ${root}`);
  if (migrate.isClaudeInitWrapped(located.cfg)) {
    return { name, scope: located.scope, status: 'already-wrapped' };
  }

  const plan = migrate.planMigration(located.cfg);
  if (!plan.canMigrate) {
    throw new Error(`cannot wrap "${name}": ${plan.reason}`);
  }

  const projData = manifest.read(root) || { version: 1, mcps: [], skills: [], secrets: {} };
  const mappings = [];
  for (const envKey of plan.secrets) {
    const result = await wizard.configureSecret(envKey, root, projData);
    if (!result) {
      return { name, scope: located.scope, status: 'skipped', skippedSecret: envKey };
    }
    mappings.push({ envKey, secretName: result.storedAs });
  }

  const execCommand = located.scope === 'project' ? 'claude-init' : selfPath();
  const newCfg = migrate.rewrap(located.cfg, plan, { execCommand, mappings });
  scopeMove.writeToScope(root, located.scope, name, newCfg);
  manifest.write(root, projData);
  return { name, scope: located.scope, status: 'wrapped', argvWarnings: plan.argvWarnings };
}

module.exports = { runWrap };
