/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";

// ── Matches1 lesen (neue zusammengeführte Tabelle) ──

export async function readMatches1Data(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Matches1",
  });
  return res.data.values || [];
}

// Gewinner aus Ergebnis ermitteln (keine DB-Spalte mehr)
export function determineWinnerFromResult(ergebnis, spieler1Id, spieler3Id) {
  if (!ergebnis || !spieler1Id || !spieler3Id) return "";
  const sets = String(ergebnis).trim().split("/").filter(Boolean);
  let wins1 = 0;
  let wins3 = 0;
  for (const s of sets) {
    const clean = s.replace(/\(\d+\)/g, "").replace(/\[ret\]/gi, "").trim();
    const parts = clean.split("-").map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      if (parts[0] > parts[1]) wins1++;
      else if (parts[1] > parts[0]) wins3++;
    }
  }
  if (wins1 > wins3) return spieler1Id;
  if (wins3 > wins1) return spieler3Id;
  return "";
}

export const readMatchesList = onCall({region: "europe-west3", invoker: "public"}, async () => {
  try {
    const sheets = await getSheetsClient(true);
    const values = await readMatches1Data(sheets);
    if (values.length < 2) return {success: true, values};

    const header = values[0].map((h) => h.trim().toLowerCase());
    const ignIdx = header.indexOf("ignore");

    if (ignIdx === -1) return {success: true, values};

    const filtered = values.slice(1).filter((row) => {
      const val = String(row[ignIdx] || "").trim();
      return val !== "1";
    });

    return {success: true, values: [values[0], ...filtered]};
  } catch (err) {
    console.error("Fehler in readMatchesList:", err);
    return {success: false, error: err.message};
  }
});

export async function createMatchData(sheets, {datum, bewerbId, p1, p2, p3, p4, ergebnisWert}) {
  const values = await readMatches1Data(sheets);

  let newMatchId = 1;
  if (values.length > 1) {
    const header = values[0].map((h) => h.trim().toLowerCase());
    const matchIdIdx = header.indexOf("id");
    if (matchIdIdx !== -1) {
      const numericIds = values.slice(1)
          .map((r) => parseFloat(r[matchIdIdx]))
          .filter((n) => !isNaN(n) && n > 0);
      if (numericIds.length > 0) newMatchId = Math.max(...numericIds) + 1;
    }
  }

  // Matches1 Spaltenreihenfolge: Ignore, ID, MatchDate, ForderungDate, Dauer, BewerbID, BewerbRunde, MatchtypID, Spieler1ID, Spieler2ID, Spieler3ID, Spieler4ID, Ergebnis, PTN-Wertung, Bemerkung
  const newMatchRow = ["", newMatchId, datum, "", "", bewerbId || "", "", "", p1, p2 || "", p3, p4 || "", ergebnisWert || "", "", ""];
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Matches1",
    valueInputOption: "USER_ENTERED",
    requestBody: {values: [newMatchRow]},
  });
  return {updates: res.data.updates, newMatchId};
}

export async function readMatchRestrictionsData(sheets, {bewerbId} = {}) {
  const values = await readMatches1Data(sheets);
  if (values.length < 2) return {schutzzeit: [], sperrzeit: []};

  const header = values[0].map((h) => h.trim().toLowerCase());
  const matchDateIdx = header.indexOf("matchdate");
  const s1Idx = header.indexOf("spieler1id");
  const s3Idx = header.indexOf("spieler3id");
  const ergebnisIdx = header.indexOf("ergebnis");
  const bewerbIdx = header.indexOf("bewerbid");

  if ([matchDateIdx, s1Idx, s3Idx, ergebnisIdx].includes(-1)) {
    return {schutzzeit: [], sperrzeit: []};
  }

  const now = new Date();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const schutzzeitMap = new Map();
  const sperrzeitMap = new Map();

  values.slice(1).forEach((row) => {
    if (bewerbId && bewerbIdx !== -1) {
      const rowBewerb = String(row[bewerbIdx] || "").trim();
      if (rowBewerb !== bewerbId) return;
    }

    const rawDate = String(row[matchDateIdx] || "").trim();
    if (!rawDate) return;
    const m = rawDate.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
    if (!m) return;
    const [, yy, mm, dd, hh, mi] = m;
    const yyyy = parseInt(yy, 10) >= 50 ? "19" + yy : "20" + yy;
    const matchDate = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00`);
    const endDate = new Date(matchDate.getTime() + SEVEN_DAYS_MS);
    if (endDate <= now) return;

    const p1 = String(row[s1Idx] || "").trim().replace(/\[.*?\]/g, "").trim();
    const p3 = String(row[s3Idx] || "").trim().replace(/\[.*?\]/g, "").trim();
    const ergebnis = String(row[ergebnisIdx] || "").trim();
    if (!p1 || !p3 || !ergebnis) return;

    const winner = determineWinnerFromResult(ergebnis, p1, p3);
    if (!winner) return;

    const loser = winner === p1 ? p3 : p1;

    const existingSchutz = schutzzeitMap.get(winner);
    if (!existingSchutz || existingSchutz.matchDate < matchDate) {
      schutzzeitMap.set(winner, {endDate, matchDate});
    }
    const existingSperr = sperrzeitMap.get(winner);
    if (existingSperr && existingSperr.matchDate < matchDate) {
      sperrzeitMap.delete(winner);
    }

    const existingSperrLoser = sperrzeitMap.get(loser);
    if (!existingSperrLoser || existingSperrLoser.matchDate < matchDate) {
      sperrzeitMap.set(loser, {endDate, matchDate});
    }
    const existingSchutzLoser = schutzzeitMap.get(loser);
    if (existingSchutzLoser && existingSchutzLoser.matchDate < matchDate) {
      schutzzeitMap.delete(loser);
    }
  });

  const toEntry = ([id, val]) => ({id, until: val.endDate.toISOString()});
  return {
    schutzzeit: Array.from(schutzzeitMap.entries()).map(toEntry),
    sperrzeit: Array.from(sperrzeitMap.entries()).map(toEntry),
  };
}

export const readMatchRestrictions = onCall({region: "europe-west3", invoker: "public"}, async (request) => {
  try {
    const sheets = await getSheetsClient(true);
    const bewerbId = request.data?.bewerbId ? String(request.data.bewerbId).trim() : null;
    const result = await readMatchRestrictionsData(sheets, {bewerbId});
    return {success: true, ...result};
  } catch (err) {
    console.error("Fehler in readMatchRestrictions:", err);
    return {success: false, error: err.message, schutzzeit: [], sperrzeit: []};
  }
});
