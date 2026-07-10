const http = require("http");
const { WebSocketServer } = require("ws");
const { google } = require("googleapis");
const { SHEET_ID, COURT_URL, SCOREBOARD_FUNCTION_URL } = require("./config.js");

// ── Konfiguration ──
const POLL_INTERVAL = 2000;
const PORT = process.env.PORT || 8080;

// ── State ──
let lastData = null;
let lastJson = "";
let lastCourtScores = {}; // Pro Platz den letzten Score-String speichern
let clients = new Set();
let pollCount = 0;
let pushCount = 0;
let pollingActive = false;
let pollTimerId = null;
let courtActive = { "1": false, "2": false };

// ── Google Sheets Client ──
let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// ── Score-String aus Court-Daten bauen ──
function buildScoreString(court) {
  const s1 = `${court.satz1home || "0"}-${court.satz1gast || "0"}`;
  const s2 = `${court.satz2home || "0"}-${court.satz2gast || "0"}`;
  const s3 = `${court.satz3home || "0"}-${court.satz3gast || "0"}`;
  const punkte = `${court.punktehome || "0"}-${court.punktegast || "0"}`;
  return `${s1}/${s2}/${s3}/${punkte}`;
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

// ── ScoreLog in Spreadsheet schreiben ──
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
      // Async loggen, aber nicht auf Ergebnis warten
      writeScoreLog(p, scoreStr);
      console.log(`ScoreLog: Platz ${p} → ${scoreStr}`);
    }
  }
}

// ── Polling starten/stoppen ──

function startPolling() {
  if (pollingActive) return;
  pollingActive = true;
  console.log("Polling GESTARTET");
  pollScores();
}

function stopPolling() {
  if (!pollingActive) return;
  pollingActive = false;
  if (pollTimerId) {
    clearTimeout(pollTimerId);
    pollTimerId = null;
  }
  console.log("Polling GESTOPPT");
}

function updatePollingState() {
  const shouldPoll = courtActive["1"] || courtActive["2"];
  if (shouldPoll && !pollingActive) {
    startPolling();
  } else if (!shouldPoll && pollingActive) {
    stopPolling();
  }
}

// ── HTTP-Server (Health Check + Status + Aktiv-Signal) ──

const server = http.createServer((req, res) => {
  // CORS für Cloud Functions
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      pollingActive,
      courtActive,
      clients: clients.size,
      polls: pollCount,
      pushes: pushCount,
    }));
    return;
  }

  if (req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      pollingActive,
      courtActive,
      clients: clients.size,
      polls: pollCount,
      pushes: pushCount,
      lastData,
    }));
    return;
  }

  // POST /set-active — Signal von Cloud Function
  if (req.url === "/set-active" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        if (data.courts) {
          if (typeof data.courts["1"] !== "undefined") {
            courtActive["1"] = data.courts["1"] === 1 || data.courts["1"] === true;
          }
          if (typeof data.courts["2"] !== "undefined") {
            courtActive["2"] = data.courts["2"] === 1 || data.courts["2"] === true;
          }
        }
        console.log(`Aktiv-Signal empfangen: Platz1=${courtActive["1"]}, Platz2=${courtActive["2"]}`);
        updatePollingState();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, courtActive, pollingActive }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Scorer WebSocket Service running. Connect via ws://");
});

// ── WebSocket-Server ──
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`Client connected. Total: ${clients.size}`);

  // Sofort den letzten Stand senden
  if (lastData) {
    ws.send(JSON.stringify({ type: "scores", data: lastData }));
  }

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`Client disconnected. Total: ${clients.size}`);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
    clients.delete(ws);
  });
});

// ── Polling der externen JSON-Ressource ──
async function pollScores() {
  if (!pollingActive) return;

  try {
    const res = await fetch(COURT_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.text();
    pollCount++;

    // Nur bei Änderung an Clients pushen
    if (json !== lastJson) {
      lastJson = json;
      lastData = JSON.parse(json);
      pushCount++;

      // Score-Änderungen pro Platz loggen
      checkAndLogScoreChanges(lastData);

      const msg = JSON.stringify({ type: "scores", data: lastData });
      clients.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      });

      console.log(`Push #${pushCount} to ${clients.size} clients`);
    }
  } catch (err) {
    console.error("Poll error:", err.message);
  }

  // Nächsten Poll planen nur wenn noch aktiv
  if (pollingActive) {
    pollTimerId = setTimeout(pollScores, POLL_INTERVAL);
  }
}

// ── Initialer Aktiv-Status aus Firestore laden ──
async function fetchInitialStatus() {
  try {
    console.log("Lade initialen Aktiv-Status von Firestore...");
    const res = await fetch(SCOREBOARD_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    const result = await res.json();
    const courts = result?.result?.courts || {};

    if (courts["1"]) courtActive["1"] = courts["1"].aktiv === 1;
    if (courts["2"]) courtActive["2"] = courts["2"].aktiv === 1;

    console.log(`Initialer Status: Platz1=${courtActive["1"]}, Platz2=${courtActive["2"]}`);
    updatePollingState();
  } catch (err) {
    console.error("Fehler beim Laden des initialen Status:", err.message);
    // Service startet ohne Polling, wartet auf Signal
  }
}

// ── Start ──
server.listen(PORT, () => {
  console.log(`Scorer service running on port ${PORT}`);
  console.log(`Polling ${COURT_URL} every ${POLL_INTERVAL}ms (wenn aktiv)`);
  console.log(`ScoreLog → Sheet ${SHEET_ID} Tab "ScoreLog"`);

  // Initialen Status laden
  fetchInitialStatus();
});
