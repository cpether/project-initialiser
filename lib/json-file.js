const fs = require('fs');
const path = require('path');

function readOptional(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`invalid JSON in ${filePath}: ${err.message}`);
  }
}

function readOr(filePath, fallback) {
  const data = readOptional(filePath);
  return data === null ? fallback : data;
}

function write(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

module.exports = { readOptional, readOr, write };
