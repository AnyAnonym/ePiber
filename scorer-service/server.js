// ══════════════════════════════════════════════════════
// server.js — Scorer-Service Hauptserver
// Orchestriert: dataPoller, courtPoller, dataProvider
// HTTP-Endpoints: health, status, set-active
// ══════════════════════════════════════════════════════

const http = require("http");
const { PORT, SCOREBOARD_FUNCTION_URL } = require("./config.js");
const dataPoller = require("./dataPoller.js");
const courtPoller = require("./courtPoller.js");
const dataProvider = require("./dataProvider.js");
const dataStore = require("./dataStore.js");

// ── HTTP-Server ──

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health Check (kurz)
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      dataReady: dataStore.isReady(),
      court: courtPoller.getStatus(),
      provider: { clientCount: dataProvider.getStatus().clientCount },
      poller: { running: dataPoller.getStatus().running, tickCount: dataPoller.getStatus().tickCount },
    }));
    return;
  }

  // Ausführlicher Status
  if (req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      dataReady: dataStore.isReady(),
      court: courtPoller.getStatus(),
      provider: dataProvider.getStatus(),
      poller: dataPoller.getStatus(),
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
          courtPoller.setCourtActive(data.courts);
        }
        const status = courtPoller.getStatus();
        console.log(`set-active: Platz1=${status.courtActive["1"]}, Platz2=${status.courtActive["2"]}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, courtActive: status.courtActive, pollingActive: status.pollingActive }));
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

// ── Initialer Aktiv-Status aus Firestore laden ──

async function fetchInitialCourtStatus() {
  try {
    console.log("Lade initialen Court-Status...");
    const res = await fetch(SCOREBOARD_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    const result = await res.json();
    const courts = result?.result?.courts || {};

    const active = {};
    if (courts["1"]) active["1"] = courts["1"].aktiv === 1;
    if (courts["2"]) active["2"] = courts["2"].aktiv === 1;

    courtPoller.setCourtActive(active);
    console.log(`Initialer Court-Status: Platz1=${active["1"] || false}, Platz2=${active["2"] || false}`);
  } catch (err) {
    console.error("Court-Status laden fehlgeschlagen:", err.message);
  }
}

// ── Start ──

async function startup() {
  console.log("═══════════════════════════════════════");
  console.log("  Scorer-Service startet...");
  console.log("═══════════════════════════════════════");

  // 1. Spreadsheet-Daten initial laden
  await dataPoller.initialLoad();

  // 2. WebSocket-Provider initialisieren
  dataProvider.init(server);

  // 3. Daten-Polling starten
  dataPoller.start();

  // 4. Court-Status laden und Court-Polling ggf. starten
  await fetchInitialCourtStatus();

  // 5. HTTP-Server starten
  server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
    console.log(`Health:  http://localhost:${PORT}/health`);
    console.log(`Status:  http://localhost:${PORT}/status`);
    console.log("═══════════════════════════════════════");
  });
}

startup();
