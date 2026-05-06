import { functions } from "./SDK.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readRankedPlayers = httpsCallable(functions, "readRankedPlayers");
const readPlayerDetails = httpsCallable(functions, "readPlayerDetails");
const readPreMatches = httpsCallable(functions, "readPreMatches");

const params = new URLSearchParams(window.location.search);
const BEWERB_ID = params.get("id") || document.getElementById("rankingContainer")?.dataset.bewerbId || "2";

/**
 * Lädt die Rangliste aus dem Backend
 */
export async function loadRanking() {
  try {
    const response = await readRankedPlayers({ bewerbId: BEWERB_ID });
    const { data } = response || {};

    if (!data?.success || !Array.isArray(data.rankedList)) {
      console.error("❌ Keine gültigen Daten:", data);
      return [];
    }

    console.log(`🏆 ${data.rankedList.length} Spieler geladen (BewerbID: ${BEWERB_ID})`);
    return data.rankedList;
  } catch (err) {
    console.error("❌ Fehler beim Laden der Rangliste:", err);
    return [];
  }
}

/**
 * Baut die Ranglisten-Pyramide und markiert forderbare Spieler automatisch
 */
export async function renderRanking() {
  const container = document.getElementById("rankingContainer");
  if (!container) return;

  // Titel aktualisieren
  const h2 = document.querySelector("#rankingSection h2");
  if (h2) {
    if (BEWERB_ID === "2") h2.textContent = "Rangliste Herren";
    else if (BEWERB_ID === "3") h2.textContent = "Rangliste Damen";
    else h2.textContent = "Rangliste";
  }

  const rankedList = await loadRanking();
  container.innerHTML = "";

  if (!rankedList.length) {
    container.innerHTML = "<p>Es gibt noch keine Spieler für diese Rangliste.</p>";
    return;
  }

  rankedList.sort((a, b) => a.rank - b.rank);

  // ---------------------------------------------------
  // Pyramide aufbauen
  // ---------------------------------------------------
  const pyramid = [];
  let current = 0;
  let level = 1;

  while (current < rankedList.length) {
    const playersRemaining = rankedList.length - current;
    const rowSize = Math.min(level, playersRemaining);

    const row = document.createElement("div");
    row.className = "row";
    row.style.justifyContent = "flex-start";
    row.style.gap = "20px";

    const rowBoxes = [];

    for (let i = 0; i < rowSize && current < rankedList.length; i++, current++) {
      const player = rankedList[current];
      const box = document.createElement("div");
      box.className = "box";

      const [firstName, lastName] = player.name.split(" ");

      box.innerHTML = `
        <span class="box-rank-bg">${player.rank}</span>
        <span class="box-name">${firstName || ""}<br>${lastName || ""}</span>
      `;

      row.appendChild(box);

      box.addEventListener("click", () => {
        window.openProfileModal({
          playerId: player.playerId || "",
          boxElement: box,
        });
      });

      rowBoxes.push({ rank: player.rank, playerId: player.playerId, name: player.name, box });
    }

    // visuelle Balance
    const expectedFullSize = level;
    if (rowSize < expectedFullSize) {
      for (let i = 0; i < expectedFullSize - rowSize; i++) {
        const placeholder = document.createElement("div");
        placeholder.className = "box";
        placeholder.style.visibility = "hidden";
        row.appendChild(placeholder);
      }
    }

    pyramid.push(rowBoxes);
    container.appendChild(row);
    level++;
  }

  // ---------------------------------------------------
  // Hilfsfunktionen
  // ---------------------------------------------------
  const clearHighlights = async () => {
    // 1. Lade offene Forderungen (PreMatches)
    let busyPlayerIds = new Set(); 
    try {
      const preMatchesRes = await readPreMatches(); 
      const { success, preMatches } = preMatchesRes.data || {};
      
      if (success && Array.isArray(preMatches)) {
        preMatches.forEach(pm => {
          // Nur relevante Status berücksichtigen
          if (pm.status === "offen" || pm.status === "bestaetigt") {
            // RICHTIGE KEYS (camelCase) verwenden: player1Id statt spielerid1
            [pm.player1Id, pm.player2Id, pm.player3Id, pm.player4Id].forEach(id => {
              if (id) busyPlayerIds.add(String(id));
            });
          }
        });
      }
    } catch (err) {
      console.warn("⚠️ Konnte Forderungen nicht laden:", err);
    }

    const markChallengeables = (myRowIndex, myIndex) => {
      container.querySelectorAll(".box").forEach(b =>
        b.classList.remove("selected", "challengeable", "challenged")
      );

      const me = pyramid[myRowIndex]?.[myIndex];
      if (!me) return;
      me.box.classList.add("selected");
      const myRank = me.rank;

      const markChallengeableBox = (boxData) => {
        if (!boxData?.box) return;
        if (String(boxData.playerId) === String(me.playerId)) return;
        boxData.box.classList.add("challengeable");
        boxData.box.style.cursor = "grab";
      };

      const markBusyBox = (boxData) => {
        if (!boxData?.box) return;
        if (String(boxData.playerId) === String(me.playerId)) return;
        if (!busyPlayerIds.has(String(boxData.playerId))) return;

        boxData.box.classList.remove("challengeable");
        boxData.box.classList.add("challenged");
        boxData.box.style.cursor = "not-allowed";
      };

      // Links von mir in der gleichen Reihe
      if (Array.isArray(pyramid[myRowIndex])) {
        for (let i = 0; i < myIndex; i++) {
          markChallengeableBox(pyramid[myRowIndex][i]);
        }
      }

      // Rechts über mir (Reihe darüber)
      const rowAbove = pyramid[myRowIndex - 1];
      if (Array.isArray(rowAbove)) {
        for (let j = myIndex; j < rowAbove.length; j++) {
          markChallengeableBox(rowAbove[j]);
        }
      }

      // Sonderregel Rang 3
      if (myRank === 3) {
        const flat = pyramid.flat();
        const rank1 = flat.find(p => p.rank === 1);
        markChallengeableBox(rank1);
      }

      pyramid.flat().forEach(markBusyBox);
    };

    try {
      const currentUserEmail =
        localStorage.getItem("currentUserEmail") ||
        localStorage.getItem("loggedInEmail");

      if (!currentUserEmail) {
        console.warn("⚠ Kein Benutzer eingeloggt – keine Markierung.");
        return;
      }

      const response = await readPlayerDetails();
      const { success, players } = response.data || {};

      if (!success || !Array.isArray(players)) {
        console.error("❌ Spieler-Liste konnte nicht geladen werden.");
        return;
      }

      const mePlayer = players.find(
        p => p.email.trim().toLowerCase() === currentUserEmail.trim().toLowerCase()
      );

      if (!mePlayer) {
        console.warn("⚠ Kein Spieler mit dieser E-Mail gefunden.");
        return;
      }

      const myFullName = mePlayer.fullName.trim().toLowerCase();
      const myEntry = rankedList.find(
        p => p.name.trim().toLowerCase() === myFullName
      );

      if (!myEntry) {
        console.warn(`⚠ Kein Rang gefunden für ${myFullName}`);
        return;
      }

      if (myEntry.playerId) {
        localStorage.setItem("currentUserId", myEntry.playerId);
      }

      const myRank = myEntry.rank;

      let foundRow = -1;
      let foundIndex = -1;

      for (let r = 0; r < pyramid.length; r++) {
        const idx = pyramid[r].findIndex(p => p.rank === myRank);
        if (idx !== -1) {
          foundRow = r;
          foundIndex = idx;
          break;
        }
      }

      if (foundRow !== -1) {
        markChallengeables(foundRow, foundIndex);
      }
    } catch (err) {
      console.error("❌ Fehler bei der automatischen Markierung:", err);
    }
  };

  clearHighlights();
}

// Seite ready -> Rangliste aufbauen
document.addEventListener("DOMContentLoaded", () => {
  renderRanking();
});
