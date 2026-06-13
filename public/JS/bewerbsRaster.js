import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readEntryList    = httpsCallable(functions, "readEntryList");
const readPlayersList  = httpsCallable(functions, "readPlayersList");
const readBewerbe      = httpsCallable(functions, "readBewerbe");

const params = new URLSearchParams(window.location.search);
const BEWERB_ID = params.get("id");

function buildBracket(players) {
  if (players.length === 0) return [];

  const n = players.length;
  const size = Math.pow(2, Math.ceil(Math.log2(n)));
  const rounds = Math.log2(size);
  const tree = [];

  for (let r = 0; r < rounds; r++) {
    const matchesInRound = size / Math.pow(2, r + 1);
    tree[r] = [];
    for (let m = 0; m < matchesInRound; m++) {
      tree[r][m] = { top: null, bottom: null };
    }
  }

  for (let i = 0; i < size; i++) {
    const player = i < n ? players[i] : null;
    const matchIdx = Math.floor(i / 2);
    if (i % 2 === 0) {
      tree[0][matchIdx].top = player;
    } else {
      tree[0][matchIdx].bottom = player;
    }
  }

  return tree;
}

function renderBracket(tree) {
  const container = document.getElementById("bracketContainer");
  if (!container) return;

  container.innerHTML = "";

  if (!tree || tree.length === 0) {
    container.innerHTML = "<p>Keine Spieler im Raster.</p>";
    return;
  }

  const roundNames = ["Achtelfinale", "Viertelfinale", "Halbfinale", "Finale"];
  const numRounds = tree.length;

  const bracketDiv = document.createElement("div");
  bracketDiv.className = "bracket";

  tree.forEach((round, rIdx) => {
    const roundDiv = document.createElement("div");
    roundDiv.className = "bracket-round";

    const roundNum = numRounds - rIdx;
    const label = roundNames[roundNum - 1] || `Runde ${roundNum}`;

    const header = document.createElement("div");
    header.className = "bracket-round-header";
    header.textContent = label;
    roundDiv.appendChild(header);

    round.forEach((match) => {
      const matchDiv = document.createElement("div");
      matchDiv.className = "bracket-match";

      [match.top, match.bottom].forEach((entry) => {
        const div = document.createElement("div");
        div.className = "bracket-player";
        if (entry) {
          div.textContent = entry.name;
          div.dataset.playerId = entry.id;
          div.addEventListener("click", () => {
            if (typeof window.openProfileModal === "function") {
              window.openProfileModal(entry.id);
            }
          });
        } else {
          div.textContent = "—";
          div.classList.add("bye");
        }
        matchDiv.appendChild(div);
      });

      roundDiv.appendChild(matchDiv);
    });

    bracketDiv.appendChild(roundDiv);
  });

  container.appendChild(bracketDiv);
}

async function loadBracket() {
  const heading = document.getElementById("bracketHeading");
  const info = document.getElementById("bracketInfo");
  const container = document.getElementById("bracketContainer");

  if (!BEWERB_ID) {
    if (heading) heading.textContent = "Keine Bewerb-ID";
    if (container) container.innerHTML = "<p>Bitte eine Bewerb-ID angeben.</p>";
    return;
  }

  if (container) container.innerHTML = "<p class='loading-text'>Lade Raster...</p>";

  try {
    const [bewerbRes, entryRes, playerRes] = await Promise.all([
      readBewerbe(),
      readEntryList({ bewerbId: BEWERB_ID }),
      readPlayersList(),
    ]);

    const bewerbValues = bewerbRes.data?.values || [];
    const entryValues = entryRes.data?.values || [];
    const playerValues = playerRes.data?.values || [];

    let bewerbName = `Bewerb ${BEWERB_ID}`;
    if (bewerbValues.length > 1) {
      const bHeader = bewerbValues[0].map((h) => h.trim().toLowerCase());
      const bIdIdx = bHeader.indexOf("id");
      const bBezIdx = bHeader.indexOf("bezeichnung");
      const row = bewerbValues.slice(1).find(
        (r) => String(r[bIdIdx] || "").trim() === String(BEWERB_ID).trim());
      if (row && row[bBezIdx]) bewerbName = row[bBezIdx];
    }

    if (heading) heading.textContent = `Turnierraster – ${bewerbName}`;

    const playerMap = new Map();
    if (playerValues.length > 1) {
      const pHeader = playerValues[0].map((h) => h.trim().toLowerCase());
      const pIdIdx = pHeader.indexOf("id");
      const pFnIdx = pHeader.indexOf("vorname");
      const pLnIdx = pHeader.indexOf("nachname");
      playerValues.slice(1).forEach((r) => {
        const id = String(r[pIdIdx] || "").trim();
        const name = `${(r[pFnIdx] || "").trim()} ${(r[pLnIdx] || "").trim()}`.trim();
        if (id) playerMap.set(id, name);
      });
    }

    let playerIds = [];
    if (entryValues.length > 1) {
      const eHeader = entryValues[0].map((h) => h.trim().toLowerCase());
      const eBewerbIdx = eHeader.findIndex((h) =>
        ["bewerbid", "bewerb id", "bewerb-id", "bewerb", "bewerbsid", "bewerbs id"].includes(h));
      const ePersonenIdx = eHeader.findIndex((h) =>
        ["personenid", "personen id", "personen-id", "personid",
          "person id", "playerid", "player id", "spielerid", "spieler id"].includes(h));
      playerIds = entryValues.slice(1)
        .filter((r) => String(r[eBewerbIdx] || "").trim() === String(BEWERB_ID).trim())
        .map((r) => String(r[ePersonenIdx] || "").trim())
        .filter(Boolean);
    }

    if (playerIds.length === 0) {
      if (container) container.innerHTML = "<p>Keine Eintragungen für diesen Bewerb.</p>";
      if (info) info.textContent = "";
      return;
    }

    const players = playerIds.map((id) => ({
      id,
      name: playerMap.get(id) || `Spieler ${id}`,
    }));

    if (info) {
      info.innerHTML = `<span class="bracket-player-count">${players.length} Teilnehmer</span>`;
    }

    const tree = buildBracket(players);
    renderBracket(tree);

  } catch (err) {
    console.error("Fehler beim Laden des Turnierrasters:", err);
    if (container) container.innerHTML = `<p>Fehler: ${err.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadBracket();
});
