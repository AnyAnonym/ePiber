/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";

export async function readRlPlatzierungData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "RL-Platzierung",
  });
  return res.data.values || [];
}

export const readRlPlatzierung = onCall({region: "europe-west3", invoker: "public"}, async () => {
  try {
    const sheets = await getSheetsClient(true);
    const values = await readRlPlatzierungData(sheets);
    return {success: true, values};
  } catch (err) {
    console.error("Fehler in readRlPlatzierung:", err);
    return {success: false, error: err.message};
  }
});

export async function swapRanksData(sheets, p1, p3) {
  const values = await readRlPlatzierungData(sheets);
  if (values.length < 2) return {rankingUpdated: false};

  const header = values[0].map((h) => h.trim().toLowerCase());
  const rangIdx = header.indexOf("rang");
  const pidIdx = header.indexOf("personid");

  if (rangIdx === -1 || pidIdx === -1) return {rankingUpdated: false};

  let rangP1 = -1;
  let rangP3 = -1;

  for (let i = 1; i < values.length; i++) {
    const playerId = String(values[i][pidIdx] || "").trim();
    if (playerId === p1) rangP1 = parseInt(values[i][rangIdx], 10);
    if (playerId === p3) rangP3 = parseInt(values[i][rangIdx], 10);
  }

  if (rangP1 <= 0 || rangP3 <= 0 || rangP3 <= rangP1) return {rankingUpdated: false};

  for (let i = 1; i < values.length; i++) {
    const aktRang = parseInt(values[i][rangIdx], 10);
    if (aktRang > rangP1 && aktRang < rangP3) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: "RL-Platzierung!B" + (i + 1),
        valueInputOption: "USER_ENTERED",
        requestBody: {values: [[aktRang + 1]]},
      });
    }
  }

  const fordererRowIdx = values.findIndex((r) => String(r[pidIdx] || "").trim() === p3);
  if (fordererRowIdx > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "RL-Platzierung!B" + (fordererRowIdx + 1),
      valueInputOption: "USER_ENTERED",
      requestBody: {values: [[rangP1]]},
    });
  }

  const geforderterRowIdx = values.findIndex((r) => String(r[pidIdx] || "").trim() === p1);
  if (geforderterRowIdx > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "RL-Platzierung!B" + (geforderterRowIdx + 1),
      valueInputOption: "USER_ENTERED",
      requestBody: {values: [[rangP3]]},
    });
  }

  return {rankingUpdated: true};
}
