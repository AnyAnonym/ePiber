// ══════════════════════════════════════════════════════
// dataStore.js — Reiner In-Memory-Datenspeicher
// Hält alle Spreadsheet-Tabellen ungefiltert im Speicher
// Keine Logik, keine Filterung — nur Getter/Setter
// ══════════════════════════════════════════════════════

const { TABLE_CONFIG } = require("./config.js");

// Store initialisieren aus TABLE_CONFIG
const store = {};
for (const key of Object.keys(TABLE_CONFIG)) {
  store[key] = { values: [], lastUpdate: 0, pollCount: 0 };
}

function set(tableName, values) {
  if (!store[tableName]) return;
  store[tableName].values = values || [];
  store[tableName].lastUpdate = Date.now();
  store[tableName].pollCount++;
}

function get(tableName) {
  if (!store[tableName]) return [];
  return store[tableName].values;
}

function getMeta(tableName) {
  if (!store[tableName]) return null;
  return {
    lastUpdate: store[tableName].lastUpdate,
    pollCount: store[tableName].pollCount,
    rowCount: store[tableName].values.length,
  };
}

function getAll() {
  const result = {};
  for (const key of Object.keys(store)) {
    result[key] = getMeta(key);
  }
  return result;
}

function isReady() {
  // Prüft ob alle Tabellen mindestens einmal geladen wurden
  return Object.values(store).every((s) => s.lastUpdate > 0);
}

module.exports = { set, get, getMeta, getAll, isReady };
