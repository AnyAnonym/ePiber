import { createEndpoint } from "./dataClient.js";
import { callWithRetry, showLoadingOverlay, hideLoadingOverlay, showErrorOverlay } from "./loadingHelper.js";

const readBewerbe = createEndpoint("bewerbe");
const readBewerbsart = createEndpoint("bewerbsart");

function parseSheetDate(raw) {
  if (!raw) return null;
  const rawStr = String(raw).trim();
  if (!rawStr) return null;

  // YYYYMMDD-HHMM
  const match8t = rawStr.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (match8t) {
    const [, yyyy, mm, dd, hh, mi] = match8t;
    return new Date(+yyyy, +mm - 1, +dd, +hh, +mi);
  }

  // YYYYMMDD
  const match8 = rawStr.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match8) {
    const [, yyyy, mm, dd] = match8;
    return new Date(+yyyy, +mm - 1, +dd);
  }

  // YYMMDD-HHMM
  const match6t = rawStr.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (match6t) {
    const [, yy, mm, dd, hh, mi] = match6t;
    const yyyy = parseInt(yy, 10) >= 50 ? 1900 + +yy : 2000 + +yy;
    return new Date(yyyy, +mm - 1, +dd, +hh, +mi);
  }

  // YYMMDD
  const match6 = rawStr.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (match6) {
    const [, yy, mm, dd] = match6;
    const yyyy = parseInt(yy, 10) >= 50 ? 1900 + +yy : 2000 + +yy;
    return new Date(yyyy, +mm - 1, +dd);
  }

  return null;
}

function formatSheetDate(raw) {
  if (!raw) return "";
  const date = parseSheetDate(raw);
  if (!date) return String(raw).trim();

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

// ── Bewerb Cards ────────────────────────────────────────────────────────

function createCard(b, _isUpcoming) {
  const card = document.createElement("div");
  const bewerbsartId = String(b.bewerbsartId).trim();
  const isRangliste = bewerbsartId === "2";
  const isRoundRobin = b.roundRobin === "1";

  card.className = "bewerb-card";

  if (isRangliste) {
    card.classList.add("clickable");
    card.addEventListener("click", () => {
      window.location.href = `rangliste.html?id=${b.id}`;
    });
  }

  const start = formatSheetDate(b.bewerbsbeginn);
  const end = b.bewerbsende ? formatSheetDate(b.bewerbsende) : "Offen";
  const entryStart = formatSheetDate(b.entrystart);
  const entryDeadline = formatSheetDate(b.entrydeadline);
  const hasEntryList = b.entryListAvailable === "1";

  card.innerHTML = `
    <h3>${b.bezeichnung}</h3>
    <div class="bewerb-dates${hasEntryList ? " with-entrylist" : ""}">
      <span>Bewerbs Beginn: ${start || "---"}</span>
      ${hasEntryList ? `<span>Eintragungsliste Beginn: ${entryStart || "---"}</span>` : ""}
      <span>Bewerbs Ende: ${end || "Offen"}</span>
      ${hasEntryList ? `<span>Eintragungsliste Ende: ${entryDeadline || "Offen"}</span>` : ""}
    </div>
  `;

  // Alle Bewerbe außer Rangliste: Klick-Logik
  if (!isRangliste) {
    const userId = localStorage.getItem("currentUserId");
    const now = new Date();
    const endDate = parseSheetDate(b.bewerbsende);
    const isEnded = endDate ? endDate < now : false;
    const deadline = parseSheetDate(b.entrydeadline);
    const isPastDeadline = deadline ? deadline < now : false;
    const entryStartDate = parseSheetDate(b.entrystart);
    const isBeforeEntryStart = entryStartDate ? entryStartDate > now : false;
    const bewerbStart = parseSheetDate(b.bewerbsbeginn);
    const hasStarted = bewerbStart ? bewerbStart <= now : false;

    // Zielseite bestimmen + Klickbarkeit
    let target = null;
    const isEntryOpen = !isBeforeEntryStart && !isPastDeadline && hasEntryList;

    if (hasStarted && !isEnded) {
      // Bewerb läuft → zur Bewerbsseite
      if (isRoundRobin) {
        target = `RoundRobin.html?id=${b.id}`;
      } else {
        target = `bewerbsRaster.html?id=${b.id}`;
      }
    } else if (isEntryOpen) {
      // Bewerb hat noch nicht begonnen, aber EntryList ist offen
      target = `entryList.html?id=${b.id}`;
    }

    if (userId && target) {
      card.classList.add("clickable");
      card.addEventListener("click", () => {
        window.location.href = target;
      });
    }
  }

  return card;
}

function createGrid(id) {
  const grid = document.createElement("div");
  grid.className = "bewerb-grid";
  grid.id = id;
  return grid;
}

function createSection(title, gridId) {
  const section = document.createElement("div");
  section.className = "bewerb-section";

  const heading = document.createElement("h3");
  heading.className = "bewerb-section-title";
  heading.textContent = title;

  const grid = createGrid(gridId);

  section.appendChild(heading);
  section.appendChild(grid);

  return section;
}

function classifyBewerb(b, today) {
  const startRaw = String(b.bewerbsbeginn || "").trim();
  const endRaw = String(b.bewerbsende || "").trim();

  const startDate = parseSheetDate(startRaw);
  const endDate = parseSheetDate(endRaw);

  const started = startDate ? startDate <= today : false;
  const ended = endDate ? endDate < today : false;

  if (started && !ended) return "active";
  if (!started && !ended) return "upcoming";
  if (ended) return "finished";

  if (!startDate && !endDate) return "active";

  return "upcoming";
}

async function loadBewerbe() {
  const container = document.getElementById("bewerbe-container");
  if (!container) return;

  container.innerHTML = "";
  showLoadingOverlay("Lade Bewerbe...");

  try {
    const [bewerbRes, bewerbsartRes] = await Promise.all([
      callWithRetry(readBewerbe),
      callWithRetry(readBewerbsart),
    ]);

    const bewerbValues = bewerbRes.data?.values || [];
    const bewerbsartValues = bewerbsartRes.data?.values || [];

    if (bewerbValues.length < 2) {
      container.innerHTML = "<p>Keine Bewerbe gefunden.</p>";
      return;
    }

    const baMap = new Map();
    if (bewerbsartValues.length > 1) {
      const baHeader = bewerbsartValues[0].map((h) => h.trim().toLowerCase());
      const baIdIdx = baHeader.indexOf("id");
      const baEntryIdx = baHeader.indexOf("entrylistavailable");
      const baBezIdx = baHeader.indexOf("bezeichnung");
      const baRRIdx = baHeader.indexOf("roundrobin");
      bewerbsartValues.slice(1).forEach((r) => {
        const id = String(r[baIdIdx] || "").trim();
        if (id) {
          baMap.set(id, {
            bezeichnung: String(r[baBezIdx] || "").trim(),
            entryListAvailable: baEntryIdx !== -1 ? String(r[baEntryIdx] || "0").trim() : "0",
            roundRobin: baRRIdx !== -1 ? String(r[baRRIdx] || "0").trim() : "0",
          });
        }
      });
    }

    const bHeader = bewerbValues[0].map((h) => h.trim().toLowerCase());
    const bIdIdx = bHeader.indexOf("id");
    const bBewerbsartIdx = bHeader.indexOf("bewerbsartid");
    const bBezIdx = bHeader.indexOf("bezeichnung");
    const bEntryStartIdx = bHeader.indexOf("entrystart");
    const bEntryDeadlineIdx = bHeader.indexOf("entrydeadline");
    const bStartIdx = bHeader.indexOf("bewerbsbeginn");
    const bEndIdx = bHeader.indexOf("bewerbsende");

    const bewerbe = bewerbValues.slice(1).map((row) => {
      const bewerbsartId = String(row[bBewerbsartIdx] || "").trim();
      const baInfo = baMap.get(bewerbsartId) || {};
      return {
        id: row[bIdIdx] || "",
        bewerbsartId,
        bezeichnung: row[bBezIdx] || "",
        entrystart: bEntryStartIdx !== -1 ? row[bEntryStartIdx] || "" : "",
        entrydeadline: bEntryDeadlineIdx !== -1 ? row[bEntryDeadlineIdx] || "" : "",
        bewerbsbeginn: row[bStartIdx] || "",
        bewerbsende: row[bEndIdx] || "",
        entryListAvailable: baInfo.entryListAvailable || "0",
        roundRobin: baInfo.roundRobin || "0",
      };
    });

    const filtered = bewerbe.filter((b) => String(b.id).trim() !== "1");

    const today = new Date();

    const active = [];
    const upcoming = [];
    const finished = [];

    filtered.forEach((b) => {
      const cat = classifyBewerb(b, today);
      if (cat === "active") active.push(b);
      else if (cat === "upcoming") upcoming.push(b);
      else if (cat === "finished") finished.push(b);
    });

    container.innerHTML = "";

    if (active.length > 0) {
      const section = createSection("Aktive Bewerbe", "grid-active");
      container.appendChild(section);
      active.forEach((b) => {
        document.getElementById("grid-active").appendChild(createCard(b));
      });
    }

    if (upcoming.length > 0) {
      const section = createSection("Bevorstehende Bewerbe", "grid-upcoming");
      container.appendChild(section);
      upcoming.forEach((b) => {
        document.getElementById("grid-upcoming").appendChild(createCard(b));
      });
    }

    if (finished.length > 0) {
      const section = createSection("Beendete Bewerbe", "grid-finished");
      container.appendChild(section);
      finished.forEach((b) => {
        document.getElementById("grid-finished").appendChild(createCard(b));
      });
    }

    if (active.length === 0 && upcoming.length === 0 && finished.length === 0) {
      container.innerHTML = "<p>Keine Bewerbe gefunden.</p>";
    }
    hideLoadingOverlay();
  } catch (err) {
    console.error("Fehler beim Laden:", err);
    showErrorOverlay("Fehler beim Laden der Bewerbe", loadBewerbe);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadBewerbe();
});
