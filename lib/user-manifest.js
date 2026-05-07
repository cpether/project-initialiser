const fs = require('fs');
const path = require('path');
const os = require('os');

const USER_MANIFEST_PATH = path.join(os.homedir(), '.claude', 'claude-init', 'manifest.json');

function read() {
  if (!fs.existsSync(USER_MANIFEST_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(USER_MANIFEST_PATH, 'utf8')); }
  catch { return null; }
}

function write(data) {
  fs.mkdirSync(path.dirname(USER_MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(USER_MANIFEST_PATH, JSON.stringify(data, null, 2) + '\n');
}

function load() {
  return read() || { version: 1, secrets: {} };
}

module.exports = { read, write, load, USER_MANIFEST_PATH };
