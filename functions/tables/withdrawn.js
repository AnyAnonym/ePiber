/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";
import {logEntry, buildPlayerMap, buildBewerbMap, fmtPlayer, fmtBewerb} from "./logging.js";

export async function withdrawFromRankingData(sheets, {reason, currentRank, bewerbId, userId}) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const dateTimeStr = `${yy}${mm}${dd}-${hh}${mi}`;

  const values = [[bewerbId, userId, reason, dateTimeStr, currentRank]];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Withdrawn!A:E",
    valueInputOption: "USER_ENTERED",
    resource: {values},
  });
  return {message: "Erfolgreich gespeichert"};
}

export const withdrawFromRanking = onCall({region: "europe-west3"}, async (request) => {
  try {
    const reason = request.data?.reason ? String(request.data.reason).trim() : "";
    const currentRank = request.data?.rank ? String(request.data.rank).trim() : "?";
    const bewerbId = request.data?.bewerbId ? String(request.data.bewerbId).trim() : "2";
    const userId = request.data?.userId ? String(request.data.userId).trim() : "?";

    if (!reason) return {success: false, error: "Grund erforderlich"};

    const sheets = await getSheetsClient(false);
    const result = await withdrawFromRankingData(sheets, {reason, currentRank, bewerbId, userId});
    const pmap = await buildPlayerMap(sheets);
    const bmap = await buildBewerbMap(sheets);
    logEntry({sheets, source: "withdrawFromRanking", entry: `Rückzug: ${fmtPlayer(userId, pmap)} (Bewerb ${fmtBewerb(bewerbId, bmap)}) — ${reason}`});
    return {success: true, ...result};
  } catch (err) {
    console.error("Fehler in withdrawFromRanking:", err);
    return {success: false, error: err.message};
  }
});
