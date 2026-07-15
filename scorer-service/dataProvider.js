// ══════════════════════════════════════════════════════
// dataProvider.js — WebSocket-Daten-Handler
// Nimmt Anfragen von Websites entgegen, filtert/merged
// Daten aus dataStore und sendet Ergebnisse zurück.
// Pusht Score-Updates und Datenänderungen an alle Clients.
// ══════════════════════════════════════════════════════

const { WebSocketServer } = require("ws");
const dataStore = require("./dataStore.js");
const courtPoller = require("./courtPoller.js");

let wss = null;
const clients = new Map(); // ws → { id, connectedAt, lastRequest }

let clientIdCounter = 0;

// ── Hilfsfunktionen ──

function getHeader(values) {
  if (!values || values.length < 1) return [];
  return values[0].map((h) => String(h || "").trim().toLowerCase());
}

function getHeaderIdx(header, name) {
  return header.indexOf(name);
}

function filterIgnored(values) {
  if (values.length < 2) return values;
  const header = getHeader(values);
  const ignIdx = getHeaderIdx(header, "ignorieren");
  if (ignIdx === -1) return values;
  const filtered = values.slice(1).filter((row) => String(row[ignIdx] || "").trim() !== "1");
  return [values[0], ...filtered];
}

function filterByField(values, fieldName, fieldValue) {
  if (!fieldValue) return values;
  if (values.length < 2) return values;
  const header = getHeader(values);
  const idx = getHeaderIdx(header, fieldName);
  if (idx === -1) return values;
  const filtered = values.slice(1).filter((row) => String(row[idx] || "").trim() === String(fieldValue).trim());
  return [values[0], ...filtered];
}

function buildPlayerMap(playerValues) {
  const map = new Map();
  if (playerValues.length < 2) return map;
  const header = getHeader(playerValues);
  const idIdx = getHeaderIdx(header, "id");
  const fnIdx = getHeaderIdx(header, "vorname");
  const lnIdx = getHeaderIdx(header, "nachname");
  if (idIdx === -1) return map;
  playerValues.slice(1).forEach((r) => {
    const id = String(r[idIdx] || "").trim();
    const name = [r[fnIdx] || "", r[lnIdx] || ""].map((s) => String(s).trim()).filter(Boolean).join(" ");
    if (id) map.set(id, name);
  });
  return map;
}

// ── Vordefinierte Endpoints ──

const endpoints = {

  players(params) {
    return { success: true, values: dataStore.get("players") };
  },

  bewerbe(params) {
    const bewerbe = dataStore.get("bewerbe");
    const bewerbsart = dataStore.get("bewerbsart");
    return { success: true, values: bewerbe, bewerbsartValues: bewerbsart };
  },

  bewerbsart(params) {
    return { success: true, values: dataStore.get("bewerbsart") };
  },

  preMatches(params) {
    let values = dataStore.get("preMatches");
    if (params?.filterIgnored !== false) values = filterIgnored(values);
    if (params?.bewerbId) values = filterByField(values, "bewerbid", params.bewerbId);
    return { success: true, values };
  },

  matches(params) {
    let values = dataStore.get("matches");
    if (params?.filterIgnored !== false) values = filterIgnored(values);
    if (params?.bewerbId) values = filterByField(values, "bewerbid", params.bewerbId);
    return { success: true, values };
  },

  matchTyp(params) {
    return { success: true, values: dataStore.get("matchTyp") };
  },

  rlPlatzierung(params) {
    let values = dataStore.get("rlPlatzierung");
    if (params?.bewerbId) values = filterByField(values, "bewerbid", params.bewerbId);
    return { success: true, values };
  },

  navigator(params) {
    let values = dataStore.get("navigator");
    // Profil-Filterung
    if (params?.profil) {
      if (values.length >= 2) {
        const header = getHeader(values);
        const profilIdx = getHeaderIdx(header, "profil");
        if (profilIdx >= 0) {
          const filtered = values.slice(1).filter((row) =>
            String(row[profilIdx] || "1").trim() === String(params.profil).trim());
          values = [values[0], ...filtered];
        }
      }
    }
    return { success: true, values };
  },

  entryList(params) {
    let values = dataStore.get("entryList");
    if (params?.bewerbId) values = filterByField(values, "bewerbid", params.bewerbId);
    // Spielernamen auflösen
    const playerMap = buildPlayerMap(dataStore.get("players"));
    return { success: true, values, playerMap: Object.fromEntries(playerMap) };
  },

  roundRobin(params) {
    const preMatches = filterIgnored(dataStore.get("preMatches"));
    const matches = filterIgnored(dataStore.get("matches"));
    const players = dataStore.get("players");
    const bewerbe = dataStore.get("bewerbe");
    const bewerbsart = dataStore.get("bewerbsart");
    return {
      success: true,
      preMatchesValues: preMatches,
      matchesValues: matches,
      playerValues: players,
      bewerbValues: bewerbe,
      bewerbsartValues: bewerbsart,
    };
  },

  bracket(params) {
    const preMatches = filterIgnored(dataStore.get("preMatches"));
    const matches = filterIgnored(dataStore.get("matches"));
    const players = dataStore.get("players");
    const bewerbe = dataStore.get("bewerbe");
    const bewerbsart = dataStore.get("bewerbsart");
    return {
      success: true,
      preMatchesValues: preMatches,
      matchesValues: matches,
      playerValues: players,
      bewerbValues: bewerbe,
      bewerbsartValues: bewerbsart,
    };
  },

  scoreboard(params) {
    const preMatches = filterIgnored(dataStore.get("preMatches"));
    const matches = filterIgnored(dataStore.get("matches"));
    const players = dataStore.get("players");
    const bewerbe = dataStore.get("bewerbe");
    return {
      success: true,
      preMatchesValues: preMatches,
      matchesValues: matches,
      playerValues: players,
      bewerbValues: bewerbe,
    };
  },

  courtScores(params) {
    const lastData = courtPoller.getLastData();
    return { success: true, data: lastData };
  },
};

// ── WebSocket-Handler ──

function handleMessage(ws, raw) {
  try {
    const msg = JSON.parse(raw);

    // Pong vom Client → Client ist noch da
    if (msg.type === "pong") {
      const info = clients.get(ws);
      if (info) info.lastPong = Date.now();
      return;
    }

    if (msg.type === "request" && msg.endpoint) {
      const handler = endpoints[msg.endpoint];
      if (!handler) {
        sendToClient(ws, { type: "response", id: msg.id, endpoint: msg.endpoint, data: { success: false, error: "Unbekannter Endpoint" } });
        return;
      }
      const data = handler(msg.params || {});
      sendToClient(ws, { type: "response", id: msg.id, endpoint: msg.endpoint, data });

      // Client-Info aktualisieren
      const info = clients.get(ws);
      if (info) info.lastRequest = { endpoint: msg.endpoint, at: Date.now() };
    }
  } catch (err) {
    console.error("dataProvider: Message-Fehler:", err.message);
  }
}

function sendToClient(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastToAll(msg) {
  const json = JSON.stringify(msg);
  clients.forEach((info, ws) => {
    if (ws.readyState === ws.OPEN) ws.send(json);
  });
}

// ── Score-Push (von courtPoller) ──

function onScoreChange(data) {
  broadcastToAll({ type: "scores", data });
}

// ── Client-Info für Status ──

function getClientList() {
  const list = [];
  clients.forEach((info, ws) => {
    list.push({
      id: info.id,
      connectedAt: info.connectedAt,
      lastRequest: info.lastRequest,
      readyState: ws.readyState,
    });
  });
  return list;
}

function getStatus() {
  return {
    clientCount: clients.size,
    clients: getClientList(),
  };
}

// ── Init ──

function init(server) {
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    clientIdCounter++;
    const info = { id: clientIdCounter, connectedAt: new Date().toISOString(), lastRequest: null, lastPong: Date.now() };
    clients.set(ws, info);
    console.log(`dataProvider: Client #${info.id} verbunden. Total: ${clients.size}`);

    // Letzten Score-Stand sofort senden
    const lastScores = courtPoller.getLastData();
    if (lastScores) {
      sendToClient(ws, { type: "scores", data: lastScores });
    }

    ws.on("message", (raw) => handleMessage(ws, raw));

    ws.on("close", () => {
      console.log(`dataProvider: Client #${info.id} getrennt. Total: ${clients.size - 1}`);
      clients.delete(ws);
    });

    ws.on("error", (err) => {
      console.error(`dataProvider: Client #${info.id} Fehler:`, err.message);
      clients.delete(ws);
    });
  });

  // Court-Score Push registrieren
  courtPoller.setOnScoreChange(onScoreChange);

  // Ping alle 30 Sekunden an alle Clients → hält Verbindung offen
  const PING_INTERVAL = 30000;
  const DEAD_CLIENT_TIMEOUT = 90000; // 3x Ping ohne Pong → tot

  setInterval(() => {
    const now = Date.now();
    clients.forEach((info, ws) => {
      // Tote Clients entfernen (kein Pong seit 90s)
      if (now - info.lastPong > DEAD_CLIENT_TIMEOUT) {
        console.log(`dataProvider: Client #${info.id} tot (kein Pong). Entfernt.`);
        ws.terminate();
        clients.delete(ws);
        return;
      }
      // Ping senden
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    });
  }, PING_INTERVAL);

  console.log("dataProvider: WebSocket-Server initialisiert (Ping alle 30s)");
}

module.exports = { init, getStatus, broadcastToAll, getClientList };
