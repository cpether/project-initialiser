const { spawnSync } = require('child_process');

const SERVICE_PREFIX = 'claude-code-secrets';

function service(isolated, repoHash) {
  return isolated ? `${SERVICE_PREFIX}:${repoHash}` : SERVICE_PREFIX;
}

function set({ name, value, isolated, repoHash: hash }) {
  const svc = service(isolated, hash);
  const r = spawnSync('security', [
    'add-generic-password',
    '-s', svc,
    '-a', name,
    '-w', value,
    '-U',
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`security add-generic-password failed (exit ${r.status})`);
  return { backend: 'keychain', service: svc, account: name };
}

function get({ ref }) {
  const r = spawnSync('security', [
    'find-generic-password',
    '-s', ref.service,
    '-a', ref.account,
    '-w',
  ], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`secret not found in keychain: service=${ref.service} account=${ref.account}`);
  }
  return r.stdout.replace(/\n$/, '');
}

function rm({ ref }) {
  const r = spawnSync('security', [
    'delete-generic-password',
    '-s', ref.service,
    '-a', ref.account,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  return r.status === 0;
}

module.exports = { set, get, rm };
