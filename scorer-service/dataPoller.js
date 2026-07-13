// ══════════════════════════════════════════════════════
// dataPoller.js — Tick-basiertes Google Sheets Polling
// Liest Tabellen aus der Spreadsheet und befüllt dataStore
// Daten werden UNGEFILTERT gespeichert
// ══════════════════════════════════════════════════════

const { google } = require("googleapis");
const {
  SHEET_ID, POLL_BASE_INTERVAL,
  POLL_FAST_MULTIPLIER, POLL_SLOW_MULTIPLIER,
  TABLE_CONFIG,
} = require("./config.js");
const dataStore = require("./dataStore.js");

let sheetsClient = null;
let tickCount = 0;
let tickTimerId = null;
let isPolling = false;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// ── Einzelne Tabelle lesen ──

async function pollTable(sheets, tableName, range) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });
    const values = res.data.values || [];
    dataStore.set(tableName, values);
    return true;
  } catch (err) {
    console.error(`dataPoller: Fehler beim Lesen von ${tableName} (${range}):`, err.message);
    return false;
  }
}

// ── Tabellen einer Kategorie pollen ──

async function pollCategory(sheets, category) {
  const tables = Object.entries(TABLE_CONFIG).filter(([, cfg]) => cfg.category === category);
  if (tables.length === 0) return;

  const promises = tables.map(([name, cfg]) => pollTable(sheets, name, cfg.range));
  await Promise.all(promises);
}

// ── Tick-Handler ──

async function onTick() {
  if (isPolling) return; // Vorherigen Tick nicht überholen
  isPolling = true;
  tickCount++;

  try {
    const sheets = await getSheetsClient();

    const isFastTick = tickCount % POLL_FAST_MULTIPLIER === 0;
    const isSlowTick = tickCount % POLL_SLOW_MULTIPLIER === 0;

    if (isSlowTick) {
      // Slow-Tick: fast + slow Tabellen pollen
      await Promise.all([
        pollCategory(sheets, "fast"),
        pollCategory(sheets, "slow"),
      ]);
      console.log(`dataPoller: Tick #${tickCount} — fast+slow aktualisiert`);
    } else if (isFastTick) {
      // Fast-Tick: nur fast Tabellen pollen
      await pollCategory(sheets, "fast");
      console.log(`dataPoller: Tick #${tickCount} — fast aktualisiert`);
    }
    // Sonst: kein Polling nötig (Kommunikationsschonung)

  } catch (err) {
    console.error("dataPoller: Tick-Fehler:", err.message);
  } finally {
    isPolling = false;
  }
}

// ── Initiales Laden (alle Tabellen einmal) ──

async function initialLoad() {
  console.log("dataPoller: Initiales Laden aller Tabellen...");
  try {
    const sheets = await getSheetsClient();
    const allTables = Object.entries(TABLE_CONFIG);
    const promises = allTables.map(([name, cfg]) => pollTable(sheets, name, cfg.range));
    await Promise.all(promises);
    console.log("dataPoller: Initiales Laden abgeschlossen.");
    return true;
  } catch (err) {
    console.error("dataPoller: Initiales Laden fehlgeschlagen:", err.message);
    return false;
  }
}

// ── Start/Stop ──

function start() {
  if (tickTimerId) return;
  tickCount = 0;
  tickTimerId = setInterval(onTick, POLL_BASE_INTERVAL);
  console.log(`dataPoller: Gestartet (Grundtakt ${POLL_BASE_INTERVAL}ms, fast=${POLL_FAST_MULTIPLIER}x, slow=${POLL_SLOW_MULTIPLIER}x)`);
}

function stop() {
  if (tickTimerId) {
    clearInterval(tickTimerId);
    tickTimerId = null;
  }
  console.log("dataPoller: Gestoppt");
}

function getStatus() {
  return {
    running: !!tickTimerId,
    tickCount,
    isPolling,
    tables: dataStore.getAll(),
  };
}

module.exports = { initialLoad, start, stop, getStatus };
