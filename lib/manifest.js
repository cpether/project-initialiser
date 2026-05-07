const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_PATH = '.claude/.claude-init.json';

function manifestPath(repoRoot) {
  return path.join(repoRoot, MANIFEST_PATH);
}

function read(repoRoot) {
  const p = manifestPath(repoRoot);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function write(repoRoot, data) {
  const p = manifestPath(repoRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function repoHash(repoRoot) {
  return crypto.createHash('sha256').update(path.resolve(repoRoot)).digest('hex').slice(0, 12);
}

function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

module.exports = { read, write, manifestPath, repoHash, findRepoRoot, MANIFEST_PATH };
