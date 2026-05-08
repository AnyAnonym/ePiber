/* eslint-disable valid-jsdoc */
/* eslint-disable no-unused-vars */
/* eslint-disable require-jsdoc */
/* eslint-disable max-len */
// 🔹 index.js (ES Module Syntax)
// Hinweis: funktioniert nur, weil in package.json =>  "type": "module"
import {onCall} from "firebase-functions/v2/https";
import {google} from "googleapis";
// import fs from "fs";

// const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const SHEET_ID = "1E1CYezDcScIBvH9ebjN0hOkvttTdA6PFIgYKDMaeE04";

/**
 * Konvertiert JJMMDD-hhmm zu DD.MM.JJJJ - hh:mm
 */
function formatSheetDate(raw) {
  if (!raw) return "";
  const rawStr = String(raw).trim();
  const match = rawStr.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!match) return rawStr;
  const [, yy, mm, dd, hh, mi] = match;
  const yyyy = parseInt(yy, 10) >= 50 ? "19" + yy : "20" + yy;
  return `${dd}.${mm}.${yyyy} - ${hh}:${mi}`;
}

/**
 * Konvertiert Satz-Ergebnis: 7(13) → 7¹³, 6:4 bleibt 6:4
 */
function formatSetScore(raw) {
  if (!raw) return "";
  return String(raw).replace(/\((\d+)\)/g, (_, tiebreak) => {
    const superscripts = {"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹"};
    const sup = tiebreak.split("").map((d) => superscripts[d] || d).join("");
    return sup;
  });
}

/**
 * Formatiert ein ganzes Ergebnis (6:4/7(13)/6:2 → 6:4/7¹³/6:2)
 */
function formatErgebnis(raw) {
  if (!raw) return "";
  return String(raw).split("/").map((s) => formatSetScore(s)).join("/");
}

// 🔹 Testfunktion
export const sayHello = onCall(() => {
  return "Hello World!";
});

/**
 * Liest die komplette "Personen"-Tabelle aus Google Sheets.
 */
export const readPlayersList = onCall(async () => {
  try {
    console.log("🔄 Initializing Google Sheets client...");
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Personen",
    });

    return {success: true, values: res.data.values || []};
  } catch (err) {
    console.error("❌ Error reading Google Sheet:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Liest die "matches"-Tabelle aus Google Sheets.
 */
export const readMatchesList = onCall(async () => {
  try {
    console.log("🔄 Initializing Google Sheets client...");
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "matches",
    });

    return {success: true, values: res.data.values || []};
  } catch (err) {
    console.error("❌ Error reading Google Sheet:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Kombiniert Matches (mit Spieler‑IDs) und Players‑Tab zu vollständigen Match‑Objekten.
 * Unterstützt jetzt 3 Sätze!
 */
export const readFullMatches = onCall(async () => {
  try {
    console.log("✅ readFullMatches gestartet (3‑Satz‑Version)…");
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    // --- Tabellen abrufen ---
    const [matchesRes, playersRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "matches",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "Personen",
      }),
    ]);

    const matchesValues = matchesRes.data.values || [];
    const playersValues = playersRes.data.values || [];
    if (matchesValues.length < 2 || playersValues.length < 2) {
      throw new Error("Leere Tabellen (matches oder Personen).");
    }

    // --- Header finden ---
    const header = matchesValues[0].map((h) => h.trim().toLowerCase());
    const playerHeader = playersValues[0].map((h) => h.trim().toLowerCase());

    const idIndex = playerHeader.indexOf("id");
    const fnIndex = playerHeader.indexOf("vorname");
    const lnIndex = playerHeader.indexOf("nachname");

    // --- ID → Name Map ---
    const playerMap = new Map();
    playersValues.slice(1).forEach((r) => {
      const id = r[idIndex];
      const name = `${r[fnIndex] || ""} ${r[lnIndex] || ""}`.trim();
      playerMap.set(id, name);
    });

    // --- Spaltenindizes dynamisch ermitteln ---
    const idx = (label) => header.findIndex((v) => v.includes(label));

    const i1 = idx("spielerid1");
    const i2 = idx("spielerid2");
    const i3 = idx("spielerid3");
    const i4 = idx("spielerid4");
    const ergebnisIdx = idx("ergebnis");
    const d = idx("zeitpunkt");

    // --- Matches mappen ---
    const startRow = header[0].toLowerCase().includes("spieler") ? 1 : 0;
    const allMatches = matchesValues.slice(startRow).map((row) => {
      const ergebnisRaw = row[ergebnisIdx] || "";
      const sets = ergebnisRaw ? ergebnisRaw.split("/").map((s) => formatSetScore(s)) : [];

      return {
        date: formatSheetDate(row[d]),
        players: [
          playerMap.get(row[i1]) || "---",
          playerMap.get(row[i2]) || "---",
          playerMap.get(row[i3]) || "---",
          playerMap.get(row[i4]) || "---",
        ],
        sets,
        ergebnis: formatErgebnis(ergebnisRaw),
      };
    });

    console.log(`🏁 ${allMatches.length} Matches verarbeitet.`);
    return {success: true, matches: allMatches};
  } catch (err) {
    console.error("❌ Fehler in readFullMatches (3‑Satz‑Version):", err);
    return {success: false, error: err.message};
  }
});

/**
 * Fügt ein Match in die "matches"-Tabelle ein.
 */
export const addMatch = onCall(async (request) => {
  try {
    const {
      player1Id,
      player2Id = "",
      player3Id,
      player4Id = "",
      bewerbId = "2",
    } = request.data || {};

    if (!player1Id || !player3Id) {
      return {
        success: false,
        error: "player1Id und player3Id müssen gesetzt sein",
      };
    }

    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({version: "v4", auth});

    // optional: IDs existieren in Personen
    const playersRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Personen",
    });

    const players = playersRes.data.values || [];
    if (players.length < 2) {
      return {success: false, error: "Keine Spieler in Personen-Tabelle gefunden."};
    }

    const header = players[0].map((h) => (h || "").trim().toLowerCase());
    const idIdx = header.indexOf("id");
    if (idIdx === -1) {
      return {success: false, error: "Personen-Tabelle muss Spalte ID enthalten."};
    }

    const validIds = new Set(players.slice(1).map((r) => (r[idIdx] || "").toString().trim()));

    const missingIds = [];
    if (!validIds.has(player1Id.toString().trim())) missingIds.push(`player1Id '${player1Id}'`);
    if (!validIds.has(player3Id.toString().trim())) missingIds.push(`player3Id '${player3Id}'`);
    if (player2Id && !validIds.has(player2Id.toString().trim())) missingIds.push(`player2Id '${player2Id}'`);
    if (player4Id && !validIds.has(player4Id.toString().trim())) missingIds.push(`player4Id '${player4Id}'`);

    if (missingIds.length > 0) {
      return {success: false, error: `ID(s) nicht gefunden: ${missingIds.join(", ")}`};
    }

    const p1id = player1Id.toString().trim();
    const p2id = player2Id.toString().trim();
    const p3id = player3Id.toString().trim();
    const p4id = player4Id.toString().trim();
    const resolvedBewerbId = bewerbId.toString().trim() || "2";

    // 🔹 Lese preMatches und matches für Validierungen
    const [preRes, matchesRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "preMatches",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "matches",
      }),
    ]);

    const preRows = preRes.data.values || [];
    const matchesRows = matchesRes.data.values || [];

    // --- Prüfe offene Forderungen ---
    if (preRows.length > 1) {
      const preHeader = preRows[0].map((h) => h.trim().toLowerCase());
      const i1 = preHeader.indexOf("spielerid1");
      const i2 = preHeader.indexOf("spielerid2");
      const i3 = preHeader.indexOf("spielerid3");
      const i4 = preHeader.indexOf("spielerid4");
      const d = preHeader.indexOf("zeitpunktmatch");

      for (let i = 1; i < preRows.length; i++) {
        const row = preRows[i];
        // Nur offene (kein ZeitpunktMatch) berücksichtigen
        if (!row[d] || row[d] === "") {
          const existing1 = String(row[i1] || "").trim();
          const existing2 = String(row[i2] || "").trim();
          const existing3 = String(row[i3] || "").trim();
          const existing4 = String(row[i4] || "").trim();

          if (existing1 === p1id || existing1 === p3id ||
              existing2 === p1id || existing2 === p3id ||
              existing3 === p1id || existing3 === p3id ||
              existing4 === p1id || existing4 === p3id) {
            return {success: false, error: "Einer der Spieler hat bereits eine offene Forderung!"};
          }
        }
      }
    }

    // --- Prüfe 7-Tage-Regeln (Schutzzeit nach Sieg, Sperrzeit nach Niederlage) ---
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    if (matchesRows.length > 1) {
      const matchesHeader = matchesRows[0].map((h) => h.trim().toLowerCase());
      const mi1 = matchesHeader.indexOf("spielerid1");
      const mi3 = matchesHeader.indexOf("spielerid3");
      const md = matchesHeader.indexOf("zeitpunkt");
      const mergebnis = matchesHeader.indexOf("ergebnis");

      for (let i = 1; i < matchesRows.length; i++) {
        const row = matchesRows[i];
        const matchDate = row[md] ? new Date(row[md]) : null;

        if (matchDate && matchDate >= sevenDaysAgo) {
          const m1 = String(row[mi1] || "").trim();
          const m3 = String(row[mi3] || "").trim();
          const ergebnis = String(row[mergebnis] || "").trim();

          // Prüfe ob es ein abgeschlossenes Match ist
          if (ergebnis && ergebnis.includes("/")) { // Minimum 2 Sätze (getrennt durch /)
            // --- Schutzzeit: p3id (Geforderte) nach Sieg ---
            if (m3 === p3id) {
              return {success: false, error: "Geforderte(r) steht unter Schutzzeit (7 Tage nach Sieg)"};
            }

            // --- Sperrzeit: p1id (Forderer) nach Niederlage ---
            if (m1 === p1id) {
              return {success: false, error: "Sie stehen unter Sperrzeit (7 Tage nach Niederlage)"};
            }
          }
        }
      }
    }

    // Daten in preMatches schreiben (neue Struktur!)
    // Spalten: A=ID, B=ZeitpunktMatch, C=ZeitpunktForderung, D=BewerbID, E=MatchtypID, F=SpielerID1, G=SpielerID2, H=SpielerID3, I=SpielerID4, J=status
    const preHeader = preRows[0].map((h) => h.trim().toLowerCase());
    const idIdxPre = preHeader.indexOf("id");

    // Neue ID berechnen
    const numericIdsPre = preRows.slice(1)
        .map((r) => parseFloat(r[idIdxPre]))
        .filter((n) => !isNaN(n) && n > 0);
    const lastIdPre = numericIdsPre.length > 0 ? Math.max(...numericIdsPre) : 0;
    const newIdPre = lastIdPre + 1;

    // ZeitpunktForderung vom Client übernehmen oder serverseitig (UTC) generieren
    let zeitpunktForderung = request.data.zeitpunktForderung;

    if (!zeitpunktForderung) {
      const jetzt = new Date();
      const yy = String(jetzt.getFullYear()).slice(2);
      const mm = String(jetzt.getMonth() + 1).padStart(2, "0");
      const dd = String(jetzt.getDate()).padStart(2, "0");
      const hh = String(jetzt.getHours()).padStart(2, "0");
      const mi = String(jetzt.getMinutes()).padStart(2, "0");
      zeitpunktForderung = `${yy}${mm}${dd}-${hh}${mi}`;
    }

    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "preMatches",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[newIdPre, "", zeitpunktForderung, resolvedBewerbId, "", p1id, p2id, p3id, p4id, "offen"]],
      },
    });

    console.log("✅ preMatch gespeichert:", res.data.updates);
    return {success: true, updates: res.data.updates};
  } catch (err) {
    console.error("❌ Google Sheets Schreibfehler:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Fügt einen neuen Spieler in die "Personen"-Tabelle ein,
 * verhindert doppelte Registrierung anhand der E-Mail.
 * Erwartet in req.data:
 * {
 *   firstName: "Kilian",
 *   lastName: "Pimminger",
 *   email: "kilian@example.com",
 *   hash: "abc123..."
 * }
 */
export const upsertData = onCall(async (req) => {
  try {
    const {firstName, lastName, email, hash} = req.data;

    if (!firstName || !lastName || !email || !hash) {
      throw new Error("❌ firstName, lastName, email oder hash fehlen in req.data");
    }

    console.log("🧩 upsertData gestartet:", {firstName, lastName, email});

    // 🔹 Google Sheets Auth (Compute Service‑Account)
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({version: "v4", auth: authClient});

    // 1️⃣ Alle Spieler holen (für E‑Mail‑Prüfung)
    const getRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Personen!A:J",
    });

    const rows = getRes.data.values || [];
    if (rows.length < 2) {
      console.warn("⚠️ Tabelle enthält keine Daten außer Header.");
    }

    // Header finden
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const emailIndex = header.indexOf("e-mail");
    const idIndex = header.indexOf("id");

    if (emailIndex === -1 || idIndex === -1) {
      throw new Error("❌ Spalten 'id' oder 'e-mail' fehlen im Sheet‑Header");
    }

    // 2️⃣ Prüfen, ob E‑Mail schon existiert
    const emailExists = rows.some(
        (row, i) =>
          i > 0 &&
        row[emailIndex] &&
        row[emailIndex].trim().toLowerCase() === email.trim().toLowerCase(),
    );

    if (emailExists) {
      console.warn(`⚠️ E‑Mail ${email} ist bereits registriert.`);
      return {
        success: false,
        error: "Diese E‑Mail ist bereits registriert.",
      };
    }

    // 3️⃣ Neue ID bestimmen (nur numerische IDs)
    const numericIds = rows
        .slice(1)
        .map((r) => parseInt(r[idIndex], 10))
        .filter((n) => !isNaN(n) && n > 0);

    const lastId = numericIds.length > 0 ? Math.max(...numericIds) : 0;
    const newId = lastId + 1;

    // 4️⃣ Neue Zeile erstellen (neue Personen-Struktur)
    // ID, Nachname, Vorname, Telefon Mobil, E-Mail, Ort, Adresse, PLZ, GeburtsDatum, passwdHash, ...
    const newRow = [newId, lastName, firstName, "", email, "", "", "", "", hash];

    // 5️⃣ Anhängen
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Personen!A:J",
      valueInputOption: "USER_ENTERED",
      requestBody: {values: [newRow]},
    });

    console.log(`✅ Spieler gespeichert: ID ${newId} (${email})`);
    return {success: true, inserted: newRow};
  } catch (err) {
    console.error("❌ Fehler in upsertData:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Baut die Rangliste aus den Tabs "RL-Platzierung" und "Personen" zusammen.
 * - "RL-Platzierung" enthält Spalten: BewerbID | Rang | PersonID | Bemerkung
 * - "Personen" enthält Spalten: ID | Nachname | Vorname | ...
 * Optionaler Parameter: bewerbId (z.B. 2 = Herren, 3 = Damen)
 */
export const readRankedPlayers = onCall(async (request) => {
  const filterBewerbId = (request && request.data && request.data.bewerbId) ? String(request.data.bewerbId).trim() : null;

  console.log("✅ readRankedPlayers gestartet...", filterBewerbId ? `Filter: BewerbID ${filterBewerbId}` : "(alle)");

  try {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    // --- Tabellen abrufen ---
    const rankedRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "RL-Platzierung",
    });
    const playersRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Personen",
    });

    const rankedValues = rankedRes.data.values || [];
    const playersValues = playersRes.data.values || [];

    if (rankedValues.length < 2 || playersValues.length < 2) {
      console.warn("⚠️ Tabellen leer oder unvollständig");
      return {success: false, error: "Leere Tabellen"};
    }

    // --- Headerzeilen analysieren ---
    const rankedHeader = rankedValues[0].map((h) => h.trim().toLowerCase());
    const playersHeader = playersValues[0].map((h) => h.trim().toLowerCase());

    const bewerbIdIndex = rankedHeader.indexOf("bewerbid");
    const rankIndex = rankedHeader.indexOf("rang");
    const playerIdIndex = rankedHeader.indexOf("personid");
    const idIndex = playersHeader.indexOf("id");
    const firstNameIndex = playersHeader.indexOf("vorname");
    const lastNameIndex = playersHeader.indexOf("nachname");

    if (
      bewerbIdIndex === -1 ||
      rankIndex === -1 ||
      playerIdIndex === -1 ||
      idIndex === -1 ||
      firstNameIndex === -1 ||
      lastNameIndex === -1
    ) {
      throw new Error("❌ Spalten nicht gefunden – bitte Header überprüfen");
    }

    // --- PlayerID → Vollname‑Map ---
    const playerMap = new Map();
    for (let i = 1; i < playersValues.length; i++) {
      const row = playersValues[i];
      const id = row[idIndex];
      const first = row[firstNameIndex] || "";
      const last = row[lastNameIndex] || "";
      const fullName = `${first.trim()} ${last.trim()}`.trim();
      playerMap.set(id, fullName);
    }

    // --- Rangliste kombinieren ---
    const rankedList = rankedValues.slice(1).map((row) => {
      const bewerbId = row[bewerbIdIndex] || "";
      const rank = Number(row[rankIndex]);
      const playerId = row[playerIdIndex];
      const name = playerMap.get(playerId) || "Unbekannt";
      return {bewerbId, rank, playerId, name};
    });

    // Filter nach BewerbID falls angegeben
    let filteredList = rankedList;
    if (filterBewerbId) {
      filteredList = rankedList.filter((p) => String(p.bewerbId).trim() === filterBewerbId);
      console.log(`🔍 Filter: ${filteredList.length} von ${rankedList.length} Spielern für BewerbID ${filterBewerbId}`);
    }

    // optional: nach Rang sortieren
    filteredList.sort((a, b) => a.rank - b.rank);

    console.log("🏁 Fertige Liste:", filteredList);

    return {success: true, rankedList: filteredList};
  } catch (err) {
    console.error("❌ Fehler in readRankedPlayers:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Vergleicht einen Passwort-Hash aus dem Frontend mit dem gespeicherten Hash im Google Sheet
 * Suchkriterium: E-Mail
 * Tabelle: "users" mit Spalten [email, passwordHash]
 */
export const verifyUserLogin = onCall(async (request) => {
  try {
    const {email, passwordHash} = request.data;
    if (!email || !passwordHash) {
      throw new Error("E-Mail oder Passwort-Hash fehlt.");
    }

    console.log("🔍 Login-Überprüfung gestartet für:", email);

    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    // Daten aus TAB "Personen"
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Personen",
    });

    const rows = res.data.values || [];
    if (rows.length < 2) {
      throw new Error("❌ Tabelle enthält keine Benutzerdaten.");
    }

    // Header analysieren
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const emailIndex = headers.indexOf("e-mail");
    const hashIndex = headers.indexOf("passwdhash");

    if (emailIndex === -1 || hashIndex === -1) {
      return res.status(500).json({
        success: false,
        message: "Spalten 'email' oder 'passwdHash' fehlen.",
      });
    }

    // Benutzerzeile suchen
    const userRow = rows.find(
        (row, i) =>
          i > 0 &&
        row[emailIndex] &&
        row[emailIndex].trim().toLowerCase() === email.trim().toLowerCase(),
    );

    if (!userRow) {
      console.warn("⚠️ Keine E-Mail gefunden:", email);
      return {success: false, message: "E-Mail nicht gefunden."};
    }

    const storedHash =
      userRow && userRow[hashIndex] ? userRow[hashIndex].trim() : "";
    const match = storedHash === passwordHash;

    console.log(match ? "✅ Hash passt!" : "❌ Hash stimmt nicht überein.");
    return {success: true, valid: match};
  } catch (err) {
    console.error("❌ Fehler in verifyUserLogin:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Liest aus der "Personen"-Tabelle: Voller Name, E-Mail, Geburtsdatum
 * Liest offene Herausforderungen für einen Spieler aus preMatches.
 * Nur der GEFORDERTE (Spieler 1) bekommt die Notification.
 */
export const getMyChallenges = onCall(async (request) => {
  try {
    const {userId} = request.data || {};
    if (!userId) {
      return {success: false, error: "userId fehlt"};
    }

    console.log("🔔 Lade Herausforderungen für User:", userId);

    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    const [preMatchesRes, playersRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "preMatches",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "Personen",
      }),
    ]);

    const preRows = preMatchesRes.data.values || [];
    const playerRows = playersRes.data.values || [];

    if (preRows.length < 2) {
      return {success: true, challenges: []};
    }

    const playerHeader = playerRows[0].map((h) => h.trim().toLowerCase());
    const pIdIdx = playerHeader.indexOf("id");
    const pFnIdx = playerHeader.indexOf("vorname");
    const pLnIdx = playerHeader.indexOf("nachname");

    const playerMap = new Map();
    playerRows.slice(1).forEach((r) => {
      const id = String(r[pIdIdx] || "");
      const name = (r[pFnIdx] || "") + " " + (r[pLnIdx] || "");
      playerMap.set(id, name.trim());
    });

    const preHeader = preRows[0].map((h) => h.trim().toLowerCase());
    const i1 = preHeader.indexOf("spielerid1");
    const i2 = preHeader.indexOf("spielerid2");
    const i3 = preHeader.indexOf("spielerid3");
    const d = preHeader.indexOf("zeitpunktmatch");

    const challenges = [];
    preRows.slice(1).forEach((row, rowIndex) => {
      const rowNum = rowIndex + 2;
      const p1 = String(row[i1] || "");
      const p2 = String(row[i2] || "");
      const p3 = String(row[i3] || "");
      const rawDatum = row[d] || "";

      const isForMe = p1 === userId;
      const isOpen = !rawDatum;

      if (isForMe && isOpen) {
        challenges.push({
          row: rowNum,
          player1: playerMap.get(p1) || p1,
          player2: playerMap.get(p2) || p2,
          player3: playerMap.get(p3) || p3,
        });
      }
    });

    console.log(`✅ ${challenges.length} offene Herausforderungen gefunden.`);
    return {success: true, challenges};
  } catch (err) {
    console.error("❌ Fehler in getMyChallenges:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Trägt Datum (ZeitpunktMatch) in eine preMatches-Zeile ein.
 */
export const setMatchDate = onCall(async (request) => {
  try {
    const {row, datum, platz} = request.data || {};
    if (!row || !datum) {
      return {success: false, error: "row und datum sind erforderlich"};
    }

    console.log("📅 Setze ZeitpunktMatch in preMatches Zeile", row, ":", datum);

    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({version: "v4", auth});

    const rowInSheet = row;
    // Neue Struktur: Spalte B = ZeitpunktMatch
    const cellB = `preMatches!B${rowInSheet}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: cellB,
      valueInputOption: "USER_ENTERED",
      requestBody: {values: [[datum]]},
    });

    console.log("✅ ZeitpunktMatch gesetzt:", datum);
    return {success: true};
  } catch (err) {
    console.error("❌ Fehler in setMatchDate:", err);
    return {success: false, error: err.message};
  }
});

export const readPlayerDetails = onCall(async () => {
  try {
    console.log("🔄 Lade Spieler-Details...");

    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    // Google Sheet abrufen
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Personen",
    });

    const values = res.data.values || [];
    if (values.length < 2) {
      throw new Error("❌ Keine Spielerdaten gefunden.");
    }

    // --- Header verarbeiten ---
    const header = values[0].map((h) => h.trim().toLowerCase());
    const firstNameIndex = header.indexOf("vorname");
    const lastNameIndex = header.indexOf("nachname");
    const idIndex = header.indexOf("id");
    const emailIndex = header.indexOf("e-mail");
    const birthIndex = header.indexOf("geburtsdatum");

    if (
      idIndex === -1 ||
      firstNameIndex === -1 ||
      lastNameIndex === -1 ||
      emailIndex === -1 ||
      birthIndex === -1
    ) {
      throw new Error(
          "❌ Eine oder mehrere Spalten fehlen (vorname, nachname, e-mail, GeburtsDatum)",
      );
    }

    // --- Spieler durchgehen ---
    const players = values.slice(1).map((row) => {
      const id = row[idIndex] || "";
      const first = row[firstNameIndex] || "";
      const last = row[lastNameIndex] || "";
      const fullName = `${first.trim()} ${last.trim()}`.trim();
      const email = row[emailIndex] || "";
      const birthDate = row[birthIndex] || "";

      return {id, firstName: first.trim(), lastName: last.trim(), fullName, email, birthDate};
    });

    console.log(`✅ ${players.length} Spieler geladen.`);
    return {success: true, players};
  } catch (err) {
    console.error("❌ Fehler in readPlayerDetails:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Liest ALLE PreMatches (kein Filter).
 */
export const readPreMatches = onCall(async (request) => {
  try {
    const userId = request.data && request.data.userId ? String(request.data.userId).trim() : null;

    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    const [preRes, playerRes, bewerbRes, bewerbsartRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "preMatches",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "Personen",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "Bewerb",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "Bewerbsart",
      }),
    ]);

    const preValues = preRes.data.values || [];
    const playerValues = playerRes.data.values || [];
    const bewerbValues = bewerbRes.data.values || [];
    const bewerbsartValues = bewerbsartRes.data.values || [];

    if (preValues.length < 2) {
      return {success: true, preMatches: []};
    }

    const playerHeader = playerValues[0].map((h) => h.trim().toLowerCase());
    const pIdIdx = playerHeader.indexOf("id");
    const pFnIdx = playerHeader.indexOf("vorname");
    const pLnIdx = playerHeader.indexOf("nachname");

    const playerMap = new Map();
    playerValues.slice(1).forEach((r) => {
      const id = String(r[pIdIdx] || "");
      const name = (r[pFnIdx] || "") + " " + (r[pLnIdx] || "");
      playerMap.set(id, name.trim());
    });

    const bewerbsartMap = new Map();
    if (bewerbsartValues.length > 1) {
      const baHeader = bewerbsartValues[0].map((h) => h.trim().toLowerCase());
      const baIdIdx = baHeader.indexOf("id");
      const baBezIdx = baHeader.indexOf("bezeichnung");

      bewerbsartValues.slice(1).forEach((r) => {
        const id = String(r[baIdIdx] || "").trim();
        const name = String(r[baBezIdx] || "").trim();
        if (id && name) {
          bewerbsartMap.set(id, name);
        }
      });
    }

    const bewerbMap = new Map();
    if (bewerbValues.length > 1) {
      const bHeader = bewerbValues[0].map((h) => h.trim().toLowerCase());
      const bIdIdx = bHeader.indexOf("id");
      const bBewerbsartIdIdx = bHeader.indexOf("bewerbsartid");
      const bBezIdx = bHeader.indexOf("bezeichnung");

      bewerbValues.slice(1).forEach((r) => {
        const id = String(r[bIdIdx] || "").trim();
        const baId = String(r[bBewerbsartIdIdx] || "").trim();
        const bez = String(r[bBezIdx] || "").trim();
        const artName = bewerbsartMap.get(baId) || "";

        if (id) {
          bewerbMap.set(id, {
            bezeichnung: bez,
            bewerbsartName: artName,
            bewerbsartId: baId,
          });
        }
      });
    }

    const preHeader = preValues[0].map((h) => h.trim().toLowerCase());
    const i1 = preHeader.indexOf("spielerid1");
    const i2 = preHeader.indexOf("spielerid2");
    const i3 = preHeader.indexOf("spielerid3");
    const i4 = preHeader.indexOf("spielerid4");
    const d = preHeader.indexOf("zeitpunktmatch");
    const zeitpunktForderungIdx = preHeader.indexOf("zeitpunktforderung");
    const bewerbIdIdx = preHeader.indexOf("bewerbid");
    const st = preHeader.indexOf("status");
    const er = preHeader.indexOf("ergebnis");

    const preMatches = [];
    preValues.slice(1).forEach((row, rowIndex) => {
      const rowNum = rowIndex + 2;
      const p1 = String(row[i1] || "");
      const p2 = String(row[i2] || "");
      const p3 = String(row[i3] || "");
      const p4 = String(row[i4] || "");
      const datum = d !== -1 ? formatSheetDate(row[d] || "") : "";
      const bewerbId = bewerbIdIdx !== -1 ? (String(row[bewerbIdIdx] || "").trim() || "2") : "2";
      const bewerbInfo = bewerbMap.get(bewerbId) || {};
      const zeitpunktForderungRaw = zeitpunktForderungIdx !== -1 ? String(row[zeitpunktForderungIdx] || "") : "";
      const status = st !== -1 ? (row[st] || "offen") : "offen";
      const ergebnis = er !== -1 ? formatErgebnis(row[er] || "") : "";

      if (!p1 && !p2 && !p3 && !p4) {
        return;
      }

      const isForMe = userId ? [p1, p2, p3, p4].includes(userId) : false;

      const match = {
        row: rowNum,
        player1: playerMap.get(p1) || p1,
        player2: playerMap.get(p2) || p2,
        player3: playerMap.get(p3) || p3,
        player4: playerMap.get(p4) || p4,
        player1Id: p1,
        player2Id: p2,
        player3Id: p3,
        player4Id: p4,
        datum,
        bewerbId,
        bewerbsartId: bewerbInfo.bewerbsartId || "",
        bewerbsart: bewerbInfo.bewerbsartName || "",
        bewerbBezeichnung: bewerbInfo.bezeichnung || "",
        zeitpunktForderung: formatSheetDate(zeitpunktForderungRaw),
        status,
        ergebnis,
        isForMe: isForMe,
        canEnterResult: !ergebnis && isForMe,
      };

      preMatches.push(match);
    });

    return {success: true, preMatches};
  } catch (err) {
    console.error("Fehler in readPreMatches:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Tragt Match-Ergebnis ein, verschiebt in matches Tabelle.
 * Aktualisiert Rangliste wenn Forderer gewinnt.
 */
export const setPreMatchResult = onCall(async (request) => {
  try {
    const {row, satz1, satz2, satz3, userId} = request.data || {};

    if (!row || !satz1 || !satz2 || !satz3 || !userId) {
      return {success: false, error: "Alle Felder erforderlich"};
    }

    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({version: "v4", auth});

    const preRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "preMatches",
    });
    const preValues = preRes.data.values || [];
    if (preValues.length < 2 || row > preValues.length) {
      return {success: false, error: "PreMatch nicht gefunden"};
    }

    const preHeader = preValues[0].map((h) => h.trim().toLowerCase());
    const i1 = preHeader.indexOf("spielerid1");
    const i2 = preHeader.indexOf("spielerid2");
    const i3 = preHeader.indexOf("spielerid3");
    const i4 = preHeader.indexOf("spielerid4");
    const d = preHeader.indexOf("zeitpunktmatch");
    const er = preHeader.indexOf("ergebnis");

    const matchRow = preValues[row - 1];
    const existingErgebnis = matchRow[er] || "";

    const ergebnisWert = satz1 + "/" + satz2 + (satz3 ? "/" + satz3 : "");

    if (existingErgebnis && existingErgebnis !== ergebnisWert) {
      return {success: false, error: "Anderes Ergebnis bereits eingetragen"};
    }

    const p1 = String(matchRow[i1] || "");
    const p2 = String(matchRow[i2] || "");
    const p3 = String(matchRow[i3] || "");
    const p4 = String(matchRow[i4] || "");
    const datum = matchRow[d] || "";

    // Gewinner berechnen
    const saetze = satz3 ? [satz1, satz2, satz3] : [satz1, satz2];
    let siegeP1 = 0;
    let siegeP3 = 0;
    saetze.forEach((s) => {
      if (s && s.includes(":")) {
        const teile = s.split(":");
        const punkte1 = parseInt(teile[0], 10);
        const punkte3 = parseInt(teile[1], 10);
        if (!isNaN(punkte1) && !isNaN(punkte3)) {
          if (punkte1 > punkte3) {
            siegeP1++;
          } else if (punkte3 > punkte1) {
            siegeP3++;
          }
        }
      }
    });
    const fordererGewonnen = siegeP3 > siegeP1;
    const gewinner = fordererGewonnen ? p3 : p1;

    // Match in matches schreiben (neue Struktur!)
    // ID, Zeitpunkt, Dauer, BewerbID, MatchtypID, SpielerID1-4, Ergebnis, Bemerkung, PTN-Wertung, Gewinner
    const matchesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "matches",
    });
    const matchesValues = matchesRes.data.values || [];

    let newMatchId = 1;
    if (matchesValues.length > 1) {
      const matchesHeader = matchesValues[0].map((h) => h.trim().toLowerCase());
      const matchIdIdx = matchesHeader.indexOf("id");
      if (matchIdIdx !== -1) {
        const numericIds = matchesValues.slice(1)
            .map((r) => parseFloat(r[matchIdIdx]))
            .filter((n) => !isNaN(n) && n > 0);
        if (numericIds.length > 0) {
          newMatchId = Math.max(...numericIds) + 1;
        }
      }
    }

    const newMatchRow = [newMatchId, datum, "", "", "", p1, p2, p3, p4, ergebnisWert, "", "", gewinner];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "matches",
      valueInputOption: "USER_ENTERED",
      requestBody: {values: [newMatchRow]},
    });

    // preMatches Zeile leeren (neue Struktur: 10 Spalten A-J)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "preMatches!A" + row + ":J" + row,
      valueInputOption: "USER_ENTERED",
      requestBody: {values: [["", "", "", "", "", "", "", "", "", ""]]},
    });

    // RANKLISTEN-UPDATE wenn Forderer gewonnen hat
    if (fordererGewonnen) {
      const rankRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "RL-Platzierung",
      });
      const rankValues = rankRes.data.values || [];
      if (rankValues.length < 2) {
        return {success: true, rankingUpdated: false};
      }

      const rankHeader = rankValues[0].map((h) => h.trim().toLowerCase());
      const rangIdx = rankHeader.indexOf("rang");
      const pidIdx = rankHeader.indexOf("personid");

      if (rangIdx === -1 || pidIdx === -1) {
        return {success: true, rankingUpdated: false};
      }

      // Finde Positionen von p1 (Geforderter) und p3 (Forderer)
      let rangP1 = -1;
      let rangP3 = -1;

      for (let i = 1; i < rankValues.length; i++) {
        const rowRank = rankValues[i];
        const playerId = String(rowRank[pidIdx] || "").trim();
        if (playerId === p1) {
          rangP1 = parseInt(rowRank[rangIdx], 10);
        }
        if (playerId === p3) {
          rangP3 = parseInt(rowRank[rangIdx], 10);
        }
      }

      console.log("Rangliste: Forderer=" + p3 + "(Rang " + rangP3 + ") fordert " + p1 + "(Rang " + rangP1 + ")");

      // Wenn Forderer ranghoher ist (kleine Zahl = besser), dann tauschen
      if (rangP1 > 0 && rangP3 > 0 && rangP3 > rangP1) {
        console.log("Forderer gewinnt! Tausche Rang " + rangP3 + " mit Rang " + rangP1);

        // Alle Spieler zwischen rangP1 und rangP3 um 1 nach hinten schieben
        for (let i = 1; i < rankValues.length; i++) {
          const rowRank = rankValues[i];
          const aktRang = parseInt(rowRank[rangIdx], 10);
          if (aktRang > rangP1 && aktRang < rangP3) {
            // Rang um 1 erhoehen (nach hinten schieben)
            await sheets.spreadsheets.values.update({
              spreadsheetId: SHEET_ID,
              range: "RL-Platzierung!B" + (i + 1),
              valueInputOption: "USER_ENTERED",
              requestBody: {values: [[aktRang + 1]]},
            });
          }
        }

        // Forderer (p3) auf Rang von Gefordertem (p1) setzen
        const fordererRowIdx = rankValues.findIndex((r) => String(r[pidIdx] || "").trim() === p3);
        if (fordererRowIdx > 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: "RL-Platzierung!B" + (fordererRowIdx + 1),
            valueInputOption: "USER_ENTERED",
            requestBody: {values: [[rangP1]]},
          });
        }

        // Geforderter (p1) auf Rang von Forderer (p3) setzen
        const geforderterRowIdx = rankValues.findIndex((r) => String(r[pidIdx] || "").trim() === p1);
        if (geforderterRowIdx > 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: "RL-Platzierung!B" + (geforderterRowIdx + 1),
            valueInputOption: "USER_ENTERED",
            requestBody: {values: [[rangP3]]},
          });
        }

        console.log("Rangliste aktualisiert!");
      }
    }

    return {success: true, rankingUpdated: fordererGewonnen};
  } catch (err) {
    console.error("Fehler in setPreMatchResult:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Setzt das Passwort eines Benutzers zurück, wenn kennwortVergessen=x
 * Erwartet:
 * {
 *   email: "user@example.com",
 *   passwordHash: "abc123..."
 * }
 */
export const resetPassword = onCall(async (request) => {
  try {
    const {email, passwordHash} = request.data;

    if (!email || !passwordHash) {
      throw new Error("E-Mail oder Passwort-Hash fehlt.");
    }

    console.log("🔑 Passwort-Reset gestartet für:", email);

    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({version: "v4", auth});

    // Daten aus "Personen" Tabelle
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Personen",
    });

    const rows = res.data.values || [];
    if (rows.length < 2) {
      throw new Error("❌ Tabelle enthält keine Benutzerdaten.");
    }

    // Header analysieren
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const emailIndex = headers.indexOf("e-mail");
    const hashIndex = headers.indexOf("passwdhash");
    const kennwortVergessenIndex = headers.indexOf("kennwortvergessen");

    if (emailIndex === -1 || hashIndex === -1) {
      return {
        success: false,
        error: "Spalten 'e-mail' oder 'passwdHash' fehlen.",
      };
    }

    // Benutzerzeile suchen
    let userRowIndex = -1;
    let userRow = null;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][emailIndex] &&
          rows[i][emailIndex].trim().toLowerCase() === email.trim().toLowerCase()) {
        userRowIndex = i;
        userRow = rows[i];
        break;
      }
    }

    if (!userRow) {
      console.warn("⚠️ Keine E-Mail gefunden:", email);
      return {success: false, error: "E-Mail nicht gefunden."};
    }

    // Prüfe ob kennwortVergessen = "x"
    if (kennwortVergessenIndex !== -1) {
      const kennwortVergessen = userRow[kennwortVergessenIndex] ? userRow[kennwortVergessenIndex].trim() : "";
      if (kennwortVergessen !== "x") {
        console.warn("⚠️ Passwort-Reset nicht erlaubt für:", email);
        return {success: false, error: "Passwort-Reset nicht autorisiert. Kontaktiere den Administrator."};
      }
    } else {
      console.warn("⚠️ Spalte 'kennwortVergessen' nicht gefunden!");
      return {success: false, error: "System-Konfiguration fehler. kennwortVergessen Spalte nicht vorhanden."};
    }

    // Passwort-Hash aktualisieren
    const newRow = [...userRow];
    newRow[hashIndex] = passwordHash;

    // Admin-Bestätigung (kennwortVergessen) löschen nach erfolgreicher Änderung
    newRow[kennwortVergessenIndex] = "";

    // Update in Google Sheets - nur die betroffene Zeile
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Personen!A${userRowIndex + 1}:N${userRowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {values: [newRow.slice(0, 14)]},
    });

    console.log(`✅ Passwort-Hash aktualisiert für: ${email}`);
    console.log(`✅ Admin-Bestätigung (kennwortVergessen) gelöscht für: ${email}`);
    return {success: true, message: "Passwort erfolgreich zurückgesetzt."};
  } catch (err) {
    console.error("❌ Fehler in resetPassword:", err);
    return {success: false, error: err.message};
  }
});

/**
 * Liest alle Bewerbe aus der "Bewerb"-Tabelle.
 */
export const readBewerbe = onCall(async () => {
  try {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Bewerb",
    });

    const values = res.data.values || [];
    if (values.length < 2) {
      return {success: true, bewerbe: []};
    }

    const header = values[0].map((h) => h.trim().toLowerCase());
    const idIdx = header.indexOf("id");
    const bewerbIdx = header.indexOf("bewerbsartid");
    const bezIdx = header.indexOf("bezeichnung");
    const startIdx = header.indexOf("bewerbsbeginn");
    const endIdx = header.indexOf("bewerbsende");

    const bewerbe = values.slice(1).map((row) => ({
      id: row[idIdx] || "",
      bewerbsartId: row[bewerbIdx] || "",
      bezeichnung: row[bezIdx] || "",
      bewerbsbeginn: row[startIdx] || "",
      bewerbsende: row[endIdx] || "",
    }));

    return {success: true, bewerbe};
  } catch (err) {
    console.error("❌ Fehler in readBewerbe:", err);
    return {success: false, error: err.message};
  }
});
