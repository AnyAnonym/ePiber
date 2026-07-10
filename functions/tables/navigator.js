/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";

export async function readNavigatorData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Navigator",
  });
  return res.data.values || [];
}

export const readNavigator = onCall({region: "europe-west3"}, async () => {
  try {
    const sheets = await getSheetsClient(true);
    const values = await readNavigatorData(sheets);
    return {success: true, values};
  } catch (err) {
    console.error("Fehler in readNavigator:", err);
    return {success: false, error: err.message};
  }
});
