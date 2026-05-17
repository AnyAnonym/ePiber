import { functions } from "./SDK.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readPreMatches = httpsCallable(functions, "readPreMatches");
const setPreMatchResultFn = httpsCallable(functions, "setPreMatchResult");
const setMatchDateFn = httpsCallable(functions, "setMatchDate");

//-------------------------------------------------------
// Modal: Datum und Platz setzen
//-------------------------------------------------------
function createDateModal() {
  const modal = document.createElement("div");
  modal.id = "dateModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-content">
      <span class="close">&times;</span>
      <h2>Datum festlegen</h2>
      <p>Match: <span id="dateMatchInfo" class="name-display"></span></p>
      <form id="dateForm">
        <label for="matchDate">Datum:</label>
        <input type="date" id="matchDate" required>

        <label for="matchTime">Uhrzeit:</label>
        <input type="time" id="matchTime" required>

        <button type="submit" class="btn-login">Speichern</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector(".close").addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.add("hidden");
    }
  });

  return modal;
}

const dateModal = createDateModal();
let currentDateRow = null;
let currentDateMatch = null;

function formatDateToSheet(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr || "00:00:00"}`);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yy}${mm}${dd}-${hh}${mi}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.openDateModal = (row, match) => {
  currentDateRow = row;
  currentDateMatch = match;
  const team1 = [match.player1, match.player2].filter(Boolean).join(" / ") || "---";
  const team2 = [match.player3, match.player4].filter(Boolean).join(" / ") || "---";
  document.getElementById("dateMatchInfo").textContent = `${team1} vs ${team2}`;

  document.getElementById("matchDate").value = "";
  document.getElementById("matchTime").value = "";
  dateModal.classList.remove("hidden");
};

window.closeDateModal = () => {
  dateModal.classList.add("hidden");
  currentDateRow = null;
  currentDateMatch = null;
};

document.getElementById("dateForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const dateVal = document.getElementById("matchDate").value.trim();
  const timeVal = document.getElementById("matchTime").value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');

  if (!dateVal || !timeVal) {
    showToast("Bitte Datum und Uhrzeit ausfüllen!", "error");
    return;
  }

  const datum = formatDateToSheet(dateVal, timeVal);

  submitBtn.disabled = true;
  submitBtn.textContent = "Speichern...";

  try {
    const result = await setMatchDateFn({
      row: currentDateRow,
      datum,
    });

    if (result.data?.success) {
      submitBtn.textContent = "Gespeichert!";
      setTimeout(() => {
        window.closeDateModal();
        loadPreMatches();
      }, 500);
    } else {
      throw new Error(result.data?.error || "Fehler");
    }
    } catch (err) {
      console.error("Fehler beim Setzen des Datums:", err);
      showToast("Fehler: " + err.message, "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Speichern";
    }
});

//-------------------------------------------------------
// Modal: Ergebnis eintragen
//-------------------------------------------------------
function createResultModal() {
  const modal = document.createElement("div");
  modal.id = "resultModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-content">
      <span class="close">&times;</span>
      <h2>Ergebnis eintragen</h2>
      <p>Match: <span id="resultMatchInfo" class="name-display"></span></p>
      <form id="resultForm">
        <div class="satz-input-group">
          <label for="satz1">Satz 1:</label>
          <input type="text" id="satz1" placeholder="z.B. 6:4" required pattern="\\d+:\\d+">
        </div>
        <div class="satz-input-group">
          <label for="satz2">Satz 2:</label>
          <input type="text" id="satz2" placeholder="z.B. 3:6" required pattern="\\d+:\\d+">
        </div>
        <div class="satz-input-group">
          <label for="satz3">Satz 3:</label>
          <input type="text" id="satz3" placeholder="z.B. 7:5" pattern="\\d+:\\d+">
        </div>
        <button type="submit" class="btn-login">Ergebnis senden</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector(".close").addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.add("hidden");
    }
  });

  return modal;
}

const resultModal = createResultModal();
let currentResultRow = null;

window.openResultModal = (row, matchInfo) => {
  currentResultRow = row;
  document.getElementById("resultMatchInfo").textContent = matchInfo;
  document.getElementById("satz1").value = "";
  document.getElementById("satz2").value = "";
  document.getElementById("satz3").value = "";
  resultModal.classList.remove("hidden");
};

window.closeResultModal = () => {
  resultModal.classList.add("hidden");
  currentResultRow = null;
};

document.getElementById("resultForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentResultRow) return;

  const userId = localStorage.getItem("currentUserId");
  if (!userId) {
    showToast("Bitte einloggen um das Ergebnis einzutragen.", "error");
    return;
  }

  const satz1 = document.getElementById("satz1").value.trim();
  const satz2 = document.getElementById("satz2").value.trim();
  const satz3 = document.getElementById("satz3").value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  submitBtn.textContent = "Senden...";

  try {
    const result = await setPreMatchResultFn({
      row: currentResultRow,
      satz1,
      satz2,
      satz3,
      userId,
    });

    if (result.data?.success) {
      submitBtn.textContent = "Gesendet!";
      setTimeout(() => {
        window.closeResultModal();
        loadPreMatches();
      }, 500);
    } else {
      throw new Error(result.data?.error || "Fehler");
    }
    } catch (err) {
      console.error("Fehler:", err);
      showToast("Fehler: " + err.message, "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Ergebnis senden";
    }
});

async function loadPreMatches() {
  const container = document.getElementById("preMatches-container");
  if (!container) return;

  const userId = localStorage.getItem("currentUserId") || null;

  container.innerHTML = "<p class='loading-text'>Lade offene Matches...</p>";

  try {
    const result = await readPreMatches({ userId });
    const { success, preMatches = [], error } = result.data || {};

    if (!success) {
      throw new Error(error || "Fehler beim Laden");
    }

    if (preMatches.length === 0) {
      container.innerHTML = "<p>Keine offenen Matches.</p>";
      return;
    }

    container.innerHTML = preMatches.map((match) => {
      const team1 = [match.player1, match.player2].filter(Boolean).join(" / ") || "---";
      const team2 = [match.player3, match.player4].filter(Boolean).join(" / ") || "---";
      const statusBadge = getStatusBadge(match.status, match.ergebnis);
      const actionButton = getActionButton(match, userId);
      const bewerbsartBadge = getBewerbsartBadge(match);

      return `
        <div class="match-card ${match.status === 'offen' ? 'status-offen' : match.status === 'bestaetigt' ? 'status-bestaetigt' : ''}">
          <div class="match-status">${bewerbsartBadge}${statusBadge}</div>
          <div class="match-meta-row">
            <div class="match-date">${match.datum || "Datum nicht festgelegt"}</div>
            <div class="match-bewerbsart-wrap"></div>
          </div>
          <div class="match-content">
            <div class="team">
              <div class="player main">${team1}</div>
            </div>
            <div class="vs">vs.</div>
            <div class="team">
              <div class="player main">${team2}</div>
            </div>
            <div class="action-area">
              ${actionButton}
            </div>
          </div>
        </div>
      `;
    }).join("");

    document.querySelectorAll(".result-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = parseInt(btn.dataset.row);
        const match = preMatches.find((m) => m.row === row);
        const matchInfo = `${match?.player1 || ""} vs ${match?.player3 || ""}`;
        window.openResultModal(row, matchInfo);
      });
    });

    document.querySelectorAll(".date-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = parseInt(btn.dataset.row);
        const match = preMatches.find((m) => m.row === row);
        window.openDateModal(row, match);
      });
    });

  } catch (err) {
    console.error("Fehler beim Laden:", err);
    container.innerHTML = `<p>Fehler beim Laden der offenen Matches: ${err.message}</p>`;
  }
}

function getStatusBadge(status, ergebnis) {
  if (ergebnis) {
    return '<span class="badge badge-ergebnis">Ergebnis eingetragen</span>';
  }
  switch (status) {
    case "offen":
      return '<span class="badge badge-offen">Offen</span>';
    case "bestaetigt":
      return '<span class="badge badge-bestaetigt">Bestätigt</span>';
    case "gespielt":
      return '<span class="badge badge-gespielt">Gespielt</span>';
    case "abgelaufen":
      return '<span class="badge badge-abgelaufen">Abgelaufen</span>';
    default:
      return `<span class="badge">${status}</span>`;
  }
}

function getBewerbsartBadge(match) {
  // Spezifischen Bewerb-Namen bevorzugen, sonst Art-Namen
  const label = (match.bewerbBezeichnung || match.bewerbsart || "").trim();
  if (!label) return "";

  // Forderungszeitpunkt nur bei Rangliste (BewerbsartID = "2") anzeigen
  const isRangliste = match.bewerbsartId === "2";
  const forderung = isRangliste && match.zeitpunktForderung
    ? ` (${escapeHtml(match.zeitpunktForderung)})`
    : "";

  return `<span class="badge-bewerb">${escapeHtml(label)}${forderung}</span>`;
}

function getActionButton(match, userId) {
  if (!userId) {
    return `<span class="waiting-text">Anmelden</span>`;
  }

  // Prüfe ob User Teil des Matches ist
  const userIsInvolved =
    match.player1Id === userId ||
    match.player2Id === userId ||
    match.player3Id === userId ||
    match.player4Id === userId;

  if (!userIsInvolved) {
    return `<span class="waiting-text">---</span>`;
  }

  // Wenn Datum nicht gesetzt: "Datum setzen" Button für beide
  if (!match.datum) {
    return `<button class="date-btn btn-action" data-row="${match.row}">Datum setzen</button>`;
  }

  // Wenn Datum gesetzt und noch kein Ergebnis: "Ergebnis eintragen" Button
  if (match.datum && !match.ergebnis) {
    return `
      <button class="result-btn btn-action" data-row="${match.row}">Ergebnis</button>
    `;
  }

  return `<span class="waiting-text">---</span>`;
}

document.addEventListener("DOMContentLoaded", () => {
  loadPreMatches();
});
