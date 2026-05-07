const manifest = require('./manifest');
const userManifest = require('./user-manifest');

function resolve(repoRoot, name) {
  const projData = manifest.read(repoRoot) || {};
  const projRef = (projData.secrets || {})[name];
  if (projRef) return { ref: projRef, scope: 'project' };
  const userData = userManifest.load();
  const userRef = (userData.secrets || {})[name];
  if (userRef) return { ref: userRef, scope: 'user' };
  return null;
}

function listAll(repoRoot) {
  const projSecrets = (manifest.read(repoRoot) || {}).secrets || {};
  const userSecrets = userManifest.load().secrets || {};
  const names = new Set([...Object.keys(projSecrets), ...Object.keys(userSecrets)]);
  const out = [];
  for (const name of [...names].sort()) {
    const inProj = !!projSecrets[name];
    const inUser = !!userSecrets[name];
    out.push({
      name,
      project: projSecrets[name] || null,
      user: userSecrets[name] || null,
      effective: inProj ? 'project' : 'user',
      overridden: inProj && inUser,
    });
  }
  return out;
}

module.exports = { resolve, listAll };
