import { functions } from "./SDK.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

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

async function main() {
  const container = document.getElementById("matches-container");
  container.innerHTML = "<p>Lade Matches...</p>";

  try {
    const readFullMatches = httpsCallable(functions, "readFullMatches");
    const result = await readFullMatches();

    if (!result.data?.success) {
      throw new Error(result.data?.error || "Unbekannter Fehler");
    }

    const matches = result.data.matches || [];
    console.log("✅ Dynamische Matches:", matches);

    if (matches.length === 0) {
      container.innerHTML = "<p>Keine Matches gefunden.</p>";
      return;
    }

    // HTML-Struktur rendern
    container.innerHTML = matches
      .map((m) => {
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
            <div class="match-date">${m.date}</div>
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
      })
      .join("");

  } catch (err) {
    console.error("❌ Fehler in main():", err);
    container.innerHTML = `<p style="color:red">Fehler beim Laden der Matches: ${err.message}</p>`;
  }
}
