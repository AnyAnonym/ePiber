/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {getSheetsClient} from "../config.js";
import {readPreMatchesData, clearPreMatchRowData} from "../tables/preMatches.js";
import {createMatchData} from "../tables/matches.js";
import {swapRanksData} from "../tables/rlPlatzierung.js";
import {logEntry, buildPlayerMap, buildBewerbMap, fmtPlayer, fmtBewerb} from "../tables/logging.js";

export const setPreMatchResult = onCall({region: "europe-west3", invoker: "public"}, async (request) => {
  try {
    const {row, satz1, satz2, satz3, userId} = request.data || {};
    if (!row || !satz1 || !satz2 || !userId) {
      return {success: false, error: "Satz 1 und Satz 2 sind erforderlich"};
    }

    const sheets = await getSheetsClient(false);
    const preValues = await readPreMatchesData(sheets);
    if (preValues.length < 2 || row > preValues.length) {
      return {success: false, error: "PreMatch nicht gefunden"};
    }

    const preHeader = preValues[0].map((h) => h.trim().toLowerCase());
    const i1 = preHeader.indexOf("spieler1id");
    const i2 = preHeader.indexOf("spieler2id");
    const i3 = preHeader.indexOf("spieler3id");
    const i4 = preHeader.indexOf("spieler4id");
    const d = preHeader.indexOf("matchdate");
    const er = preHeader.indexOf("ergebnis");

    const matchRow = preValues[row - 1];
    const existingErgebnis = matchRow[er] || "";
    const ergebnisWert = satz1 + "/" + satz2 + (satz3 ? "/" + satz3 : "");

    if (existingErgebnis && existingErgebnis !== ergebnisWert) {
      return {success: false, error: "Anderes Ergebnis bereits eingetragen"};
    }

    const p1 = String(matchRow[i1] || "");
    const p2 = String(matchRow[i2] || "");
    const p3 = String(matchRow[i3] || "");
    const p4 = String(matchRow[i4] || "");
    const datum = matchRow[d] || "";

    const saetze = satz3 ? [satz1, satz2, satz3] : [satz1, satz2];
    let siegeP1 = 0;
    let siegeP3 = 0;
    saetze.forEach((s) => {
      if (s && s.includes(":")) {
        const teile = s.split(":");
        const punkte1 = parseInt(teile[0], 10);
        const punkte3 = parseInt(teile[1], 10);
        if (!isNaN(punkte1) && !isNaN(punkte3)) {
          if (punkte1 > punkte3) siegeP1++;
          else if (punkte3 > punkte1) siegeP3++;
        }
      }
    });
    const fordererGewonnen = siegeP3 > siegeP1;
    const gewinner = fordererGewonnen ? p3 : p1;

    await createMatchData(sheets, {datum, p1, p2, p3, p4, ergebnisWert, gewinner});
    await clearPreMatchRowData(sheets, row);

    let rankingUpdated = false;
    if (fordererGewonnen) {
      const result = await swapRanksData(sheets, p1, p3);
      rankingUpdated = result.rankingUpdated;
    }

    const pmap = await buildPlayerMap(sheets);
    const bmap = await buildBewerbMap(sheets);
    logEntry({sheets, source: "setPreMatchResult", entry: `Ergebnis: ${fmtPlayer(p1, pmap)} vs ${fmtPlayer(p3, pmap)} → ${ergebnisWert} (Gewinner: ${fmtPlayer(gewinner, pmap)}, Bewerb ${fmtBewerb(matchRow[preHeader.indexOf("bewerbid")] || "?", bmap)})`});
    return {success: true, rankingUpdated};
  } catch (err) {
    console.error("Fehler in setPreMatchResult:", err);
    return {success: false, error: err.message};
  }
});
