import {functions} from "./SDK.js";
import {httpsCallable} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

window.addEventListener("load", main);

function getWalkoverTeam(sets) {
  for (const set of sets) {
    if (!set.includes("[w.o.]")) continue;
    const parts = set.split("-");
    if (parts[0] && parts[0].includes("[w.o.]")) return "team1";
    if (parts[1] && parts[1].includes("[w.o.]")) return "team2";
  }
  return null;
}

function parseSheetDate(raw) {
  if (!raw) return "";
  const rawStr = String(raw).trim();
  const match = rawStr.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!match) return rawStr;
  const [, yy, mm, dd, hh, mi] = match;
  const yyyy = parseInt(yy, 10) >= 50 ? "19" + yy : "20" + yy;
  return `${dd}.${mm}.${yyyy} - ${hh}:${mi}`;
}

function formatSetScore(raw) {
  if (!raw) return "";
  return String(raw).replace(/\((\d+)\)/g, (_, tiebreak) => {
    const superscripts = {"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹"};
    return tiebreak.split("").map((d) => superscripts[d] || d).join("");
  });
}

async function main() {
  const container = document.getElementById("matches-container");
  if (!container) return;
  container.innerHTML = "<p>Lade Matches...</p>";

  try {
    const readMatchesList = httpsCallable(functions, "readMatchesList");
    const readPlayersList = httpsCallable(functions, "readPlayersList");
    const readBewerbe = httpsCallable(functions, "readBewerbe");

    const [matchesRes, playersRes, bewerbeRes] = await Promise.all([
      readMatchesList(),
      readPlayersList(),
      readBewerbe(),
    ]);

    if (!matchesRes.data?.success) throw new Error(matchesRes.data?.error || "Fehler beim Laden der Matches");
    if (!playersRes.data?.success) throw new Error(playersRes.data?.error || "Fehler beim Laden der Spieler");

    const matchesValues = matchesRes.data.values || [];
    const playersValues = playersRes.data.values || [];
    const bewerbeValues = bewerbeRes.data?.values || [];

    if (matchesValues.length < 2) {
      container.innerHTML = "<p>Keine Matches gefunden.</p>";
      return;
    }

    const playerHeader = playersValues[0].map((h) => h.trim().toLowerCase());
    const pIdIdx = playerHeader.indexOf("id");
    const pFnIdx = playerHeader.indexOf("vorname");
    const pLnIdx = playerHeader.indexOf("nachname");
    const playerMap = new Map();
    playersValues.slice(1).forEach((r) => {
      const id = r[pIdIdx];
      const name = `${r[pFnIdx] || ""} ${r[pLnIdx] || ""}`.trim();
      playerMap.set(id, name);
    });

    const bewerbMap = new Map();
    if (bewerbeValues.length > 1) {
      const bHeader = bewerbeValues[0].map((h) => h.trim().toLowerCase());
      const bIdIdx = bHeader.indexOf("id");
      const bBezIdx = bHeader.indexOf("bezeichnung");
      bewerbeValues.slice(1).forEach((r) => {
        const id = String(r[bIdIdx] || "").trim();
        if (id) bewerbMap.set(id, String(r[bBezIdx] || "").trim());
      });
    }

    const header = matchesValues[0].map((h) => h.trim().toLowerCase());
    const idx = (label) => header.findIndex((v) => v.includes(label));
    const i1 = idx("spielerid1");
    const i3 = idx("spielerid3");
    const i2 = idx("spielerid2");
    const i4 = idx("spielerid4");
    const ergebnisIdx = idx("ergebnis");
    const d = idx("zeitpunkt");
    const gewinnerIdx = idx("gewinner");
    const bewerbIdIdx = idx("bewerbid");

    function dateToTs(raw) {
      if (!raw) return Infinity;
      const m = String(raw).trim().match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
      if (!m) return Infinity;
      const [, yy, mm, dd, hh, mi] = m;
      const yyyy = parseInt(yy, 10) >= 50 ? 1900 + parseInt(yy) : 2000 + parseInt(yy);
      return new Date(yyyy, parseInt(mm) - 1, parseInt(dd), parseInt(hh), parseInt(mi)).getTime();
    }
    const now = Date.now();

    const matches = matchesValues.slice(1)
      .filter((row) => row && row[i1])
      .sort((a, b) => Math.abs(dateToTs(a[d]) - now) - Math.abs(dateToTs(b[d]) - now))
      .map((row) => {
        const ergebnisRaw = row[ergebnisIdx] || "";
        const sets = ergebnisRaw ? ergebnisRaw.split("/").map((s) => formatSetScore(s)) : [];
        const bewerbId = bewerbIdIdx !== -1 ? String(row[bewerbIdIdx] || "").trim() : "";

        return {
          date: parseSheetDate(row[d]),
          players: [
            playerMap.get(row[i1]) || "---",
            playerMap.get(row[i2]) || "---",
            playerMap.get(row[i3]) || "---",
            playerMap.get(row[i4]) || "---",
          ],
          playerIds: [
            row[i1] || "",
            row[i2] || "",
            row[i3] || "",
            row[i4] || "",
          ],
          winnerId: gewinnerIdx !== -1 ? String(row[gewinnerIdx] || "").trim() : "",
          sets,
          ergebnis: ergebnisRaw.split("/").map((s) => formatSetScore(s)).join("/"),
          bewerbName: bewerbMap.get(bewerbId) || "",
        };
      });

    if (matches.length === 0) {
      container.innerHTML = "<p>Keine Matches gefunden.</p>";
      return;
    }

    container.innerHTML = matches.map((m) => {
      const [p1, p2, p3, p4] = m.players;
      const [id1, id2, id3, id4] = m.playerIds || [];
      const sets = [...(m.sets || []), "---", "---", "---"].slice(0, 3);

      const team1Won = m.winnerId && (m.winnerId === id1 || m.winnerId === id2);
      const team2Won = m.winnerId && (m.winnerId === id3 || m.winnerId === id4);
      const woTeam = m.sets ? getWalkoverTeam(m.sets) : null;
      const team1Wo = woTeam === "team1";
      const team2Wo = woTeam === "team2";

      return `
        <div class="match-card">
          <div class="match-meta-row">
            <span class="match-date">${m.date}</span>
            ${m.bewerbName ? `<div class="match-meta-right"><span class="badge-bewerb">Bewerb: ${m.bewerbName}</span></div>` : ""}
          </div>
          <div class="match-content">
            <div class="team${team1Won ? " team-winner" : ""}">
              <div class="player main">${p1}${team1Wo ? ' <span class="badge badge-wo">w.o.</span>' : ""}</div>
              <div class="player sub">${p2}</div>
            </div>
            <div class="vs">vs.</div>
            <div class="team${team2Won ? " team-winner" : ""}">
              <div class="player main">${p3}${team2Wo ? ' <span class="badge badge-wo">w.o.</span>' : ""}</div>
              <div class="player sub">${p4}</div>
            </div>
            <div class="sets">
              ${sets.map((s) => `<div class="set">${s.replace("[w.o.]", "")}</div>`).join("")}
            </div>
          </div>
        </div>
      `;
    }).join("");

  } catch (err) {
    console.error("Fehler in main():", err);
    container.innerHTML = `<p style="color:red">Fehler beim Laden der Matches: ${err.message}</p>`;
  }
}
