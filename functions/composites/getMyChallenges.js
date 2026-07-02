/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {getSheetsClient} from "../config.js";
import {readPlayersData} from "../tables/personen.js";
import {readPreMatchesData} from "../tables/preMatches.js";

export const getMyChallenges = onCall(async (request) => {
  try {
    const {userId} = request.data || {};
    if (!userId) return {success: false, error: "userId fehlt"};

    const sheets = await getSheetsClient(true);
    const [preValues, playerValues] = await Promise.all([
      readPreMatchesData(sheets),
      readPlayersData(sheets),
    ]);

    if (preValues.length < 2) return {success: true, challenges: []};

    const playerHeader = playerValues[0].map((h) => h.trim().toLowerCase());
    const pIdIdx = playerHeader.indexOf("id");
    const pFnIdx = playerHeader.indexOf("vorname");
    const pLnIdx = playerHeader.indexOf("nachname");

    const playerMap = new Map();
    playerValues.slice(1).forEach((r) => {
      const id = String(r[pIdIdx] || "");
      const name = (r[pFnIdx] || "") + " " + (r[pLnIdx] || "");
      playerMap.set(id, name.trim());
    });

    const preHeader = preValues[0].map((h) => h.trim().toLowerCase());
    const i1 = preHeader.indexOf("spielerid1");
    const i2 = preHeader.indexOf("spielerid2");
    const i3 = preHeader.indexOf("spielerid3");
    const d = preHeader.indexOf("zeitpunktmatch");

    const challenges = [];
    preValues.slice(1).forEach((row, rowIndex) => {
      const rowNum = rowIndex + 2;
      const p1 = String(row[i1] || "");
      const p2 = String(row[i2] || "");
      const p3 = String(row[i3] || "");
      const rawDatum = row[d] || "";

      if (p1 === userId && !rawDatum) {
        challenges.push({
          row: rowNum,
          player1: playerMap.get(p1) || p1,
          player2: playerMap.get(p2) || p2,
          player3: playerMap.get(p3) || p3,
        });
      }
    });

    return {success: true, challenges};
  } catch (err) {
    console.error("Fehler in getMyChallenges:", err);
    return {success: false, error: err.message};
  }
});
