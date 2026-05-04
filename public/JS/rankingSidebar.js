import { functions } from "./SDK.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readRankedPlayers = httpsCallable(functions, "readRankedPlayers");

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
    const response = await readRankedPlayers({ bewerbId: BEWERB_ID });
    const { data } = response || {};

    if (!data?.success || !Array.isArray(data.rankedList)) {
      console.error("❌ Ungültige Daten erhalten:", data);
      return [];
    }

    console.log(`🏆 ${data.rankedList.length} Spieler empfangen (Sidebar)`);
    return data.rankedList;
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
    filledList.push({ rank: r, name: "-" });
  }

  filledList.sort((a, b) => a.rank - b.rank);
  const top10 = filledList.slice(0, 10);

  listElement.innerHTML = top10
    .map((player) => `<li><span class="player-name">${player.name}</span></li>`)
    .join("");

  console.log("✅ Sidebar-Top10 erfolgreich aktualisiert.");
}

window.addEventListener("load", renderTopRanking);
