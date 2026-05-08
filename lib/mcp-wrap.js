const manifest = require('./manifest');
const wizard = require('./wizard');

async function runWrap({ root }, name) {
  const projData = manifest.read(root) || { version: 1, mcps: [], skills: [], secrets: {} };
  const result = await wizard.wrapMcpByName(root, name, projData);
  manifest.write(root, projData);
  return result;
}

module.exports = { runWrap };
