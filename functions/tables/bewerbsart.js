/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";

export async function readBewerbsartData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Bewerbsart",
  });
  return res.data.values || [];
}

export const readBewerbsart = onCall({region: "europe-west3"}, async () => {
  try {
    const sheets = await getSheetsClient(true);
    const values = await readBewerbsartData(sheets);
    return {success: true, values};
  } catch (err) {
    console.error("Fehler in readBewerbsart:", err);
    return {success: false, error: err.message};
  }
});
