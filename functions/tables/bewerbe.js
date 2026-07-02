/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";

export async function readBewerbeData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Bewerb",
  });
  return res.data.values || [];
}

export const readBewerbe = onCall(async () => {
  try {
    const sheets = await getSheetsClient(true);
    const values = await readBewerbeData(sheets);
    return {success: true, values};
  } catch (err) {
    console.error("Fehler in readBewerbe:", err);
    return {success: false, error: err.message};
  }
});
