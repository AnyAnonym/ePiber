import { createEndpoint } from "./dataClient.js";

const readRlPlatzierung = createEndpoint("rlPlatzierung");
const readPlayersList   = createEndpoint("players");

const params = new URLSearchParams(window.location.search);
const BEWERB_ID = params.get("id") || document.getElementById("rankingContainer")?.dataset.bewerbId || "2";

function createSidebarHTML() {
  const container = document.getElementById("sidebar-container");
  if (!container) return;

  const placeholderItems = Array(10).fill('<li><span class="player-name">–</span></li>').join("");

  container.innerHTML = `
  <div class="sidebar">
    <h2>Top 10 Rangliste</h2>
    <ol id="ranking-list" class="ranking-list">
      ${placeholderItems}
    </ol>
  </div>
  `;
}

async function loadRanking() {
  try {
    console.log("⏳ Rangliste (Sidebar) wird geladen...", `(BewerbID: ${BEWERB_ID})`);

    const [rankRes, playersRes] = await Promise.all([
      readRlPlatzierung(),
      readPlayersList(),
    ]);

    if (!rankRes.data?.success || !playersRes.data?.success) {
      console.error("❌ Fehler beim Laden der Ranglisten-Daten");
      return [];
    }

    const rankValues = rankRes.data.values || [];
    const playerValues = playersRes.data.values || [];

    if (rankValues.length < 2 || playerValues.length < 2) return [];

    const rHeader = rankValues[0].map((h) => h.trim().toLowerCase());
    const bewerbIdIdx = rHeader.indexOf("bewerbid");
    const rankIdx = rHeader.indexOf("rang");
    const personIdIdx = rHeader.indexOf("personid");

    const pHeader = playerValues[0].map((h) => h.trim().toLowerCase());
    const pIdIdx = pHeader.indexOf("id");
    const pFnIdx = pHeader.indexOf("vorname");
    const pLnIdx = pHeader.indexOf("nachname");

    const playerMap = new Map();
    playerValues.slice(1).forEach((r) => {
      const id = r[pIdIdx];
      const name = `${(r[pFnIdx] || "").trim()} ${(r[pLnIdx] || "").trim()}`.trim();
      playerMap.set(id, name);
    });

    const rankedList = rankValues.slice(1)
      .filter((row) => {
        const bewerbId = String(row[bewerbIdIdx] || "").trim();
        return !BEWERB_ID || bewerbId === BEWERB_ID;
      })
      .map((row) => ({
        rank: Number(row[rankIdx]),
        name: playerMap.get(row[personIdIdx]) || "Unbekannt",
      }))
      .sort((a, b) => a.rank - b.rank);

    console.log(`🏆 ${rankedList.length} Spieler empfangen (Sidebar)`);
    return rankedList;
  } catch (err) {
    console.error("❌ Fehler beim Laden der Sidebar-Rangliste:", err);
    return [];
  }
}

async function renderTopRanking() {
  createSidebarHTML();

  const listElement = document.getElementById("ranking-list");
  if (!listElement) return;

  const rankedList = await loadRanking();
  const filledList = Array.isArray(rankedList) ? [...rankedList] : [];

  for (let r = filledList.length + 1; r <= 10; r++) {
    filledList.push({rank: r, name: "-"});
  }

  filledList.sort((a, b) => a.rank - b.rank);
  const top10 = filledList.slice(0, 10);

  listElement.innerHTML = top10
    .map((player) => `<li><span class="player-name">${player.name}</span></li>`)
    .join("");

  console.log("✅ Sidebar-Top10 erfolgreich aktualisiert.");
}

window.addEventListener("load", renderTopRanking);
