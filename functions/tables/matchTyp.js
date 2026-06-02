import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";

export async function readMatchTypData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "MatchTyp",
  });
  return res.data.values || [];
}

export const readMatchTyp = onCall(async () => {
  try {
    const sheets = await getSheetsClient(true);
    const values = await readMatchTypData(sheets);
    return {success: true, values};
  } catch (err) {
    console.error("Fehler in readMatchTyp:", err);
    return {success: false, error: err.message};
  }
});
