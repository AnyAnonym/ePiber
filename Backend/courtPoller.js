// ══════════════════════════════════════════════════════
// courtPoller.js — Court-Score Polling + ScoreLog
// Pollt die externe JSON-Ressource für Live-Spielstände
// Pusht Änderungen an dataProvider für WebSocket-Verteilung
// ══════════════════════════════════════════════════════

const { google } = require("googleapis");
const { COURT_URL, COURT_POLL_INTERVAL, SHEET_ID } = require("./config.js");

let lastData = null;
let lastJson = "";
let lastCourtScores = {};
let pollCount = 0;
let pushCount = 0;
let pollingActive = false;
let pollTimerId = null;
let courtActive = { "1": false, "2": false };
let onScoreChange = null; // Callback für Score-Push

// ── Google Sheets Client (für ScoreLog) ──
let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// ── Timestamp (Wiener Zeit) ──
function getTimestamp() {
  const now = new Date().toLocaleString("de-AT", { timeZone: "Europe/Vienna" });
  const m = now.match(/(\d+)\.(\d+)\.(\d+),?\s*(\d+):(\d+):(\d+)/);
  if (!m) return new Date().toISOString();
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const yy = yyyy.slice(-2);
  return `${yy}${mm.padStart(2, "0")}${dd.padStart(2, "0")}-${hh.padStart(2, "0")}${mi.padStart(2, "0")}-${ss.padStart(2, "0")}`;
}

// ── Score-String bauen ──
function buildScoreString(court) {
  const s1 = `${court.satz1home || "0"}-${court.satz1gast || "0"}`;
  const s2 = `${court.satz2home || "0"}-${court.satz2gast || "0"}`;
  const s3 = `${court.satz3home || "0"}-${court.satz3gast || "0"}`;
  const punkte = `${court.punktehome || "0"}-${court.punktegast || "0"}`;
  return `${s1}/${s2}/${s3}/${punkte}`;
}

// ── ScoreLog in Spreadsheet ──
async function writeScoreLog(platzNr, scoreString) {
  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "ScoreLog",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[getTimestamp(), platzNr, scoreString]] },
    });
  } catch (err) {
    console.error("ScoreLog Fehler:", err.message);
  }
}

// ── Score-Änderungen erkennen und loggen ──
async function checkAndLogScoreChanges(data) {
  if (!data || !Array.isArray(data.courts)) return;
  for (const court of data.courts) {
    const p = court.platz;
    if (p !== "1" && p !== "2") continue;
    const scoreStr = buildScoreString(court);
    if (lastCourtScores[p] !== scoreStr) {
      lastCourtScores[p] = scoreStr;
      writeScoreLog(p, scoreStr);
    }
  }
}

// ── Polling ──

async function pollScores() {
  if (!pollingActive) return;

  try {
    const res = await fetch(COURT_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.text();
    pollCount++;

    if (json !== lastJson) {
      lastJson = json;
      lastData = JSON.parse(json);
      pushCount++;
      checkAndLogScoreChanges(lastData);

      // Push an registrierten Callback
      if (onScoreChange) {
        onScoreChange(lastData);
      }
    }
  } catch (err) {
    console.error("courtPoller: Poll-Fehler:", err.message);
  }

  if (pollingActive) {
    pollTimerId = setTimeout(pollScores, COURT_POLL_INTERVAL);
  }
}

// ── Start/Stop basierend auf Aktiv-Status ──

function updatePollingState() {
  const shouldPoll = courtActive["1"] || courtActive["2"];
  if (shouldPoll && !pollingActive) {
    pollingActive = true;
    console.log("courtPoller: Polling GESTARTET");
    pollScores();
  } else if (!shouldPoll && pollingActive) {
    pollingActive = false;
    if (pollTimerId) {
      clearTimeout(pollTimerId);
      pollTimerId = null;
    }
    console.log("courtPoller: Polling GESTOPPT");
  }
}

function setCourtActive(courts) {
  if (typeof courts["1"] !== "undefined") {
    courtActive["1"] = courts["1"] === 1 || courts["1"] === true;
  }
  if (typeof courts["2"] !== "undefined") {
    courtActive["2"] = courts["2"] === 1 || courts["2"] === true;
  }
  updatePollingState();
}

function setOnScoreChange(callback) {
  onScoreChange = callback;
}

function getLastData() {
  return lastData;
}

function getStatus() {
  return {
    pollingActive,
    courtActive,
    pollCount,
    pushCount,
  };
}

module.exports = { setCourtActive, setOnScoreChange, getLastData, getStatus, updatePollingState };
