/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {getSheetsClient} from "../config.js";
import {readPlayersData} from "../tables/personen.js";
import {readPreMatchesData, createPreMatchData, getNextPreMatchId} from "../tables/preMatches.js";
import {readMatchRestrictionsData} from "../tables/matches.js";
import {logEntry, buildMap, buildBewerbMap, fmtPlayer, fmtBewerb} from "../tables/logging.js";

export const addMatch = onCall(async (request) => {
  try {
    const {
      player1Id,
      player2Id = "",
      player3Id,
      player4Id = "",
      bewerbId = "2",
    } = request.data || {};

    if (!player1Id || !player3Id) {
      return {success: false, error: "player1Id und player3Id müssen gesetzt sein"};
    }

    const sheets = await getSheetsClient(false);

    const p1id = player1Id.toString().trim();
    const p2id = player2Id.toString().trim();
    const p3id = player3Id.toString().trim();
    const p4id = player4Id.toString().trim();
    const resolvedBewerbId = bewerbId.toString().trim() || "2";

    const playersValues = await readPlayersData(sheets);
    if (playersValues.length < 2) {
      return {success: false, error: "Keine Spieler in Personen-Tabelle gefunden."};
    }
    const pHeader = playersValues[0].map((h) => (h || "").trim().toLowerCase());
    const idIdx = pHeader.indexOf("id");
    if (idIdx === -1) return {success: false, error: "Personen-Tabelle muss Spalte ID enthalten."};

    const validIds = new Set(playersValues.slice(1).map((r) => (r[idIdx] || "").toString().trim()));
    const missingIds = [];
    if (!validIds.has(p1id)) missingIds.push(`player1Id '${p1id}'`);
    if (!validIds.has(p3id)) missingIds.push(`player3Id '${p3id}'`);
    if (p2id && !validIds.has(p2id)) missingIds.push(`player2Id '${p2id}'`);
    if (p4id && !validIds.has(p4id)) missingIds.push(`player4Id '${p4id}'`);
    if (missingIds.length > 0) {
      return {success: false, error: `ID(s) nicht gefunden: ${missingIds.join(", ")}`};
    }

    const preValues = await readPreMatchesData(sheets);
    if (preValues.length > 1) {
      const preHeader = preValues[0].map((h) => h.trim().toLowerCase());
      const i1 = preHeader.indexOf("spielerid1");
      const i2 = preHeader.indexOf("spielerid2");
      const i3 = preHeader.indexOf("spielerid3");
      const i4 = preHeader.indexOf("spielerid4");
      const st = preHeader.indexOf("status");
      const bIdx = preHeader.indexOf("bewerbid");

      for (let i = 1; i < preValues.length; i++) {
        const row = preValues[i];
        const rowBewerb = bIdx !== -1 ? String(row[bIdx] || "").trim() : "";
        if (rowBewerb !== resolvedBewerbId) continue;
        const rowStatus = String(row[st] || "offen").trim().toLowerCase();
        if (rowStatus === "offen" || rowStatus === "bestaetigt") {
          const existing = [
            String(row[i1] || "").trim(),
            String(row[i2] || "").trim(),
            String(row[i3] || "").trim(),
            String(row[i4] || "").trim(),
          ];
          const blocked = [p1id, p3id].find((p) => existing.includes(p));
          if (blocked) {
            const isMe = (blocked === p3id);
            return {
              success: false,
              error: isMe ?
                "Du hast bereits eine offene Herausforderung! Bitte warte, bis diese abgeschlossen ist." :
                "Dieser Spieler hat bereits eine offene Herausforderung und kann derzeit nicht gefordert werden.",
            };
          }
        }
      }
    }

    const restrictions = await readMatchRestrictionsData(sheets, {bewerbId: resolvedBewerbId});
    const now = new Date();

    for (const entry of restrictions.schutzzeit) {
      if (entry.id === p1id) {
        const remainingMs = new Date(entry.until) - now;
        const remDays = Math.floor(remainingMs / 86400000);
        const remHours = Math.floor((remainingMs % 86400000) / 3600000);
        return {success: false, error: `Geforderte(r) steht unter Schutzzeit (noch ${remDays}T ${remHours}h verbleibend)`};
      }
    }
    for (const entry of restrictions.sperrzeit) {
      if (entry.id === p3id) {
        const remainingMs = new Date(entry.until) - now;
        const remDays = Math.floor(remainingMs / 86400000);
        const remHours = Math.floor((remainingMs % 86400000) / 3600000);
        return {success: false, error: `Sie stehen unter Sperrzeit (noch ${remDays}T ${remHours}h verbleibend)`};
      }
    }

    let zeitpunktForderung = request.data.zeitpunktForderung;
    if (!zeitpunktForderung) {
      const jetzt = new Date();
      const yy = String(jetzt.getFullYear()).slice(2);
      const mm = String(jetzt.getMonth() + 1).padStart(2, "0");
      const dd = String(jetzt.getDate()).padStart(2, "0");
      const hh = String(jetzt.getHours()).padStart(2, "0");
      const mi = String(jetzt.getMinutes()).padStart(2, "0");
      zeitpunktForderung = `${yy}${mm}${dd}-${hh}${mi}`;
    }

    const newId = await getNextPreMatchId(sheets);
    const result = await createPreMatchData(sheets, {newId, zeitpunktForderung, bewerbId: resolvedBewerbId, p1id, p2id, p3id, p4id});
    const pmap = buildMap(playersValues, "id", "vorname", "nachname");
    const bmap = await buildBewerbMap(sheets);
    logEntry({sheets, source: "addMatch", entry: `Neue Forderung: ${fmtPlayer(p1id, pmap)} vs ${fmtPlayer(p3id, pmap)} (Bewerb ${fmtBewerb(resolvedBewerbId, bmap)})`});
    return {success: true, updates: result.updates};
  } catch (err) {
    console.error("Fehler in addMatch:", err);
    return {success: false, error: err.message};
  }
});
