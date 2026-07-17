// ══════════════════════════════════════════════════════
// dataProvider.js — WebSocket-Daten-Handler
// Nimmt Anfragen von Websites entgegen, filtert/merged
// Daten aus dataStore und sendet Ergebnisse zurück.
// Pusht Score-Updates und Datenänderungen an alle Clients.
// ══════════════════════════════════════════════════════

const { WebSocketServer } = require("ws");
const { google } = require("googleapis");
const dataStore = require("./dataStore.js");
const stateStore = require("./stateStore.js");
const courtPoller = require("./courtPoller.js");
const { SHEET_ID } = require("./config.js");

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
  const ignIdx = getHeaderIdx(header, "ignore") !== -1 ? getHeaderIdx(header, "ignore") : getHeaderIdx(header, "ignorieren");
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

// ── Google Sheets Write Client ──
let sheetsWriteClient = null;

async function getWriteClient() {
  if (sheetsWriteClient) return sheetsWriteClient;
  const auth = new google.auth.GoogleAuth({scopes: ["https://www.googleapis.com/auth/spreadsheets"]});
  sheetsWriteClient = google.sheets({version: "v4", auth});
  return sheetsWriteClient;
}

// Gewinner aus Ergebnis ermitteln
function determineWinnerFromResult(ergebnis, p1Id, p3Id) {
  if (!ergebnis || !p1Id || !p3Id) return "";
  const sets = String(ergebnis).trim().split("/").filter(Boolean);
  let w1 = 0, w3 = 0;
  for (const s of sets) {
    const clean = s.replace(/\(\d+\)/g, "").replace(/\[ret\]/gi, "").trim();
    const parts = clean.split("-").map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      if (parts[0] > parts[1]) w1++;
      else if (parts[1] > parts[0]) w3++;
    }
  }
  if (w1 > w3) return p1Id;
  if (w3 > w1) return p3Id;
  return "";
}

function parsePlayerId(raw) {
  const s = String(raw || "").trim();
  return s.replace(/\[w\.?o\.?\]/gi, "").replace(/\[ret\]/gi, "").replace(/\[gesetzt\]/gi, "").trim();
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

  // Einzelner Endpoint für alle Matches (ersetzt preMatches + matches)
  matches1(params) {
    let values = dataStore.get("matches1");
    if (params?.filterIgnored !== false) values = filterIgnored(values);
    if (params?.bewerbId) values = filterByField(values, "bewerbid", params.bewerbId);
    return { success: true, values };
  },

  // Kompatibilitäts-Endpoints (leiten auf matches1 um)
  preMatches(params) {
    return endpoints.matches1(params);
  },

  matches(params) {
    return endpoints.matches1(params);
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
    const playerMap = buildPlayerMap(dataStore.get("players"));
    return { success: true, values, playerMap: Object.fromEntries(playerMap) };
  },

  roundRobin(params) {
    const matches1 = filterIgnored(dataStore.get("matches1"));
    const players = dataStore.get("players");
    const bewerbe = dataStore.get("bewerbe");
    const bewerbsart = dataStore.get("bewerbsart");
    return {
      success: true,
      matchesValues: matches1,
      playerValues: players,
      bewerbValues: bewerbe,
      bewerbsartValues: bewerbsart,
    };
  },

  bracket(params) {
    const matches1 = filterIgnored(dataStore.get("matches1"));
    const players = dataStore.get("players");
    const bewerbe = dataStore.get("bewerbe");
    const bewerbsart = dataStore.get("bewerbsart");
    return {
      success: true,
      matchesValues: matches1,
      playerValues: players,
      bewerbValues: bewerbe,
      bewerbsartValues: bewerbsart,
    };
  },

  scoreboard(params) {
    const matches1 = filterIgnored(dataStore.get("matches1"));
    const players = dataStore.get("players");
    const bewerbe = dataStore.get("bewerbe");
    return {
      success: true,
      matchesValues: matches1,
      playerValues: players,
      bewerbValues: bewerbe,
    };
  },

  courtScores(params) {
    const lastData = courtPoller.getLastData();
    return {success: true, data: lastData};
  },

  // ══ STATE ENDPOINTS (ersetzt Firestore) ══

  getScoreboardCourts() {
    return {success: true, courts: stateStore.getScoreboardCourts()};
  },

  async setScoreboardCourt(params) {
    const {court, matchId, bewerb, homePlayer, guestPlayer, dateTime, aktiv, runde} = params || {};
    if (!court || (court !== "1" && court !== "2")) return {success: false, error: "court muss '1' oder '2' sein"};
    stateStore.setScoreboardCourt(court, {matchId, bewerb, homePlayer, guestPlayer, dateTime, runde, aktiv});
    // Court-Poller Aktiv-Status aktualisieren
    const courts = stateStore.getScoreboardCourts();
    courtPoller.setCourtActive({"1": courts["1"].aktiv === 1, "2": courts["2"].aktiv === 1});
    return {success: true};
  },

  getNavigatorTarget() {
    const s = stateStore.getNavigatorTarget();
    return {success: true, path: s.target, status: s.status};
  },

  setNavigatorTarget(params) {
    const {path, status} = params || {};
    stateStore.setNavigatorTarget(path, status);
    return {success: true};
  },

  getNavigatorScroll() {
    const s = stateStore.getNavigatorScroll();
    return {success: true, amount: s.amount, ts: s.ts};
  },

  setNavigatorScroll(params) {
    const {amount} = params || {};
    if (typeof amount !== "number") return {success: false, error: "amount erforderlich"};
    stateStore.setNavigatorScroll(amount);
    return {success: true};
  },

  // ══ SCHREIB ENDPOINTS (Spreadsheet) ══

  async verifyUserLogin(params) {
    const {email, passwordHash} = params || {};
    if (!email || !passwordHash) return {success: false, error: "email und passwordHash erforderlich"};
    const values = dataStore.get("players");
    if (values.length < 2) return {success: true, valid: false};
    const header = getHeader(values);
    const emailIdx = getHeaderIdx(header, "e-mail") !== -1 ? getHeaderIdx(header, "e-mail") : getHeaderIdx(header, "email");
    const pwIdx = getHeaderIdx(header, "passwdhash");
    if (emailIdx === -1 || pwIdx === -1) return {success: true, valid: false};
    const row = values.slice(1).find((r) =>
      String(r[emailIdx] || "").trim().toLowerCase() === email.trim().toLowerCase());
    if (!row) return {success: true, valid: false};
    const storedHash = String(row[pwIdx] || "").trim();
    return {success: true, valid: storedHash === passwordHash};
  },

  async resetPassword(params) {
    const {email, passwordHash} = params || {};
    if (!email || !passwordHash) return {success: false, error: "email und passwordHash erforderlich"};
    try {
      const sheets = await getWriteClient();
      const values = dataStore.get("players");
      if (values.length < 2) return {success: false, error: "Keine Spieler"};
      const header = getHeader(values);
      const emailIdx = getHeaderIdx(header, "e-mail") !== -1 ? getHeaderIdx(header, "e-mail") : getHeaderIdx(header, "email");
      const pwIdx = getHeaderIdx(header, "passwdhash");
      const kvIdx = getHeaderIdx(header, "kennwortvergessen");
      if (emailIdx === -1 || pwIdx === -1) return {success: false, error: "Spalte nicht gefunden"};
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][emailIdx] || "").trim().toLowerCase() === email.trim().toLowerCase()) {
          // Prüfen ob Kennwort-Vergessen freigegeben ist
          if (kvIdx === -1 || String(values[i][kvIdx] || "").trim().toLowerCase() !== "x") {
            return {success: false, error: "Bitte bei Administrator Freigabe einholen"};
          }
          // Passwort setzen
          const pwCell = `Personen!${String.fromCharCode(65 + pwIdx)}${i + 1}`;
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID, range: pwCell,
            valueInputOption: "USER_ENTERED", requestBody: {values: [[passwordHash]]},
          });
          // "x" aus KennwortVergessen löschen
          const kvCell = `Personen!${String.fromCharCode(65 + kvIdx)}${i + 1}`;
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID, range: kvCell,
            valueInputOption: "USER_ENTERED", requestBody: {values: [[""]]},
          });
          return {success: true};
        }
      }
      return {success: false, error: "Benutzer nicht gefunden"};
    } catch (err) {
      return {success: false, error: err.message};
    }
  },

  async setMatchDate(params) {
    const {row, datum} = params || {};
    if (!row || !datum) return {success: false, error: "row und datum erforderlich"};
    try {
      const sheets = await getWriteClient();
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `Matches1!C${row}`,
        valueInputOption: "USER_ENTERED", requestBody: {values: [[datum]]},
      });
      return {success: true};
    } catch (err) {
      return {success: false, error: err.message};
    }
  },

  async setPreMatchResult(params) {
    const {row, satz1, satz2, satz3, userId} = params || {};
    if (!row) return {success: false, error: "row erforderlich"};
    try {
      const sheets = await getWriteClient();
      const satzParts = [satz1, satz2, satz3].filter(Boolean);
      const ergebnis = satzParts.map((s) => s.replace(/:/g, "-")).join("/");
      // Ergebnis in Spalte M (13. Spalte, Index 12) schreiben
      const values = dataStore.get("matches1");
      if (values.length < 2) return {success: false, error: "Keine Matches"};
      const header = getHeader(values);
      const ergebnisIdx = getHeaderIdx(header, "ergebnis");
      if (ergebnisIdx === -1) return {success: false, error: "Ergebnis-Spalte nicht gefunden"};
      const col = String.fromCharCode(65 + ergebnisIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `Matches1!${col}${row}`,
        valueInputOption: "USER_ENTERED", requestBody: {values: [[ergebnis]]},
      });
      return {success: true};
    } catch (err) {
      return {success: false, error: err.message};
    }
  },

  async addMatch(params) {
    const {bewerbId, p1id, p2id, p3id, p4id, forderungDate} = params || {};
    if (!p1id || !p3id) return {success: false, error: "Spieler erforderlich"};
    try {
      const sheets = await getWriteClient();
      const values = dataStore.get("matches1");
      let newId = 1;
      if (values.length > 1) {
        const header = getHeader(values);
        const idIdx = getHeaderIdx(header, "id");
        if (idIdx >= 0) {
          const ids = values.slice(1).map((r) => parseFloat(r[idIdx])).filter((n) => !isNaN(n) && n > 0);
          if (ids.length > 0) newId = Math.max(...ids) + 1;
        }
      }
      // Matches1: Ignore, ID, MatchDate, ForderungDate, Dauer, BewerbID, BewerbRunde, MatchtypID, Spieler1ID-4ID, Ergebnis, PTN, Bemerkung
      const newRow = ["", newId, "", forderungDate || "", "", bewerbId || "", "", "", p1id, p2id || "", p3id, p4id || "", "", "", ""];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: "Matches1",
        valueInputOption: "USER_ENTERED", requestBody: {values: [newRow]},
      });
      return {success: true, newMatchId: newId};
    } catch (err) {
      return {success: false, error: err.message};
    }
  },

  async addEntryList(params) {
    const {bewerbId, personenId, datum} = params || {};
    if (!bewerbId || !personenId) return {success: false, error: "bewerbId und personenId erforderlich"};
    try {
      const sheets = await getWriteClient();
      const values = dataStore.get("entryList");
      let newId = 1;
      if (values.length > 1) {
        const header = getHeader(values);
        const idIdx = getHeaderIdx(header, "id");
        if (idIdx >= 0) {
          const ids = values.slice(1).map((r) => parseFloat(r[idIdx])).filter((n) => !isNaN(n) && n > 0);
          if (ids.length > 0) newId = Math.max(...ids) + 1;
        }
      }
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: "EntryList",
        valueInputOption: "USER_ENTERED", requestBody: {values: [[newId, bewerbId, personenId, datum || ""]]},
      });
      return {success: true};
    } catch (err) {
      return {success: false, error: err.message};
    }
  },

  async removeEntryList(params) {
    const {bewerbId, personenId} = params || {};
    if (!bewerbId || !personenId) return {success: false, error: "bewerbId und personenId erforderlich"};
    try {
      const sheets = await getWriteClient();
      const values = dataStore.get("entryList");
      if (values.length < 2) return {success: false, error: "Keine Einträge"};
      const header = getHeader(values);
      const bIdx = getHeaderIdx(header, "bewerbid") !== -1 ? getHeaderIdx(header, "bewerbid") : header.findIndex((h) => ["bewerbid", "bewerb id"].includes(h));
      const pIdx = header.findIndex((h) => ["personenid", "personen id", "personid", "playerid", "spielerid"].includes(h));
      if (bIdx === -1 || pIdx === -1) return {success: false, error: "Spalten nicht gefunden"};
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][bIdx] || "").trim() === String(bewerbId).trim() &&
            String(values[i][pIdx] || "").trim() === String(personenId).trim()) {
          const spreadsheet = await sheets.spreadsheets.get({spreadsheetId: SHEET_ID});
          const sheet = spreadsheet.data.sheets.find((s) => s.properties.title === "EntryList");
          if (!sheet) return {success: false, error: "EntryList Tab nicht gefunden"};
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {requests: [{deleteDimension: {range: {sheetId: sheet.properties.sheetId, dimension: "ROWS", startIndex: i, endIndex: i + 1}}}]},
          });
          return {success: true};
        }
      }
      return {success: false, error: "Eintrag nicht gefunden"};
    } catch (err) {
      return {success: false, error: err.message};
    }
  },

  async withdrawFromRanking(params) {
    const {reason, rank, bewerbId} = params || {};
    try {
      const sheets = await getWriteClient();
      const values = dataStore.get("players");
      const playerMap = buildPlayerMap(values);
      const userId = params.userId || "";
      const playerName = playerMap.get(userId) || userId;
      // Log schreiben
      const now = new Date();
      const ts = String(now.getFullYear()).slice(-2) + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + "-" + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + "-" + String(now.getSeconds()).padStart(2, "0");
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: "Logging",
        valueInputOption: "USER_ENTERED", requestBody: {values: [[ts, "withdrawFromRanking", `Rückzug: ${playerName} (Rang ${rank}, Bewerb ${bewerbId}) — ${reason}`]]},
      });
      return {success: true};
    } catch (err) {
      return {success: false, error: err.message};
    }
  },

  readMatchRestrictions(params) {
    const bewerbId = params?.bewerbId ? String(params.bewerbId).trim() : null;
    const values = dataStore.get("matches1");
    if (values.length < 2) return {success: true, schutzzeit: [], sperrzeit: []};
    const header = getHeader(values);
    const matchDateIdx = getHeaderIdx(header, "matchdate");
    const s1Idx = getHeaderIdx(header, "spieler1id");
    const s3Idx = getHeaderIdx(header, "spieler3id");
    const ergebnisIdx = getHeaderIdx(header, "ergebnis");
    const bewerbIdx = getHeaderIdx(header, "bewerbid");
    if ([matchDateIdx, s1Idx, s3Idx, ergebnisIdx].includes(-1)) return {success: true, schutzzeit: [], sperrzeit: []};
    const now = new Date();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const schutzzeitMap = new Map();
    const sperrzeitMap = new Map();
    values.slice(1).forEach((row) => {
      if (bewerbId && bewerbIdx !== -1 && String(row[bewerbIdx] || "").trim() !== bewerbId) return;
      const rawDate = String(row[matchDateIdx] || "").trim();
      if (!rawDate) return;
      const m = rawDate.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
      if (!m) return;
      const [, yy, mm, dd, hh, mi] = m;
      const yyyy = parseInt(yy) >= 50 ? "19" + yy : "20" + yy;
      const matchDate = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00`);
      const endDate = new Date(matchDate.getTime() + SEVEN_DAYS);
      if (endDate <= now) return;
      const p1 = parsePlayerId(row[s1Idx]);
      const p3 = parsePlayerId(row[s3Idx]);
      const ergebnis = String(row[ergebnisIdx] || "").trim();
      if (!p1 || !p3 || !ergebnis) return;
      const winner = determineWinnerFromResult(ergebnis, p1, p3);
      if (!winner) return;
      const loser = winner === p1 ? p3 : p1;
      const es = schutzzeitMap.get(winner);
      if (!es || es.matchDate < matchDate) schutzzeitMap.set(winner, {endDate, matchDate});
      const esp = sperrzeitMap.get(winner);
      if (esp && esp.matchDate < matchDate) sperrzeitMap.delete(winner);
      const esl = sperrzeitMap.get(loser);
      if (!esl || esl.matchDate < matchDate) sperrzeitMap.set(loser, {endDate, matchDate});
      const escl = schutzzeitMap.get(loser);
      if (escl && escl.matchDate < matchDate) schutzzeitMap.delete(loser);
    });
    const toEntry = ([id, val]) => ({id, until: val.endDate.toISOString()});
    return {success: true, schutzzeit: Array.from(schutzzeitMap.entries()).map(toEntry), sperrzeit: Array.from(sperrzeitMap.entries()).map(toEntry)};
  },

  getMyChallenges(params) {
    const {userId} = params || {};
    if (!userId) return {success: true, challenges: []};
    const values = dataStore.get("matches1");
    if (values.length < 2) return {success: true, challenges: []};
    const header = getHeader(values);
    const p1Idx = getHeaderIdx(header, "spieler1id");
    const p3Idx = getHeaderIdx(header, "spieler3id");
    const ergebnisIdx = getHeaderIdx(header, "ergebnis");
    const matchDateIdx = getHeaderIdx(header, "matchdate");
    const playerMap = buildPlayerMap(dataStore.get("players"));
    const challenges = [];
    values.slice(1).forEach((row, idx) => {
      const erg = ergebnisIdx >= 0 ? String(row[ergebnisIdx] || "").trim() : "";
      if (erg) return;
      const p1 = parsePlayerId(row[p1Idx]);
      const p3 = p3Idx >= 0 ? parsePlayerId(row[p3Idx]) : "";
      if (p1 !== userId && p3 !== userId) return;
      const opponent = p1 === userId ? p3 : p1;
      challenges.push({row: idx + 2, player3: playerMap.get(opponent) || opponent, matchDate: String(row[matchDateIdx] || "").trim()});
    });
    return {success: true, challenges};
  },
};

// ── WebSocket-Handler ──

async function handleMessage(ws, raw) {
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
        sendToClient(ws, {type: "response", id: msg.id, endpoint: msg.endpoint, data: {success: false, error: "Unbekannter Endpoint"}});
        return;
      }
      const data = await handler(msg.params || {});
      sendToClient(ws, {type: "response", id: msg.id, endpoint: msg.endpoint, data});

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
