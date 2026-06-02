import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";

export async function readMatchesData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "matches",
  });
  return res.data.values || [];
}

export const readMatchesList = onCall(async () => {
  try {
    const sheets = await getSheetsClient(true);
    const values = await readMatchesData(sheets);
    return {success: true, values};
  } catch (err) {
    console.error("Fehler in readMatchesList:", err);
    return {success: false, error: err.message};
  }
});

export async function createMatchData(sheets, {datum, p1, p2, p3, p4, ergebnisWert, gewinner}) {
  const values = await readMatchesData(sheets);

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

  const newMatchRow = [newMatchId, datum, "", "", "", p1, p2, p3, p4, ergebnisWert, "", "", gewinner];
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "matches",
    valueInputOption: "USER_ENTERED",
    requestBody: {values: [newMatchRow]},
  });
  return {updates: res.data.updates};
}

export async function readMatchRestrictionsData(sheets) {
  const values = await readMatchesData(sheets);
  if (values.length < 2) return {schutzzeit: [], sperrzeit: []};

  const header = values[0].map((h) => h.trim().toLowerCase());
  const zeitpunktIdx = header.indexOf("zeitpunkt");
  const s1Idx = header.indexOf("spielerid1");
  const s3Idx = header.indexOf("spielerid3");
  const gewinnerIdx = header.indexOf("gewinner");

  if ([zeitpunktIdx, s1Idx, s3Idx, gewinnerIdx].includes(-1)) {
    return {schutzzeit: [], sperrzeit: []};
  }

  const now = new Date();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const schutzzeitMap = new Map();
  const sperrzeitMap = new Map();

  values.slice(1).forEach((row) => {
    const rawDate = String(row[zeitpunktIdx] || "").trim();
    if (!rawDate) return;
    const m = rawDate.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
    if (!m) return;
    const [, yy, mm, dd, hh, mi] = m;
    const yyyy = parseInt(yy, 10) >= 50 ? "19" + yy : "20" + yy;
    const matchDate = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00`);
    const endDate = new Date(matchDate.getTime() + SEVEN_DAYS_MS);
    if (endDate <= now) return;

    const p1 = String(row[s1Idx] || "").trim();
    const p3 = String(row[s3Idx] || "").trim();
    const winner = String(row[gewinnerIdx] || "").trim();
    if (!p1 || !p3 || !winner) return;

    const loser = winner === p1 ? p3 : p1;
    if (!schutzzeitMap.has(winner) || schutzzeitMap.get(winner) < endDate) schutzzeitMap.set(winner, endDate);
    if (!sperrzeitMap.has(loser) || sperrzeitMap.get(loser) < endDate) sperrzeitMap.set(loser, endDate);
  });

  const toEntry = ([id, end]) => ({id, until: end.toISOString()});
  return {
    schutzzeit: Array.from(schutzzeitMap.entries()).map(toEntry),
    sperrzeit: Array.from(sperrzeitMap.entries()).map(toEntry),
  };
}

export const readMatchRestrictions = onCall(async () => {
  try {
    const sheets = await getSheetsClient(true);
    const result = await readMatchRestrictionsData(sheets);
    return {success: true, ...result};
  } catch (err) {
    console.error("Fehler in readMatchRestrictions:", err);
    return {success: false, error: err.message, schutzzeit: [], sperrzeit: []};
  }
});
