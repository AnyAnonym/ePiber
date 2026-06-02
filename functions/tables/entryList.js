import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";

export async function readEntryListData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "EntryList",
  });
  return res.data.values || [];
}

export const readEntryList = onCall(async (request) => {
  try {
    const bewerbId = request.data?.bewerbId ? String(request.data.bewerbId).trim() : null;
    if (!bewerbId) return {success: false, error: "BewerbID erforderlich"};

    const sheets = await getSheetsClient(true);
    const values = await readEntryListData(sheets);
    return {success: true, values, bewerbId};
  } catch (err) {
    console.error("Fehler in readEntryList:", err);
    return {success: false, error: err.message};
  }
});

export async function addEntryListData(sheets, {bewerbId, personenId, datum}) {
  const values = await readEntryListData(sheets);

  if (values.length > 1) {
    const header = values[0].map((h) => String(h || "").trim().toLowerCase());
    const bewerbIdx = header.findIndex((h) => {
      const bNames = ["bewerbid", "bewerb id", "bewerb-id", "bewerb", "bewerbsid", "bewerbs id"];
      return bNames.includes(h);
    });
    const personenIdx = header.findIndex((h) => {
      const names = ["personenid", "personen id", "personen-id", "personid",
        "person id", "playerid", "player id", "spielerid", "spieler id"];
      return names.includes(h);
    });

    if (bewerbIdx !== -1 && personenIdx !== -1) {
      const alreadyRegistered = values.slice(1).some((r) =>
        String(r[bewerbIdx] || "").trim() === bewerbId &&
        String(r[personenIdx] || "").trim() === personenId);
      if (alreadyRegistered) throw new Error("Du bist für diesen Bewerb bereits eingetragen.");
    }
  }

  let nextId = 1;
  if (values.length > 1) {
    const idIdx = values[0].findIndex((h) => h.trim().toLowerCase() === "id");
    if (idIdx !== -1) {
      const numericIds = values.slice(1).map((r) => parseInt(r[idIdx], 10)).filter((n) => !isNaN(n));
      nextId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
    } else {
      nextId = values.length;
    }
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "EntryList",
    valueInputOption: "USER_ENTERED",
    requestBody: {values: [[nextId, bewerbId, personenId, datum]]},
  });
  return {id: nextId};
}

export const addEntryList = onCall(async (request) => {
  try {
    const sheets = await getSheetsClient(false);
    const result = await addEntryListData(sheets, request.data);
    return {success: true, ...result};
  } catch (err) {
    console.error("Fehler in addEntryList:", err);
    return {success: false, error: err.message};
  }
});

export async function removeEntryListData(sheets, {bewerbId, personenId}) {
  const spreadsheet = await sheets.spreadsheets.get({spreadsheetId: SHEET_ID});
  const entrySheet = spreadsheet.data.sheets.find((s) => s.properties.title === "EntryList");
  if (!entrySheet) throw new Error("Tabelle EntryList nicht gefunden");
  const sheetId = entrySheet.properties.sheetId;

  const values = await readEntryListData(sheets);
  if (values.length < 2) throw new Error("Keine Einträge gefunden");

  const header = values[0].map((h) => String(h || "").trim().toLowerCase());
  const bewerbIdx = header.findIndex((h) => {
    const names = ["bewerbid", "bewerb id", "bewerb-id", "bewerb", "bewerbsid", "bewerbs id"];
    return names.includes(h);
  });
  const personenIdx = header.findIndex((h) => {
    const names = ["personenid", "personen id", "personen-id", "personid",
      "person id", "playerid", "player id", "spielerid", "spieler id"];
    return names.includes(h);
  });

  if (bewerbIdx === -1 || personenIdx === -1) throw new Error("Spalten nicht gefunden");

  const rowIndex = values.findIndex((r, i) =>
    i > 0 &&
    String(r[bewerbIdx] || "").trim() === String(bewerbId).trim() &&
    String(r[personenIdx] || "").trim() === String(personenId).trim());

  if (rowIndex === -1) throw new Error("Kein passender Eintrag gefunden");

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1},
        },
      }],
    },
  });
}

export const removeEntryList = onCall(async (request) => {
  try {
    const sheets = await getSheetsClient(false);
    await removeEntryListData(sheets, request.data);
    return {success: true};
  } catch (err) {
    console.error("Fehler in removeEntryList:", err);
    return {success: false, error: err.message};
  }
});
