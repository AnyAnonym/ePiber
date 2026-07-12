/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";
import {logEntry} from "./logging.js";

export async function readPreMatchesData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "preMatches",
  });
  return res.data.values || [];
}

export const readPreMatches = onCall({region: "europe-west3"}, async () => {
  try {
    const sheets = await getSheetsClient(true);
    const values = await readPreMatchesData(sheets);
    if (values.length < 2) return {success: true, values};

    const header = values[0].map((h) => h.trim().toLowerCase());
    const ignIdx = header.indexOf("ignorieren");

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

export async function createPreMatchData(sheets, {newId, zeitpunktForderung, bewerbId, p1id, p2id, p3id, p4id}) {
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "preMatches",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[newId, "", zeitpunktForderung, bewerbId, "", p1id, p2id, p3id, p4id, "offen"]],
    },
  });
  return {updates: res.data.updates};
}

export async function getNextPreMatchId(sheets) {
  const values = await readPreMatchesData(sheets);
  const header = values[0].map((h) => h.trim().toLowerCase());
  const idIdx = header.indexOf("id");
  const numericIds = values.slice(1)
      .map((r) => parseFloat(r[idIdx]))
      .filter((n) => !isNaN(n) && n > 0);
  return numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
}

export async function updatePreMatchDateData(sheets, row, datum) {
  const cellB = `preMatches!B${row}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: cellB,
    valueInputOption: "USER_ENTERED",
    requestBody: {values: [[datum]]},
  });
}

export const setMatchDate = onCall({region: "europe-west3"}, async (request) => {
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
  const preSheet = spreadsheet.data.sheets.find((s) => s.properties.title === "preMatches");
  if (!preSheet) throw new Error("Tabelle preMatches nicht gefunden");
  const sheetId = preSheet.properties.sheetId;

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
    range: `preMatches!A${row}:J${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {values: [["", "", "", "", "", "", "", "", "", ""]]},
  });
}
