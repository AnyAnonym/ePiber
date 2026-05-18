import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readEntryList = httpsCallable(functions, "readEntryList");
const addEntryList   = httpsCallable(functions, "addEntryList");
const readBewerbe    = httpsCallable(functions, "readBewerbe");

const params = new URLSearchParams(window.location.search);
const BEWERB_ID = params.get("id");
let currentEntries = [];

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
    const res = await readEntryList({ bewerbId: BEWERB_ID });
    const { success, entries = [] } = res?.data || {};

    if (!success) throw new Error("Fehler beim Laden");

    currentEntries = entries;

    if (entries.length === 0) {
      container.innerHTML = "<p>Noch keine Einträge für diesen Bewerb.</p>";
      return;
    }

    const table = document.createElement("table");
    table.className = "players-table";

    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>#</th><th>Name</th><th>Eingetragen am</th></tr>";
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    entries.forEach((entry, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
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

  btn.disabled = true;
  btn.textContent = "Sende...";

  try {
    const datum = formatTimestampForStorage(new Date());

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

  heading.textContent = `Eintragungs Liste für Bewerb ${BEWERB_ID}`;

  try {
    const res = await readBewerbe();
    const { success, bewerbe = [] } = res?.data || {};
    if (!success) return;

    const bewerb = bewerbe.find((b) => String(b.id).trim() === String(BEWERB_ID).trim());
    if (bewerb && bewerb.bezeichnung) {
      heading.textContent = `Eintragungs Liste für ${bewerb.bezeichnung}`;
    }
  } catch (err) {
    console.warn("Bewerbsname konnte nicht geladen werden:", err);
  }
}

function initToolbar() {
  const toolbar = document.getElementById("entryListToolbar");
  if (!toolbar) return;

  const heading = document.getElementById("entryListHeading");
  if (heading) {
    heading.textContent = BEWERB_ID
      ? `Eintragungs Liste für Bewerb ${BEWERB_ID}`
      : "Eintragungs Liste";
  }

  toolbar.innerHTML = "";
  if (!BEWERB_ID) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-login";
  btn.textContent = "Eintragen";
  btn.addEventListener("click", () => handleEntrySubmit(btn));
  toolbar.appendChild(btn);
}

document.addEventListener("DOMContentLoaded", async () => {
  initToolbar();
  await loadBewerbsName();
  loadEntries();
});
