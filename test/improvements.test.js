const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-init-test-'));
const home = path.join(tmpRoot, 'home');
fs.mkdirSync(home, { recursive: true });
process.env.HOME = home;

const picker = require('../lib/picker');
const wizard = require('../lib/wizard');
const writers = require('../lib/writers');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function makeRepo(name) {
  const repo = path.join(tmpRoot, name);
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  return repo;
}

function setClaudeJson(data) {
  writeJson(path.join(home, '.claude.json'), data);
}

function mockPicker(overrides = {}) {
  picker.confirm = overrides.confirm || (async () => true);
  picker.select = overrides.select || (async ({ choices }) => choices[0].value);
  picker.input = overrides.input || (async ({ default: def = '' }) => def);
  picker.password = overrides.password || (async () => 'secret');
  picker.checkbox = overrides.checkbox || (async ({ choices }) =>
    choices.filter((choice) => choice.checked).map((choice) => choice.value));
}

async function testUserMcpsStayUserScoped() {
  const repo = makeRepo('user-scope');
  setClaudeJson({
    mcpServers: {
      user_mcp: { type: 'stdio', command: 'node', args: ['server.js'], env: {} },
    },
  });

  mockPicker({
    checkbox: async ({ message }) => {
      if (message.startsWith('User-scope MCPs')) return ['user_mcp'];
      return [];
    },
  });
  await wizard.runInit({ root: repo, isGit: true });
  assert.strictEqual(fs.existsSync(path.join(repo, '.mcp.json')), false);
  assert.deepStrictEqual((readJson(path.join(home, '.claude.json')).projects || {})[repo].disabledMcpServers, undefined);

  mockPicker({
    checkbox: async ({ message }) => {
      if (message.startsWith('User-scope MCPs')) return [];
      return [];
    },
  });
  await wizard.runInit({ root: repo, isGit: true });
  assert.strictEqual(fs.existsSync(path.join(repo, '.mcp.json')), false);
  assert.deepStrictEqual(readJson(path.join(home, '.claude.json')).projects[repo].disabledMcpServers, ['user_mcp']);

  mockPicker({
    checkbox: async ({ message }) => {
      if (message.startsWith('User-scope MCPs')) return ['user_mcp'];
      return [];
    },
  });
  await wizard.runInit({ root: repo, isGit: true });
  assert.deepStrictEqual(readJson(path.join(home, '.claude.json')).projects[repo].disabledMcpServers, undefined);
}

async function testInitWrapsUserMcpInPlace() {
  const repo = makeRepo('user-wrap-in-place');
  writeJson(path.join(repo, '.claude', '.claude-init.json'), {
    version: 1,
    mcps: [],
    skills: [],
    secrets: {
      TOKEN: { backend: 'op', ref: 'op://Test/Token/credential' },
    },
  });
  setClaudeJson({
    mcpServers: {
      user_secret_mcp: {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: '${TOKEN}' },
      },
    },
  });

  mockPicker({
    checkbox: async ({ message }) => {
      if (message.startsWith('User-scope MCPs')) return ['user_secret_mcp'];
      if (message.startsWith('Migrate user entries')) return ['user_secret_mcp'];
      return [];
    },
    select: async ({ choices }) => {
      const useExisting = choices.find((choice) => choice.value === 'use');
      return (useExisting || choices[0]).value;
    },
  });

  await wizard.runInit({ root: repo, isGit: true });
  assert.strictEqual(fs.existsSync(path.join(repo, '.mcp.json')), false);
  const userMcp = readJson(path.join(home, '.claude.json')).mcpServers.user_secret_mcp;
  assert.match(userMcp.command, /claude-init$/);
  assert.deepStrictEqual(userMcp.args, ['exec', 'TOKEN', '--', 'node', 'server.js']);
  assert.deepStrictEqual(userMcp.env, {});
}

async function testProjectMcpStateIsReplaced() {
  const repo = makeRepo('project-state');
  setClaudeJson({});
  writeJson(path.join(repo, '.mcp.json'), {
    mcpServers: {
      project_mcp: { type: 'stdio', command: 'node', args: ['project.js'], env: {} },
    },
  });

  mockPicker({
    checkbox: async ({ message }) => {
      if (message.startsWith('Project-scope MCPs')) return [];
      return [];
    },
  });
  await wizard.runInit({ root: repo, isGit: true });
  let settings = readJson(path.join(repo, '.claude', 'settings.json'));
  assert.deepStrictEqual(settings.disabledMcpjsonServers, ['project_mcp']);
  assert.strictEqual(settings.enabledMcpjsonServers, undefined);

  mockPicker({
    checkbox: async ({ message }) => {
      if (message.startsWith('Project-scope MCPs')) return ['project_mcp'];
      return [];
    },
  });
  await wizard.runInit({ root: repo, isGit: true });
  settings = readJson(path.join(repo, '.claude', 'settings.json'));
  assert.deepStrictEqual(settings.enabledMcpjsonServers, ['project_mcp']);
  assert.strictEqual(settings.disabledMcpjsonServers, undefined);
}

async function testSkippedSecretLeavesProjectMcpUnchanged() {
  const repo = makeRepo('skipped-secret');
  setClaudeJson({});
  const original = {
    mcpServers: {
      secret_mcp: {
        type: 'stdio',
        command: 'node',
        args: ['secret.js'],
        env: { TOKEN: '${TOKEN}' },
      },
    },
  };
  writeJson(path.join(repo, '.mcp.json'), original);

  mockPicker({
    checkbox: async ({ message }) => {
      if (message.startsWith('Project-scope MCPs')) return ['secret_mcp'];
      if (message.startsWith('Migrate project entries')) return ['secret_mcp'];
      return [];
    },
    select: async ({ choices }) => {
      const skip = choices.find((choice) => choice.value === 'skip');
      return skip ? skip.value : choices[0].value;
    },
  });
  await wizard.runInit({ root: repo, isGit: true });
  assert.deepStrictEqual(readJson(path.join(repo, '.mcp.json')), original);
}

async function testInitMigratesProjectDollarEnvReference() {
  const repo = makeRepo('project-dollar-env');
  writeJson(path.join(repo, '.claude', '.claude-init.json'), {
    version: 1,
    mcps: [],
    skills: [],
    secrets: {
      GRAFANA_SERVICE_ACCOUNT_TOKEN: { backend: 'op', ref: 'op://Test/Grafana/credential' },
    },
  });
  setClaudeJson({});
  writeJson(path.join(repo, '.mcp.json'), {
    mcpServers: {
      grafana: {
        command: 'uvx',
        args: ['mcp-grafana'],
        env: {
          GRAFANA_URL: 'https://adaptavist.grafana.net',
          GRAFANA_SERVICE_ACCOUNT_TOKEN: '$GRAFANA_SERVICE_ACCOUNT_TOKEN',
        },
      },
    },
  });

  mockPicker({
    checkbox: async ({ message }) => {
      if (message.startsWith('Project-scope MCPs')) return ['grafana'];
      if (message.startsWith('Migrate project entries')) return ['grafana'];
      return [];
    },
    select: async ({ choices }) => {
      const useExisting = choices.find((choice) => choice.value === 'use');
      return (useExisting || choices[0]).value;
    },
  });

  await wizard.runInit({ root: repo, isGit: true });
  const migrated = readJson(path.join(repo, '.mcp.json')).mcpServers.grafana;
  assert.strictEqual(migrated.command, 'claude-init');
  assert.deepStrictEqual(migrated.args, [
    'exec',
    'GRAFANA_SERVICE_ACCOUNT_TOKEN',
    '--',
    'uvx',
    'mcp-grafana',
  ]);
  assert.deepStrictEqual(migrated.env, {
    GRAFANA_URL: 'https://adaptavist.grafana.net',
  });
}

function testProjectMcpEnableDisableCliUsesSettingsJson() {
  const repo = makeRepo('cli-project-enable');
  setClaudeJson({});
  writeJson(path.join(repo, '.mcp.json'), {
    mcpServers: {
      project_mcp: { type: 'stdio', command: 'node', args: ['project.js'], env: {} },
    },
  });

  let result = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'claude-init'), 'mcp', 'disable', 'project_mcp'], {
    cwd: repo,
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  let settings = readJson(path.join(repo, '.claude', 'settings.json'));
  assert.deepStrictEqual(settings.disabledMcpjsonServers, ['project_mcp']);
  assert.strictEqual(readJson(path.join(home, '.claude.json')).projects, undefined);

  result = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'claude-init'), 'mcp', 'enable', 'project_mcp'], {
    cwd: repo,
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  settings = readJson(path.join(repo, '.claude', 'settings.json'));
  assert.deepStrictEqual(settings.enabledMcpjsonServers, ['project_mcp']);
  assert.strictEqual(settings.disabledMcpjsonServers, undefined);
}

async function testCopiedUserShimCleanup() {
  const repo = makeRepo('shim-cleanup');
  setClaudeJson({
    mcpServers: {
      shim_mcp: {
        type: 'stdio',
        command: 'node',
        args: ['shim.js'],
        env: { TOKEN: '${TOKEN}' },
      },
    },
  });
  writeJson(path.join(repo, '.mcp.json'), {
    mcpServers: {
      shim_mcp: {
        type: 'stdio',
        command: 'claude-init',
        args: ['exec', 'TOKEN', '--', 'node', 'shim.js'],
        env: { TOKEN: '${TOKEN}' },
      },
    },
  });

  mockPicker({
    confirm: async () => true,
    checkbox: async ({ message }) => {
      if (message.startsWith('User-scope MCPs')) return ['shim_mcp'];
      return [];
    },
  });
  await wizard.runInit({ root: repo, isGit: true });
  assert.strictEqual(fs.existsSync(path.join(repo, '.mcp.json')), false);
  const userMcp = readJson(path.join(home, '.claude.json')).mcpServers.shim_mcp;
  assert.match(userMcp.command, /claude-init$/);
  assert.deepStrictEqual(userMcp.args, ['exec', 'TOKEN', '--', 'node', 'shim.js']);
  assert.deepStrictEqual(userMcp.env, {});
}

function testInvalidJsonIsNotOverwritten() {
  const repo = makeRepo('invalid-json');
  const target = path.join(repo, '.mcp.json');
  fs.writeFileSync(target, '{ invalid json');
  assert.throws(
    () => writers.writeProjectMcpJson(repo, [{ name: 'x', command: 'node', args: [], env: {} }]),
    /invalid JSON/,
  );
  assert.strictEqual(fs.readFileSync(target, 'utf8'), '{ invalid json');
}

(async () => {
  await testUserMcpsStayUserScoped();
  await testInitWrapsUserMcpInPlace();
  await testProjectMcpStateIsReplaced();
  await testSkippedSecretLeavesProjectMcpUnchanged();
  await testInitMigratesProjectDollarEnvReference();
  testProjectMcpEnableDisableCliUsesSettingsJson();
  await testCopiedUserShimCleanup();
  testInvalidJsonIsNotOverwritten();
  console.log('improvements tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
