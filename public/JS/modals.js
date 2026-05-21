import { functions } from "./SDK.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readPlayerDetails = httpsCallable(functions, "readPlayerDetails");

//-------------------------------------------------------
// Toast Notification (Replaces Alert)
//-------------------------------------------------------
window.showToast = function (message, type = "info") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Remove after animation
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 3000);
}

//-------------------------------------------------------
// Passwort-Hash-Funktion
//-------------------------------------------------------
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

//-------------------------------------------------------
// Hilfsfunktion: Modal-HTML erzeugen und ins DOM einfügen
//-------------------------------------------------------
function createModal(id, innerHTML) {
  const div = document.createElement("div");
  div.id = id;
  div.className = "modal hidden";
  div.innerHTML = `
    <div class="modal-content">
      <span class="close">&times;</span>
      ${innerHTML}
    </div>
  `;
  document.body.appendChild(div);

  // Schließen-Button automatisch verdrahten
  div.querySelector(".close").addEventListener("click", () => {
    div.classList.add("hidden");
  });

  return div;
}

//-------------------------------------------------------
// Alle Modals dynamisch erzeugen
//-------------------------------------------------------

// --- Login Modal ---
const modal = createModal("loginModal", `
  <h2>Login</h2>
  <form id="loginForm">
    <label for="email">E-Mail:</label>
    <input type="email" id="email" required>

    <label for="password">Passwort:</label>
    <div style="position: relative; margin-bottom: 16px;">
      <input type="password" id="password" required style="width: 100%; padding-right: 40px;">
      <span class="toggle-password" data-target="password" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; user-select: none;">👁️</span>
    </div>

    <button type="submit" class="btn-login">Anmelden</button>
    <button type="button" id="forgotPasswordBtn" class="btn-forgot-password">Passwort vergessen</button>
  </form>
`);

// --- Passwort Vergessen Modal ---
const forgotPasswordModal = createModal("forgotPasswordModal", `
  <h2>Passwort zurücksetzen</h2>
  <form id="forgotPasswordForm">
    <label for="forgotEmail">E-Mail:</label>
    <input type="email" id="forgotEmail" required>

    <label for="newPassword">Neues Passwort:</label>
    <div style="position: relative; margin-bottom: 16px;">
      <input type="password" id="newPassword" required style="width: 100%; padding-right: 40px;">
      <span class="toggle-password" data-target="newPassword" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; user-select: none;">👁️</span>
    </div>

    <label for="confirmPassword">Passwort bestätigen:</label>
    <div style="position: relative; margin-bottom: 16px;">
      <input type="password" id="confirmPassword" required style="width: 100%; padding-right: 40px;">
      <span class="toggle-password" data-target="confirmPassword" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; user-select: none;">👁️</span>
    </div>

    <button type="submit" class="btn-login">Speichern</button>
  </form>
`);

// --- Profil Modal ---
const profileModal = createModal("profileModal", `
  <h2 id="profileName">Profil</h2>
  <p id="profileText">Lade Profildaten...</p>
  <div id="profileActions" style="display: flex; justify-content: flex-end; margin-top: 16px;"></div>
`);

// --- Match Modal (nur auf der Rangliste-Seite) ---
const isRanglistePage = !!document.getElementById("rankingContainer");
let matchModal = null;

if (isRanglistePage) {
  matchModal = createModal("matchModal", `
    <h2>Matchanfrage erstellen</h2>
    <form id="matchForm">
      <p>Geforderter: <span id="player1Display" class="name-display demanded"></span></p>
      <input type="hidden" id="player1" name="player1">
      <input type="hidden" id="player1Id" name="player1Id">

      <p>Herausforderer: <span id="player3Display" class="name-display"></span></p>
      <input type="hidden" id="player3" name="player3">
      <input type="hidden" id="player3Id" name="player3Id">

      <button type="submit" class="btn-login">Herausforderung senden</button>
    </form>
  `);
}

// --- Withdraw Modal ---
const withdrawModal = createModal("withdrawModal", `
  <h2>Raushängen</h2>
  <form id="withdrawForm">
    <label for="withdrawReason">Grund für Raushängen:</label>
    <textarea id="withdrawReason" placeholder="Bitte geben Sie den Grund ein..." style="width: 100%; min-height: 100px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: inherit;"></textarea>

    <div style="display: flex; gap: 10px; margin-top: 12px; justify-content: flex-end;">
      <button type="submit" class="btn-login">Senden</button>
    </div>
  </form>
`);

document.getElementById("withdrawForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const reason = document.getElementById("withdrawReason").value.trim();
  if (!reason) {
    showToast("Bitte geben Sie einen Grund an", "error");
    return;
  }

  try {
    const withdrawFunc = httpsCallable(functions, "withdrawFromRanking");
    const result = await withdrawFunc({
      reason,
      rank: localStorage.getItem("currentRank") || "?",
      bewerbId: localStorage.getItem("currentBewerbId") || "2",
      userId: localStorage.getItem("currentUserId") || "?",
    });
    if (result.data.success) {
      showToast("Erfolgreich ausgehängt", "success");
      withdrawModal.classList.add("hidden");
      document.getElementById("withdrawReason").value = "";
      setTimeout(() => location.reload(), 1500);
    } else {
      showToast(result.data.error || "Fehler beim Speichern", "error");
    }
  } catch (err) {
    console.error("Fehler:", err);
    showToast("Fehler beim Raushängen: " + err.message, "error");
  }
});

// Close button in withdraw modal
const withdrawCloseBtn = withdrawModal.querySelector(".close");
withdrawCloseBtn.addEventListener("click", () => {
  withdrawModal.classList.add("hidden");
});

window.openLoginModal = () => {
  const modal = document.getElementById("loginModal");
  if (modal) modal.classList.remove("hidden");
};

window.addEventListener("DOMContentLoaded", () => {
  const openBtn = document.getElementById("openLogin");
  if (openBtn) {
    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.openLoginModal();
    });
  }

  // Desktop Profile Button
  const profileBtn = document.getElementById("profileButton");
  if (profileBtn) {
    profileBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof window.openProfileModal === "function") {
        window.openProfileModal();
      }
    });
  }

  // Desktop SignOut Button
  const signOutBtn = document.getElementById("signOutButton");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.clear();
      window.location.reload();
    });
  }
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  const password = e.target.password.value;
  const passwordHash = await hashPassword(password);
  const submitBtn = e.target.querySelector('button[type="submit"]');

  console.log("Login attempt (hashed):", { email, passwordHash });

  submitBtn.disabled = true;
  submitBtn.textContent = "Anmelden...";

  const verifyFn = httpsCallable(functions, "verifyUserLogin");
  const result = await verifyFn({ email, passwordHash });
  const res = result.data;

  if (res.success && res.valid) {
    submitBtn.textContent = "Erfolgreich!";

    localStorage.setItem("loggedInEmail", email);
    localStorage.setItem("currentUserEmail", email);
    localStorage.setItem("isLoggedIn", "true");

    try {
      const profileData = await readPlayerDetails();
      const players = profileData.data?.players || [];
      const currentPlayer = players.find(
        (p) => p.email.trim().toLowerCase() === email.trim().toLowerCase()
      );
      if (currentPlayer) {
        localStorage.setItem("currentUserName", currentPlayer.fullName || "");
        localStorage.setItem("currentUserId", currentPlayer.id || "");
      }
    } catch (err) {
      console.warn("Profil-Daten nach Login nicht geladen:", err);
    }

    setTimeout(() => window.location.reload(), 500);

  } else if (res.success && !res.valid) {
    showToast("Falsches Passwort!", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Anmelden";
  } else {
    showToast("Fehler: " + (res.error ?? res.message), "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Anmelden";
  }
});

//-------------------------------------------------------
// Passwort Vergessen Modal Logik
//-------------------------------------------------------
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
if (forgotPasswordBtn) {
  forgotPasswordBtn.addEventListener("click", (e) => {
    e.preventDefault();
    modal.classList.add("hidden");
    forgotPasswordModal.classList.remove("hidden");
  });
}

document.getElementById("forgotPasswordForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = e.target.forgotEmail.value.trim();
  const newPassword = e.target.newPassword.value;
  const confirmPassword = e.target.confirmPassword.value;
  const submitBtn = e.target.querySelector('button[type="submit"]');

  // Validierung: Passwörter stimmen überein
  if (newPassword !== confirmPassword) {
    showToast("Die Passwörter stimmen nicht überein!", "error");
    return;
  }

  // Validierung: Passwort nicht leer
  if (newPassword.length < 6) {
    showToast("Passwort muss mindestens 6 Zeichen lang sein!", "error");
    return;
  }

  const passwordHash = await hashPassword(newPassword);

  console.log("Passwort-Reset gestartet für:", email);

  submitBtn.disabled = true;
  submitBtn.textContent = "Wird gespeichert...";

  const resetPasswordFn = httpsCallable(functions, "resetPassword");
  try {
    const result = await resetPasswordFn({ email, passwordHash });
    const res = result.data;

    if (res.success) {
      submitBtn.textContent = "Erfolgreich!";
      showToast("Passwort wurde erfolgreich zurückgesetzt!", "success");

      // Modal zurücksetzen und schließen
      e.target.reset();
      forgotPasswordModal.classList.add("hidden");

      // Login Modal öffnen
      setTimeout(() => {
        modal.classList.remove("hidden");
      }, 1000);

      submitBtn.disabled = false;
      submitBtn.textContent = "Speichern";
    } else {
      showToast("Fehler: " + (res.error || "Unbekannter Fehler"), "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Speichern";
    }
  } catch (err) {
    console.error("Fehler beim Passwort-Reset:", err);
    showToast("Fehler: " + err.message, "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Speichern";
  }
});

//-------------------------------------------------------
// Sign Out Button Logik
//-------------------------------------------------------
const signOutButton = document.getElementById("signOutButton");
if (signOutButton) {
  signOutButton.addEventListener("click", (e) => {
    e.preventDefault();

    localStorage.removeItem("loggedInEmail");
    localStorage.removeItem("currentUserEmail");
    localStorage.removeItem("currentUserId");
    localStorage.removeItem("currentUserName");
    localStorage.removeItem("isLoggedIn");

    updateNotificationBadge(0);

    window.location.reload();
  });
}

//-------------------------------------------------------
// Profil Modal Logik
//-------------------------------------------------------
window.openProfileModal = async (profileOptions = {}) => {
  const profileName = document.getElementById("profileName");
  const profileText = document.getElementById("profileText");
  const profileActions = document.getElementById("profileActions");
  const email = localStorage.getItem("loggedInEmail");
  if (!email && !profileOptions.playerId) {
    showToast("Kein Benutzer eingeloggt!", "error");
    return;
  }

  profileName.textContent = "Lade Profil...";
  profileText.textContent = "";
  profileActions.innerHTML = "";
  const profileModal = document.getElementById("profileModal");
  if (profileModal) profileModal.classList.remove("hidden");

  try {
    const result = await readPlayerDetails();
    const { success, players } = result.data;

    if (!success || !Array.isArray(players)) {
      throw new Error("Spieler-Liste konnte nicht geladen werden.");
    }

    const player = profileOptions.playerId
      ? players.find((p) => String(p.id).trim() === String(profileOptions.playerId).trim())
      : players.find((p) => p.email.trim().toLowerCase() === email.trim().toLowerCase());

    if (!player) {
      profileName.textContent = "Unbekanntes Profil";
      profileText.textContent = "Keine Daten gefunden.";
      if (!profileOptions.playerId) {
        localStorage.removeItem("currentUserName");
      }
      return;
    }

    const firstName = player.firstName || "---";
    const lastName = player.lastName || "---";
    const birthDate = player.birthDate || "---";
    const fullName = `${firstName} ${lastName}`.trim() || "Unbekannter Spieler";

    profileName.textContent = fullName;
    profileText.innerHTML = `
      <strong>Geburtsdatum:</strong> ${birthDate}
    `;

    if (!profileOptions.playerId) {
      localStorage.setItem("currentUserName", fullName);
    }

    const canChallenge = typeof profileOptions.canChallenge === "boolean"
      ? profileOptions.canChallenge
      : !!profileOptions.boxElement?.classList.contains("challengeable");

    if (canChallenge) {
      const challengeBtn = document.createElement("button");
      challengeBtn.type = "button";
      challengeBtn.className = "btn-login";
      challengeBtn.textContent = "Fordern";

      // 👉 Neuer Direkt-Eintrag ohne weiteres Modal
      challengeBtn.addEventListener("click", async () => {
        try {
          const player1Id = player.id || "";
          const player3Id = localStorage.getItem("currentUserId") || "";
          const player1Name = fullName;
          const player3Name = localStorage.getItem("currentUserName") || "";

          if (!player3Id || !player3Name) {
            showToast("Bitte vorher einloggen!", "error");
            return;
          }

          const now = new Date();
          const yy = String(now.getFullYear()).slice(2);
          const mm = String(now.getMonth() + 1).padStart(2, "0");
          const dd = String(now.getDate()).padStart(2, "0");
          const hh = String(now.getHours()).padStart(2, "0");
          const mi = String(now.getMinutes()).padStart(2, "0");
          const zeitpunktForderung = `${yy}${mm}${dd}-${hh}${mi}`;

          const addMatchFn = httpsCallable(functions, "addMatch");

          challengeBtn.disabled = true;
          challengeBtn.textContent = "Sende...";

          // 🔥 Direktes Speichern in Google Sheet
          const result = await addMatchFn({
            player1: player1Name,
            player1Id: player1Id,
            player3: player3Name,
            player3Id: player3Id,
            zeitpunktForderung,
            bewerbId: window.currentBewerbId || "2",
          });

          const data = result.data;

          if (data?.success) {
            showToast("Herausforderung erfolgreich eingetragen!", "success");
            challengeBtn.textContent = "Gesendet!";
            profileModal.classList.add("hidden");
            setTimeout(() => window.location.reload(), 1500);
          } else {
            throw new Error(data?.error || "Unbekannter Fehler beim Speichern");
          }
        } catch (err) {
          console.error("Fehler beim Fordern:", err);
          showToast("Fehler: " + (err.message || err), "error");
          challengeBtn.textContent = "Fordern";
          challengeBtn.disabled = false;
        }
      });

      profileActions.appendChild(challengeBtn);
    }
  } catch (err) {
    console.error("Fehler beim Laden des Profils:", err);
    profileName.textContent = "Fehler beim Laden!";
    profileText.textContent = err.message;
  }
};


//-------------------------------------------------------
// Beim Laden: Auth-Status wiederherstellen & Listeners
//-------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
  if (isLoggedIn) {
    document.querySelectorAll(".loggedIn").forEach((el) => {
      el.style.display = "inline";
    });
    document.querySelectorAll(".loggedOut").forEach((el) => {
      el.style.display = "none";
    });
  }

  // Desktop Profile Button
  const profileBtn = document.getElementById("profileButton");
  if (profileBtn) {
    profileBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof window.openProfileModal === "function") {
        window.openProfileModal();
      }
    });
  }

  // Desktop SignOut Button
  const signOutBtn = document.getElementById("signOutButton");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.clear();
      window.location.reload();
    });
  }
});

//-------------------------------------------------------
// Match-Anfrage Modal Logik (nur auf Rangliste-Seite)
//-------------------------------------------------------
if (isRanglistePage && matchModal) {
  const player1Input = document.getElementById("player1");
  const player1IdInput = document.getElementById("player1Id");
  const player3Input = document.getElementById("player3");
  const player3IdInput = document.getElementById("player3Id");
  const player1Display = document.getElementById("player1Display");
  const player3Display = document.getElementById("player3Display");

  document.getElementById("matchForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    // Lokale Zeit generieren (damit die Zeitzone stimmt)
    const jetzt = new Date();
    const yy = String(jetzt.getFullYear()).slice(2);
    const mm = String(jetzt.getMonth() + 1).padStart(2, "0");
    const dd = String(jetzt.getDate()).padStart(2, "0");
    const hh = String(jetzt.getHours()).padStart(2, "0");
    const mi = String(jetzt.getMinutes()).padStart(2, "0");
    const zeitpunkt = `${yy}${mm}${dd}-${hh}${mi}`;

    const matchData = {
      player1: player1Input.value.trim(),
      player1Id: player1IdInput.value.trim(),
      player3: player3Input.value.trim(),
      player3Id: player3IdInput.value.trim(),
      zeitpunktForderung: zeitpunkt,
      bewerbId: matchModal.dataset.bewerbId || "2",
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Senden...";

    console.log("Matchanfrage gesendet:", matchData);

    try {
      const addMatchFn = httpsCallable(functions, "addMatch");
      const result = await addMatchFn(matchData);
      const data = result.data;

      if (data?.success) {
        submitBtn.textContent = "Gesendet!";
        showToast("Herausforderung erfolgreich gesendet!", "success");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        throw new Error(data?.error || "Unbekannter Fehler beim Speichern");
      }
    } catch (err) {
      console.error("Fehler beim Speichern des Matches:", err);
      showToast("Speichern fehlgeschlagen: " + (err.message || err), "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Herausforderung senden";
    }

    matchModal.classList.add("hidden");
  });

  window.openMatchModal = ({
    player1 = "",
    player1Id = "",
    player3 = "",
    player3Id = "",
    bewerbId = "2",
  } = {}) => {
    player1Input.value = player1;
    player1IdInput.value = player1Id;
    player1Display.textContent = player1;

    player3Input.value = player3 || localStorage.getItem("currentUserName") || "";
    player3IdInput.value = player3Id || localStorage.getItem("currentUserId") || "";
    player3Display.textContent = player3Input.value;

    matchModal.dataset.bewerbId = bewerbId;

    matchModal.classList.remove("hidden");
  };

  window.closeMatchModal = () => {
    matchModal.classList.add("hidden");
  };
}

//-------------------------------------------------------
// Notification Bell - offene Matches
//-------------------------------------------------------
const getMyChallenges = httpsCallable(functions, "getMyChallenges");
const setMatchDateFn = httpsCallable(functions, "setMatchDate");

let notificationBadge = null;

function updateNotificationBadge(count) {
  if (!notificationBadge) {
    notificationBadge = document.getElementById("notificationBadge");
  }
  if (notificationBadge) {
    notificationBadge.textContent = count > 0 ? count : "";
    notificationBadge.style.display = count > 0 ? "block" : "none";
  }
}

async function loadChallenges() {
  const userId = localStorage.getItem("currentUserId");
  if (!userId) return;

  try {
    const result = await getMyChallenges({ userId });
    const { success, challenges = [] } = result.data || {};
    if (success) {
      updateNotificationBadge(challenges.length);
    }
  } catch (err) {
    console.error("Fehler beim Laden der offenen Matches:", err);
  }
}

window.openNotificationModal = async () => {
  const userId = localStorage.getItem("currentUserId");
  if (!userId) {
    showToast("Bitte einloggen!", "error");
    return;
  }

  notificationModal.classList.remove("hidden");
  const listEl = document.getElementById("challengeList");
  listEl.innerHTML = "<p>Lade...</p>";

  try {
    const result = await getMyChallenges({ userId });
    const { success, challenges = [] } = result.data || {};

    if (!success) throw new Error("Fehler beim Laden");

    if (challenges.length === 0) {
      listEl.innerHTML = "<p>Keine offenen Matches.</p>";
      return;
    }

    listEl.innerHTML = challenges
      .map(
        (c, i) => `
      <div class="challenge-item">
        <p><strong>${i + 1}.</strong> <span class="challenger-name">${c.player3}</span> fordert dich heraus!</p>
        <label for="date-${c.row}">Datum:</label>
        <input type="date" id="date-${c.row}" required>
        <button class="btn-login set-date-btn" data-row="${c.row}">Datum setzen</button>
      </div>
    `
      )
      .join("");

    listEl.querySelectorAll(".set-date-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.dataset.row;
        const dateInput = document.getElementById(`date-${row}`);

        if (!dateInput.value) {
          showToast("Bitte ein Datum auswählen!", "error");
          return;
        }

        btn.disabled = true;
        btn.textContent = "Speichern...";

        try {
          const result = await setMatchDateFn({
            row: parseInt(row),
            datum: dateInput.value,
          });

          if (result.data?.success) {
            btn.textContent = "Gespeichert!";
            dateInput.disabled = true;
            loadChallenges();
          } else {
            throw new Error(result.data?.error || "Fehler");
          }
        } catch (err) {
          console.error("Fehler beim Setzen des Datums:", err);
          showToast("Fehler: " + err.message, "error");
          btn.disabled = false;
          btn.textContent = "Datum setzen";
        }
      });
    });
  } catch (err) {
    console.error("Fehler beim Laden:", err);
    listEl.innerHTML = "<p>Fehler beim Laden.</p>";
  }
};

window.closeNotificationModal = () => {
  notificationModal.classList.add("hidden");
};

const notificationBell = document.getElementById("notificationBell");
if (notificationBell) {
  notificationBell.addEventListener("click", (e) => {
    e.preventDefault();
    window.openNotificationModal();
  });
}

window.addEventListener("load", () => {
  const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
  if (isLoggedIn) {
    loadChallenges();
  }
  document.querySelectorAll("[data-auth='required']").forEach((el) => {
    el.style.display = isLoggedIn ? "" : "none";
  });
});

//-------------------------------------------------------
// Passwort-Sichtbarkeit toggle (Auge-Symbol)
//-------------------------------------------------------
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("toggle-password")) {
    const targetId = e.target.dataset.target;
    const passwordInput = document.getElementById(targetId);
    if (passwordInput) {
      if (passwordInput.type === "password") {
        passwordInput.type = "text";
        e.target.textContent = "🙈";
      } else {
        passwordInput.type = "password";
        e.target.textContent = "👁️";
      }
    }
  }
});
