import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readNavigator = httpsCallable(functions, "readNavigator");
const setNavigatorTarget = httpsCallable(functions, "setNavigatorTarget");
const getNavigatorTarget = httpsCallable(functions, "getNavigatorTarget");
const readPreMatches = httpsCallable(functions, "readPreMatches");
const readPlayersList = httpsCallable(functions, "readPlayersList");
const readBewerbe = httpsCallable(functions, "readBewerbe");
const setScoreboardCourt = httpsCallable(functions, "setScoreboardCourt");
const getScoreboardCourts = httpsCallable(functions, "getScoreboardCourts");

let currentActiveBtn = null;
let pendingBtn = null;
let statusPollId = null;

let playerMap = new Map();
let playerDetails = [];
let bewerbMap = new Map();
let nextMatches = [];

// ── Daten laden für Overlay ──

async function loadPlayers() {
  try {
    const res = await readPlayersList();
    const { success, values } = res.data;
    if (!success || !Array.isArray(values) || values.length < 2) return;
    const header = values[0].map((h) => h.trim().toLowerCase());
    const idIdx = header.indexOf("id");
    const fnIdx = header.indexOf("vorname");
    const lnIdx = header.indexOf("nachname");
    if (idIdx === -1) return;
    const map = new Map();
    const details = [];
    values.slice(1).forEach((r) => {
      const id = r[idIdx];
      const vorname = (r[fnIdx] || "").trim();
      const nachname = (r[lnIdx] || "").trim();
      const name = `${vorname} ${nachname}`.trim();
      if (id) {
        map.set(id, name || id);
        details.push({ id, vorname, nachname, display: `${nachname} ${vorname}`.trim(), fullName: `${vorname} ${nachname}`.trim() });
      }
    });
    playerMap = map;
    playerDetails = details.sort((a, b) => a.nachname.localeCompare(b.nachname));
  } catch (err) {
    // silent
  }
}

async function loadBewerbe() {
  try {
    const res = await readBewerbe();
    const { success, values } = res.data;
    if (!success || !Array.isArray(values) || values.length < 2) return;
    const header = values[0].map((h) => h.trim().toLowerCase());
    const idIdx = header.indexOf("id");
    const bezIdx = header.indexOf("bezeichnung");
    if (idIdx === -1 || bezIdx === -1) return;
    const map = new Map();
    values.slice(1).forEach((r) => {
      const id = String(r[idIdx] || "").trim();
      if (id) map.set(id, String(r[bezIdx] || "").trim());
    });
    bewerbMap = map;
  } catch (err) {
    // silent
  }
}

async function loadNextMatches() {
  try {
    const res = await readPreMatches();
    const { success, values } = res.data;
    if (!success || !Array.isArray(values) || values.length < 2) return;
    const header = values[0].map((h) => h.trim().toLowerCase());
    const idx = (label) => header.indexOf(label);
    const idIdx = idx("id");
    const i1 = idx("spielerid1");
    const i2 = idx("spielerid2");
    const i3 = idx("spielerid3");
    const i4 = idx("spielerid4");
    const d = idx("zeitpunktmatch");
    const bewerbIdIdx = idx("bewerbid");
    const rasterIdx = idx("rasterpaarung");

    nextMatches = values.slice(1)
      .filter((row) => row && row[i1] && !/^BYE$/i.test(String(row[i1])) && !/^BYE$/i.test(String(row[i3])))
      .map((row) => {
        const ts = dateToTs(row[d]);
        const matchId = idIdx >= 0 ? String(row[idIdx] || "").trim() : "";
        const pid1 = String(row[i1] || "").trim();
        const pid2 = i2 >= 0 ? String(row[i2] || "").trim() : "";
        const pid3 = String(row[i3] || "").trim();
        const pid4 = i4 >= 0 ? String(row[i4] || "").trim() : "";
        const bewerbId = bewerbIdIdx >= 0 ? String(row[bewerbIdIdx] || "").trim() : "";
        const dateTimeRaw = d >= 0 ? String(row[d] || "").trim() : "";
        const rasterRaw = rasterIdx >= 0 ? String(row[rasterIdx] || "").trim() : "";
        return { matchId, pid1, pid2, pid3, pid4, bewerbId, dateTimeRaw, rasterRaw, ts };
      })
      .sort((a, b) => {
        if (a.ts && b.ts) return a.ts - b.ts;
        return a.ts ? -1 : b.ts ? 1 : 0;
      })
      .slice(0, 20);
  } catch (err) {
    // silent
  }
}

function dateToTs(raw) {
  if (!raw) return 0;
  const m = String(raw).trim().match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return 0;
  const [, yy, mm, dd, hh, mi] = m;
  const yyyy = parseInt(yy, 10) >= 50 ? 1900 + parseInt(yy) : 2000 + parseInt(yy);
  return new Date(yyyy, parseInt(mm) - 1, parseInt(dd), parseInt(hh), parseInt(mi)).getTime();
}

// ── Overlay ──

function getCurrentDateTime() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}. - ${hh}:${mi}`;
}

function parseSheetDate(raw) {
  if (!raw) return "";
  const m = String(raw).trim().match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return raw;
  const [, , mm, dd, hh, mi] = m;
  return `${dd}.${mm}. - ${hh}:${mi}`;
}

function parseRunde(raw) {
  if (!raw) return "";
  const s = String(raw).trim().toUpperCase();
  const roundMatch = s.match(/^(R\d+|AF|VF|HF|F|G\d+)/);
  if (!roundMatch) return "";
  const code = roundMatch[1];
  if (/^R(\d+)$/.test(code)) return code.replace(/^R/, "") + ".Runde";
  if (code === "AF") return "Achtelfinale";
  if (code === "VF") return "Viertelfinale";
  if (code === "HF") return "Halbfinale";
  if (code === "F") return "Finale";
  if (/^G(\d+)$/.test(code)) return code.replace(/^G/, "") + ".Gruppe";
  return code;
}

function openPlayerOverlay(label) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "platz-overlay";

    const box = document.createElement("div");
    box.className = "platz-overlay-box";

    const title = document.createElement("div");
    title.className = "platz-overlay-title";
    title.textContent = label;
    box.appendChild(title);

    const list = document.createElement("div");
    list.className = "platz-overlay-list";

    let selectedName = null;

    // Spielerliste nach Nachname sortiert
    playerDetails.forEach(({ display, fullName }) => {
      const btn = document.createElement("button");
      btn.className = "platz-overlay-option";
      btn.innerHTML = `<span class="platz-overlay-paarung">${display}</span>`;
      btn.addEventListener("click", () => {
        list.querySelectorAll(".platz-overlay-option").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedName = fullName;
      });
      list.appendChild(btn);
    });

    box.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "platz-overlay-actions";

    const btnCancel = document.createElement("button");
    btnCancel.className = "platz-overlay-btn cancel";
    btnCancel.textContent = "Abbrechen";
    btnCancel.addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });

    const btnSubmit = document.createElement("button");
    btnSubmit.className = "platz-overlay-btn submit";
    btnSubmit.textContent = "Übernehmen";
    btnSubmit.addEventListener("click", () => {
      if (!selectedName) return;
      overlay.remove();
      resolve(selectedName);
    });

    actions.appendChild(btnCancel);
    actions.appendChild(btnSubmit);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

async function openPlatzOverlay(court) {
  // Daten frisch laden bei jedem Overlay-Öffnen
  await Promise.all([loadPlayers(), loadBewerbe(), loadNextMatches()]);

  const overlay = document.createElement("div");
  overlay.className = "platz-overlay";

  const box = document.createElement("div");
  box.className = "platz-overlay-box";

  const title = document.createElement("div");
  title.className = "platz-overlay-title";
  title.textContent = `Platz ${court} — Spielzuweisung`;
  box.appendChild(title);

  const list = document.createElement("div");
  list.className = "platz-overlay-list";

  let selectedData = null;
  let isIndividual = false;

  // Option 1: Individual
  const indBtn = document.createElement("button");
  indBtn.className = "platz-overlay-option";
  indBtn.innerHTML = `<span class="platz-overlay-paarung">Individual</span>`;
  indBtn.addEventListener("click", () => {
    list.querySelectorAll(".platz-overlay-option").forEach((b) => b.classList.remove("selected"));
    indBtn.classList.add("selected");
    isIndividual = true;
    selectedData = null;
  });
  list.appendChild(indBtn);

  // Optionen 2-9: nächste 8 preMatches
  nextMatches.forEach((match) => {
    const homeName = playerMap.get(match.pid1) || match.pid1;
    const homeName2 = match.pid2 ? (playerMap.get(match.pid2) || match.pid2) : "";
    const guestName = playerMap.get(match.pid3) || match.pid3;
    const guestName2 = match.pid4 ? (playerMap.get(match.pid4) || match.pid4) : "";
    const bewerbName = bewerbMap.get(match.bewerbId) || "";
    const dateTime = parseSheetDate(match.dateTimeRaw);
    const runde = parseRunde(match.rasterRaw);

    const homeDisplay = homeName2 ? `${homeName} / ${homeName2}` : homeName;
    const guestDisplay = guestName2 ? `${guestName} / ${guestName2}` : guestName;
    const homeBackend = homeName2 ? `${homeName} / ${homeName2}` : homeName;
    const guestBackend = guestName2 ? `${guestName} / ${guestName2}` : guestName;

    const infoParts = [dateTime, bewerbName, runde].filter(Boolean);
    const btn = document.createElement("button");
    btn.className = "platz-overlay-option";
    btn.innerHTML = `
      <span class="platz-overlay-paarung">${homeDisplay} vs. ${guestDisplay}</span>
      <span class="platz-overlay-bewerb">${infoParts.join(" | ")}</span>
    `;
    btn.addEventListener("click", () => {
      list.querySelectorAll(".platz-overlay-option").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      isIndividual = false;
      selectedData = { matchId: match.matchId, homePlayer: homeBackend, guestPlayer: guestBackend, bewerb: bewerbName, dateTime, runde };
    });
    list.appendChild(btn);
  });

  box.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "platz-overlay-actions";

  const btnCancel = document.createElement("button");
  btnCancel.className = "platz-overlay-btn cancel";
  btnCancel.textContent = "Abbrechen";
  btnCancel.addEventListener("click", () => overlay.remove());

  const btnSubmit = document.createElement("button");
  btnSubmit.className = "platz-overlay-btn submit";
  btnSubmit.textContent = "Übernehmen";
  btnSubmit.addEventListener("click", async () => {
    if (!isIndividual && !selectedData) return;

    if (isIndividual) {
      overlay.remove();
      // Spieler Heim auswählen
      const homePlayer = await openPlayerOverlay("Spieler Heim");
      if (!homePlayer) return;
      // Spieler Gast auswählen
      const guestPlayer = await openPlayerOverlay("Spieler Gast");
      if (!guestPlayer) return;
      // Daten senden
      try {
        await setScoreboardCourt({
          court: String(court),
          matchId: "",
          homePlayer,
          guestPlayer,
          bewerb: "Individual",
          dateTime: getCurrentDateTime(),
          runde: "",
        });
      } catch (err) {
        console.error("setScoreboardCourt Fehler:", err);
      }
    } else {
      try {
        await setScoreboardCourt({
          court: String(court),
          matchId: selectedData.matchId,
          homePlayer: selectedData.homePlayer,
          guestPlayer: selectedData.guestPlayer,
          bewerb: selectedData.bewerb,
          dateTime: selectedData.dateTime,
          runde: selectedData.runde,
        });
      } catch (err) {
        console.error("setScoreboardCourt Fehler:", err);
      }
      overlay.remove();
    }
  });

  actions.appendChild(btnCancel);
  actions.appendChild(btnSubmit);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ── Platzaktivierung Overlay ──

async function openAktivierungOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "platz-overlay";

  const box = document.createElement("div");
  box.className = "platz-overlay-box";

  const title = document.createElement("div");
  title.className = "platz-overlay-title";
  title.textContent = "Platzaktivierung";
  box.appendChild(title);

  const list = document.createElement("div");
  list.className = "platz-overlay-list aktivierung-list";

  // Aktuellen Status laden
  let courtData = { "1": {}, "2": {} };
  try {
    const res = await getScoreboardCourts();
    const { success, courts } = res.data;
    if (success && courts) {
      if (courts["1"]) courtData["1"] = courts["1"];
      if (courts["2"]) courtData["2"] = courts["2"];
    }
  } catch (err) {
    // silent
  }

  function createCourtBtn(courtKey) {
    const btn = document.createElement("button");
    btn.className = "platz-aktivierung-btn";
    updateBtnStyle(btn, courtKey);

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const cd = courtData[courtKey];
      const newStatus = (cd.aktiv || 0) === 1 ? 0 : 1;
      try {
        await setScoreboardCourt({
          court: courtKey,
          aktiv: newStatus,
          matchId: cd.matchId || "",
          bewerb: cd.bewerb || "",
          homePlayer: cd.homePlayer || "",
          guestPlayer: cd.guestPlayer || "",
          dateTime: cd.dateTime || "",
          runde: cd.runde || "",
        });
        courtData[courtKey].aktiv = newStatus;
      } catch (err) {
        console.error("Toggle Fehler:", err);
      }
      updateBtnStyle(btn, courtKey);
      btn.disabled = false;
    });

    return btn;
  }

  function updateBtnStyle(btn, courtKey) {
    const isActive = (courtData[courtKey].aktiv || 0) === 1;
    btn.textContent = `Platz ${courtKey}`;
    btn.classList.remove("aktivierung-active", "aktivierung-inactive");
    btn.classList.add(isActive ? "aktivierung-active" : "aktivierung-inactive");
  }

  list.appendChild(createCourtBtn("1"));
  list.appendChild(createCourtBtn("2"));
  box.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "platz-overlay-actions";

  const btnClose = document.createElement("button");
  btnClose.className = "platz-overlay-btn cancel";
  btnClose.textContent = "Schließen";
  btnClose.addEventListener("click", () => overlay.remove());

  actions.appendChild(btnClose);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ── Navigator laden ──

const navParams = new URLSearchParams(window.location.search);
const NAV_PROFIL = navParams.get("profil") || "1";

async function loadNavigator() {
  const container = document.getElementById("navigator-container");
  if (!container) return;

  // Daten werden erst beim Öffnen des Overlays geladen

  try {
    const res = await readNavigator();
    const { success, values, error } = res.data;
    if (!success) {
      container.innerHTML = "<p>Fehler: " + (error || "Unbekannter Fehler") + "</p>";
      return;
    }
    if (!Array.isArray(values) || values.length <= 1) {
      container.innerHTML = "<p>Keine Navigationseinträge gefunden.</p>";
      return;
    }

    const header = values[0].map((h) => String(h).trim().toLowerCase());
    const nameIdx = header.indexOf("name");
    const zielIdx = header.indexOf("ziel");
    const profilIdx = header.indexOf("profil");
    if (nameIdx === -1) {
      container.innerHTML = "<p>Spalte Name fehlt.</p>";
      return;
    }

    const rows = values.slice(1)
      .map((row) => ({
        name: String(row[nameIdx] || "").trim(),
        ziel: zielIdx >= 0 ? String(row[zielIdx] || "").trim() : "",
        profil: profilIdx >= 0 ? String(row[profilIdx] || "1").trim() : "1",
      }))
      .filter((r) => r.name && r.profil === NAV_PROFIL);

    container.innerHTML = "";

    // Reihen berechnen für CSS-Variable (4 Spalten)
    const navRows = Math.ceil(rows.length / 4);
    container.style.setProperty("--nav-rows", navRows);

    rows.forEach(({ name, ziel }) => {
      const btn = document.createElement("button");
      btn.className = "nav-btn";
      btn.textContent = name;
      if (ziel) {
        // Overlay-Ziele abfangen
        const olPlatzMatch = ziel.trim().match(/^OL-Platz-(\d)/i);
        const olAktivMatch = ziel.trim().match(/^OL-Platzaktivierung$/i);
        if (olPlatzMatch) {
          const court = olPlatzMatch[1];
          btn.addEventListener("click", () => {
            openPlatzOverlay(court);
          });
        } else if (olAktivMatch) {
          btn.addEventListener("click", () => {
            openAktivierungOverlay();
          });
        } else {
          btn.addEventListener("click", async () => {
            document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active", "blink-yellow"));
            btn.classList.add("blink-yellow");
            pendingBtn = btn;
            try {
              await setNavigatorTarget({path: ziel});
            } catch (err) {
              console.error("setNavigatorTarget Fehler:", err);
            }
            if (!statusPollId) {
              statusPollId = setInterval(pollStatus, 150);
            }
          });
        }
      }
      container.appendChild(btn);
    });
  } catch (err) {
    console.error("Navigator Fehler:", err);
    container.innerHTML = "<p>Fehler beim Laden der Navigation.</p>";
  }
}

async function pollStatus() {
  try {
    const res = await getNavigatorTarget();
    const { success, status } = res.data;
    if (!success || status !== "loaded") return;
    if (pendingBtn) {
      pendingBtn.classList.remove("blink-yellow");
      pendingBtn.classList.add("active");
      if (currentActiveBtn && currentActiveBtn !== pendingBtn) {
        currentActiveBtn.classList.remove("active");
      }
      currentActiveBtn = pendingBtn;
      pendingBtn = null;
    }
    if (statusPollId) {
      clearInterval(statusPollId);
      statusPollId = null;
    }
  } catch (err) {
    // silent
  }
}

document.addEventListener("DOMContentLoaded", loadNavigator);
