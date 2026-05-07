const { spawnSync } = require('child_process');

function set({ name, opRef }) {
  if (!opRef || !opRef.startsWith('op://')) {
    throw new Error(`1Password backend requires an op:// reference, got: ${opRef}`);
  }
  return { backend: 'op', ref: opRef };
}

function get({ ref }) {
  const r = spawnSync('op', ['read', ref.ref], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`op read failed for ${ref.ref}: ${r.stderr || ''}`);
  }
  return r.stdout.replace(/\n$/, '');
}

function rm() {
  return true;
}

module.exports = { set, get, rm };
