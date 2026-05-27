import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readBewerbe = httpsCallable(functions, "readBewerbe");

function parseSheetDate(raw) {
  if (!raw) return null;
  const rawStr = String(raw).trim();
  if (!rawStr) return null;

  const match8 = rawStr.match(/^(\d{4})(\d{2})(\d{2})(?:-(\d{2})(\d{2}))?$/);
  if (match8) {
    const [, yyyy, mm, dd] = match8;
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }

  const match6 = rawStr.match(/^(\d{2})(\d{2})(\d{2})(?:-(\d{2})(\d{2}))?$/);
  if (match6) {
    const [, yy, mm, dd] = match6;
    const yyyy = parseInt(yy, 10) >= 50 ? "19" + yy : "20" + yy;
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
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

function createCard(b, isUpcoming) {
  const card = document.createElement("div");
  const isRangliste = String(b.bewerbsartId).trim() === "2";

  card.className = "bewerb-card";

  if (isRangliste) {
    card.classList.add("clickable");
    card.addEventListener("click", () => {
      window.location.href = `rangliste.html?id=${b.id}`;
    });
  }

  const start = formatSheetDate(b.bewerbsbeginn);
  const end = b.bewerbsende ? formatSheetDate(b.bewerbsende) : "Offen";

  card.innerHTML = `
    <h3>${b.bezeichnung}</h3>
    <div class="bewerb-dates">
      <span>Beginn: ${start || "TBD"}</span>
      <span>Ende: ${end || "Offen"}</span>
    </div>
  `;

  if (b.entryListAvailable === "1") {
    if (!isUpcoming) return card;
    const entryBtn = document.createElement("button");
    entryBtn.type = "button";
    entryBtn.className = "btn-login";
    entryBtn.textContent = "Eintragen";
    entryBtn.style.marginTop = "10px";

    entryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.location.href = `entryList.html?id=${b.id}`;
    });

    card.appendChild(entryBtn);
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

  container.innerHTML = "<p class='loading-text'>Lade Bewerbe...</p>";

  try {
    const result = await readBewerbe();
    const { success, bewerbe = [] } = result.data || {};

    if (!success) {
      throw new Error("Fehler beim Laden");
    }

    const filtered = bewerbe.filter((b) => String(b.id).trim() !== "1");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
        document.getElementById("grid-upcoming").appendChild(createCard(b, true));
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
  } catch (err) {
    console.error("Fehler beim Laden:", err);
    container.innerHTML = `<p>Fehler: ${err.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadBewerbe();
});
