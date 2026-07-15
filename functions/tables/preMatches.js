/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";
import {logEntry} from "./logging.js";
import {readMatches1Data} from "./matches.js";

// readPreMatches leitet jetzt auf Matches1 um (Kompatibilität)
export async function readPreMatchesData(sheets) {
  return readMatches1Data(sheets);
}

export const readPreMatches = onCall({region: "europe-west3", invoker: "public"}, async () => {
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
    console.error("Fehler in readPreMatches:", err);
    return {success: false, error: err.message};
  }
});

export async function createPreMatchData(sheets, {newId, forderungDate, bewerbId, p1id, p2id, p3id, p4id}) {
  // Matches1 Spaltenreihenfolge: Ignore, ID, MatchDate, ForderungDate, Dauer, BewerbID, BewerbRunde, MatchtypID, Spieler1ID, Spieler2ID, Spieler3ID, Spieler4ID, Ergebnis, PTN-Wertung, Bemerkung
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Matches1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["", newId, "", forderungDate || "", "", bewerbId, "", "", p1id, p2id || "", p3id, p4id || "", "", "", ""]],
    },
  });
  return {updates: res.data.updates};
}

export async function getNextPreMatchId(sheets) {
  const values = await readMatches1Data(sheets);
  if (values.length < 2) return 1;
  const header = values[0].map((h) => h.trim().toLowerCase());
  const idIdx = header.indexOf("id");
  if (idIdx === -1) return 1;
  const numericIds = values.slice(1)
      .map((r) => parseFloat(r[idIdx]))
      .filter((n) => !isNaN(n) && n > 0);
  return numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
}

export async function updatePreMatchDateData(sheets, row, datum) {
  // MatchDate ist Spalte C (3. Spalte) in Matches1
  const cellC = `Matches1!C${row}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: cellC,
    valueInputOption: "USER_ENTERED",
    requestBody: {values: [[datum]]},
  });
}

export const setMatchDate = onCall({region: "europe-west3", invoker: "public"}, async (request) => {
  try {
    const {row, datum} = request.data || {};
    if (!row || !datum) return {success: false, error: "row und datum sind erforderlich"};

    const sheets = await getSheetsClient(false);
    await updatePreMatchDateData(sheets, row, datum);
    logEntry({sheets, source: "setMatchDate", entry: `Datum gesetzt Zeile ${row} → ${datum}`});
    return {success: true};
  } catch (err) {
    console.error("Fehler in setMatchDate:", err);
    return {success: false, error: err.message};
  }
});

export async function deletePreMatchRowData(sheets, row) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
  });
  const matchSheet = spreadsheet.data.sheets.find((s) => s.properties.title === "Matches1");
  if (!matchSheet) throw new Error("Tabelle Matches1 nicht gefunden");
  const sheetId = matchSheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: row - 1,
            endIndex: row,
          },
        },
      }],
    },
  });
}

export async function clearPreMatchRowData(sheets, row) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Matches1!A${row}:O${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {values: [["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]},
  });
}
