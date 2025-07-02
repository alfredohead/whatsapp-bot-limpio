// utils/storage.js
const fs = require('fs');
const path = require('path');

const baseFile = path.join(__dirname, '../storage/saludados-telegram.json');

function readState() {
  try {
    const raw = fs.readFileSync(baseFile, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(baseFile, JSON.stringify(state, null, 2));
}

function hasGreeted(userId) {
  const state = readState();
  return !!state[userId];
}

function setGreeted(userId) {
  const state = readState();
  state[userId] = true;
  writeState(state);
}

module.exports = { hasGreeted, setGreeted };
