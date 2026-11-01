const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FARMERS_FILE = path.join(DATA_DIR, 'farmers.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

function ensureFile(file) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8');
}
function readJson(file) {
  ensureFile(file);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error(`Invalid JSON data in ${path.basename(file)}. Restore a valid JSON array.`); }
}
function writeJson(file, rows) {
  ensureFile(file);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(rows, null, 2), 'utf8');
  fs.renameSync(temp, file);
}
const readFarmers = () => readJson(FARMERS_FILE);
const writeFarmers = rows => writeJson(FARMERS_FILE, rows);
const readHistory = () => readJson(HISTORY_FILE);
const writeHistory = rows => writeJson(HISTORY_FILE, rows);
module.exports = { readFarmers, writeFarmers, readHistory, writeHistory };
