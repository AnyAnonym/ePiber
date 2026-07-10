import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readEntryList   = httpsCallable(functions, "readEntryList");
const readPlayersList = httpsCallable(functions, "readPlayersList");
const addEntryList    = httpsCallable(functions, "addEntryList");
const removeEntryList = httpsCallable(functions, "removeEntryList");
const readBewerbe     = httpsCallable(functions, "readBewerbe");

const params = new URLSearchParams(window.location.search);
const BEWERB_ID = params.get("id");
let currentEntries = [];
let entryStartDate = null;
let entryDeadlineDate = null;
let entryStartRaw = "";
let entryDeadlineRaw = "";

// Parst Datumsformat: "YYMMDD", "YYMMDD-HHMM", "YYYYMMDD", "YYYYMMDD-HHMM"
// Bei nur Datum: Start → 00:00, Deadline → 23:59
function parseSheetDate(raw, isDeadline = false) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Format YYMMDD-HHMM
  const mTime6 = s.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (mTime6) {
    const y = +mTime6[1] >= 50 ? 1900 + +mTime6[1] : 2000 + +mTime6[1];
    return new Date(y, +mTime6[2] - 1, +mTime6[3], +mTime6[4], +mTime6[5]);
  }

  // Format YYYYMMDD-HHMM
  const mTime8 = s.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (mTime8) {
    return new Date(+mTime8[1], +mTime8[2] - 1, +mTime8[3], +mTime8[4], +mTime8[5]);
  }

  // Format YYMMDD (nur Datum)
  const m6 = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m6) {
    const y = +m6[1] >= 50 ? 1900 + +m6[1] : 2000 + +m6[1];
    if (isDeadline) return new Date(y, +m6[2] - 1, +m6[3], 23, 59, 59);
    return new Date(y, +m6[2] - 1, +m6[3], 0, 0, 0);
  }

  // Format YYYYMMDD (nur Datum)
  const m8 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) {
    if (isDeadline) return new Date(+m8[1], +m8[2] - 1, +m8[3], 23, 59, 59);
    return new Date(+m8[1], +m8[2] - 1, +m8[3], 0, 0, 0);
  }

  return null;
}

// Formatiert Roh-Datum für Anzeige
function formatEntryDate(raw) {
  if (!raw) return "";
  const s = String(raw).trim();

  // Format YYMMDD-HHMM
  const mTime6 = s.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (mTime6) {
    const [, yy, mm, dd, hh, mi] = mTime6;
    const yyyy = +yy >= 50 ? `19${yy}` : `20${yy}`;
    return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
  }

  // Format YYYYMMDD-HHMM
  const mTime8 = s.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (mTime8) {
    const [, yyyy, mm, dd, hh, mi] = mTime8;
    return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
  }

  // Format YYMMDD
  const m6 = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m6) {
    const [, yy, mm, dd] = m6;
    const yyyy = +yy >= 50 ? `19${yy}` : `20${yy}`;
    return `${dd}.${mm}.${yyyy}`;
  }

  // Format YYYYMMDD
  const m8 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) {
    const [, yyyy, mm, dd] = m8;
    return `${dd}.${mm}.${yyyy}`;
  }

  return s;
}

function isEntryPeriodActive() {
  const now = new Date();
  if (entryStartDate && now < entryStartDate) return false;
  if (entryDeadlineDate && now > entryDeadlineDate) return false;
  return true;
}

function formatDateTime(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd} – ${hh}:${mi}`;
}

function formatTimestampForStorage(date) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yy}${mm}${dd}-${hh}${mi}`;
}

function formatStoredDate(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return "–";
  }

  const input = String(raw).trim();
  const normalized = input.replace(/–/g, "-").replace(/\s+/g, "");

  const shortMatch = normalized.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (shortMatch) {
    const [, yy, mm, dd, hh, mi] = shortMatch;
    const yyyy = parseInt(yy, 10) >= 50 ? `19${yy}` : `20${yy}`;
    return `${dd}.${mm}.${yyyy} - ${hh}:${mi}`;
  }

  const longMatch = normalized.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (longMatch) {
    const [, yyyy, mm, dd, hh, mi] = longMatch;
    return `${dd}.${mm}.${yyyy} - ${hh}:${mi}`;
  }

  const prettyMatch = input.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*[-–]\s*(\d{2}):(\d{2})$/);
  if (prettyMatch) {
    const [, dd, mm, yyyy, hh, mi] = prettyMatch;
    return `${dd}.${mm}.${yyyy} - ${hh}:${mi}`;
  }

  return input;
}

async function loadEntries() {
  const container = document.getElementById("entryListContainer");
  if (!container) return;

  container.innerHTML = "<p class='loading-text'>Lade Einträge...</p>";

  if (!BEWERB_ID) {
    container.innerHTML = "<p>Keine Bewerb-ID übergeben.</p>";
    return;
  }

  try {
    const [entryRes, playerRes] = await Promise.all([
      readEntryList({ bewerbId: BEWERB_ID }),
      readPlayersList(),
    ]);

    if (!entryRes.data?.success) throw new Error("Fehler beim Laden");

    const entryValues = entryRes.data.values || [];
    const playerValues = playerRes.data?.values || [];

    const playerMap = new Map();
    if (playerValues.length > 1) {
      const pHeader = playerValues[0].map((h) => h.trim().toLowerCase());
      const pIdIdx = pHeader.indexOf("id");
      const pFnIdx = pHeader.indexOf("vorname");
      const pLnIdx = pHeader.indexOf("nachname");
      playerValues.slice(1).forEach((r) => {
        const id = String(r[pIdIdx] || "").trim();
        const vorname = (r[pFnIdx] || "").trim();
        const nachname = (r[pLnIdx] || "").trim();
        const display = `${nachname} ${vorname}`.trim();
        if (id) playerMap.set(id, { display, nachname });
      });
    }

    let entries = [];
    if (entryValues.length > 1) {
      const eHeader = entryValues[0].map((h) => h.trim().toLowerCase());
      const eIdIdx = eHeader.indexOf("id");
      const eBewerbIdIdx = eHeader.findIndex((h) =>
        ["bewerbid", "bewerb id", "bewerb-id", "bewerb", "bewerbsid", "bewerbs id"].includes(h));
      const ePersonenIdIdx = eHeader.findIndex((h) =>
        ["personenid", "personen id", "personen-id", "personid", "person id", "playerid", "player id", "spielerid", "spieler id"].includes(h));
      const eDatumIdx = eHeader.findIndex((h) =>
        ["datum", "date", "eingetragen", "timestamp", "zeitpunkt", "entrydate", "entry date"].includes(h));
      const eGebuehrIdx = eHeader.findIndex((h) =>
        ["gebuehrbezahlt", "gebuehr bezahlt", "gebühr bezahlt", "gebuehr", "gebühr"].includes(h));

      console.log("[loadEntries] header:", JSON.stringify(eHeader));
      console.log("[loadEntries] eIdIdx:", eIdIdx, "eBewerbIdIdx:", eBewerbIdIdx, "ePersonenIdIdx:", ePersonenIdIdx, "eDatumIdx:", eDatumIdx);
      console.log("[loadEntries] BEWERB_ID:", BEWERB_ID);
      console.log("[loadEntries] first data row:", JSON.stringify(entryValues[1]));

      entries = entryValues.slice(1)
        .filter((r) => {
          const ebId = eBewerbIdIdx !== -1 ? String(r[eBewerbIdIdx] || "").trim() : "";
          return ebId === BEWERB_ID;
        })
        .map((r) => {
          const personenId = ePersonenIdIdx !== -1 ? String(r[ePersonenIdIdx] || "").trim() : "";
          const playerInfo = playerMap.get(personenId) || { display: "Unbekannt", nachname: "" };
          const gebuehrBezahlt = eGebuehrIdx !== -1 ? String(r[eGebuehrIdx] || "").trim() : "";
          return {
            id: eIdIdx !== -1 ? String(r[eIdIdx] || "").trim() : "",
            personenId,
            name: playerInfo.display,
            nachname: playerInfo.nachname,
            datum: eDatumIdx !== -1 ? String(r[eDatumIdx] || "").trim() : "",
            gebuehrBezahlt: gebuehrBezahlt !== "",
          };
        })
        .sort((a, b) => a.nachname.localeCompare(b.nachname));
    }

    console.log("[loadEntries] filtered entries count:", entries.length);
    currentEntries = entries;
    initToolbar();

    if (entries.length === 0) {
      container.innerHTML = "<p>Noch keine Einträge für diesen Bewerb.</p>";
      return;
    }

    const table = document.createElement("table");
    table.className = "players-table";

    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>#</th><th>ID</th><th>Name</th><th>Eingetragen am</th></tr>";
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    entries.forEach((entry, idx) => {
      const tr = document.createElement("tr");
      if (entry.gebuehrBezahlt) tr.classList.add("entry-paid");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${entry.personenId}</td>
        <td>${entry.name || "Unbekannt"}</td>
        <td>${formatStoredDate(entry.datum)}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.innerHTML = "";
    container.appendChild(table);
  } catch (err) {
    console.error("Fehler beim Laden der Einträge:", err);
    container.innerHTML = `<p>Fehler: ${err.message}</p>`;
  }
}

async function handleEntrySubmit(btn) {
  const personenId = localStorage.getItem("currentUserId");
  if (!personenId) {
    showToast("Bitte vorher einloggen!", "error");
    return;
  }

  if (currentEntries.some((entry) => entry.personenId === personenId)) {
    showToast("Du bist für diesen Bewerb bereits eingetragen.", "error");
    return;
  }

  if (!isEntryPeriodActive()) {
    showToast("Die Eintragungsfrist ist nicht aktiv.", "error");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sende...";

  try {
    const datum = window.getStorageTimestamp ? window.getStorageTimestamp() : formatTimestampForStorage(new Date());

    const res = await addEntryList({
      bewerbId: BEWERB_ID,
      personenId,
      datum,
    });

    if (res.data?.success) {
      showToast("Erfolgreich eingetragen!", "success");
      await loadEntries();
    } else {
      throw new Error(res.data?.error || "Fehler beim Eintragen");
    }
  } catch (err) {
    console.error("Fehler beim Eintragen:", err);
    showToast("Fehler: " + (err.message || err), "error");
  }

  btn.disabled = false;
  btn.textContent = "Eintragen";
}

async function loadBewerbsName() {
  const heading = document.getElementById("entryListHeading");
  if (!heading || !BEWERB_ID) return;

  heading.textContent = `Entrylist für`;

  try {
    const res = await readBewerbe();
    const bewerbeValues = res.data?.values || [];
    if (bewerbeValues.length < 2) return;

    const bHeader = bewerbeValues[0].map((h) => h.trim().toLowerCase());
    const bIdIdx = bHeader.indexOf("id");
    const bBezIdx = bHeader.indexOf("bezeichnung");
    const bEntryStartIdx = bHeader.indexOf("entrystart");
    const bEntryDeadlineIdx = bHeader.indexOf("entrydeadline");
    const bewerbRow = bewerbeValues.slice(1).find((r) => String(r[bIdIdx] || "").trim() === String(BEWERB_ID).trim());
    if (bewerbRow) {
      if (bewerbRow[bBezIdx]) {
        heading.textContent = `Entrylist für ${bewerbRow[bBezIdx]}`;
      }
      entryStartRaw = bEntryStartIdx !== -1 ? String(bewerbRow[bEntryStartIdx] || "").trim() : "";
      entryDeadlineRaw = bEntryDeadlineIdx !== -1 ? String(bewerbRow[bEntryDeadlineIdx] || "").trim() : "";
      entryStartDate = parseSheetDate(entryStartRaw, false);
      entryDeadlineDate = parseSheetDate(entryDeadlineRaw, true);
    }
  } catch (err) {
    console.warn("Bewerbsname konnte nicht geladen werden:", err);
  }
}

async function handleEntryRemove(btn) {
  const personenId = localStorage.getItem("currentUserId");
  if (!personenId) {
    showToast("Bitte vorher einloggen!", "error");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Entferne...";

  try {
    const res = await removeEntryList({
      bewerbId: BEWERB_ID,
      personenId,
    });

    if (res.data?.success) {
      showToast("Erfolgreich ausgetragen!", "success");
      await loadEntries();
    } else {
      throw new Error(res.data?.error || "Fehler beim Austragen");
    }
  } catch (err) {
    console.error("Fehler beim Austragen:", err);
    showToast("Fehler: " + (err.message || err), "error");
  }

  btn.disabled = false;
  btn.textContent = "Austragen";
}

function initToolbar() {
  const toolbar = document.getElementById("entryListToolbar");
  if (!toolbar) return;

  toolbar.innerHTML = "";
  if (!BEWERB_ID) return;

  const active = isEntryPeriodActive();
  let statusMsg = "";
  if (!active) {
    const von = formatEntryDate(entryStartRaw);
    const bis = formatEntryDate(entryDeadlineRaw);
    let zeitraum = "";
    if (von && bis) zeitraum = ` (${von} bis ${bis})`;
    else if (von) zeitraum = ` (ab ${von})`;
    else if (bis) zeitraum = ` (bis ${bis})`;
    statusMsg = `Die Entrylist ist aktuell nicht geöffnet${zeitraum}.`;
  }

  if (statusMsg) {
    const msg = document.createElement("p");
    msg.className = "bewerb-date-info";
    msg.textContent = statusMsg;
    toolbar.appendChild(msg);
  }

  const personenId = localStorage.getItem("currentUserId");
  if (!personenId) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-login loggedIn";
    btn.textContent = "Anmelden";
    toolbar.appendChild(btn);
    return;
  }

  const isRegistered = currentEntries.some((entry) => entry.personenId === personenId);

  if (isRegistered) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-login";
    btn.textContent = "Austragen";
    btn.addEventListener("click", () => handleEntryRemove(btn));
    toolbar.appendChild(btn);
  } else if (active) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-login";
    btn.textContent = "Eintragen";
    btn.addEventListener("click", () => handleEntrySubmit(btn));
    toolbar.appendChild(btn);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadBewerbsName();
  await loadEntries();
});
