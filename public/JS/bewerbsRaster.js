import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readPreMatches   = httpsCallable(functions, "readPreMatches");
const readPlayersList  = httpsCallable(functions, "readPlayersList");
const readBewerbe      = httpsCallable(functions, "readBewerbe");

const params = new URLSearchParams(window.location.search);
const BEWERB_ID = params.get("id");

function parseRaster(val) {
  if (!val) return null;
  const s = String(val).trim().toUpperCase();
  if (!s) return null;
  if (s === "F") return { roundKey: "F", match: 1, roundName: "Finale", order: 7 };
  const m = s.match(/^(R[1-9]|AF|VF|HF)-P(\d+)$/);
  if (!m) return null;
  const LABELS = {
    R1: "1. Runde", R2: "2. Runde", R3: "3. Runde",
    AF: "Achtelfinale", VF: "Viertelfinale", HF: "Halbfinale",
  };
  const ORDER = { R1: 1, R2: 2, R3: 3, AF: 4, VF: 5, HF: 6, F: 7 };
  return {
    roundKey: m[1],
    match: parseInt(m[2], 10),
    roundName: LABELS[m[1]] || m[1],
    order: ORDER[m[1]] || 99,
  };
}

function buildRounds(data, header, playerMap) {
  const h = header.map((c) => String(c).trim().toLowerCase());
  const bwIdx = h.indexOf("bewerbid");
  const p1Idx = h.indexOf("spielerid1");
  const p2Idx = h.indexOf("spielerid2");
  const p3Idx = h.indexOf("spielerid3");
  const p4Idx = h.indexOf("spielerid4");
  const rtIdx = h.indexOf("rasterpaarung");

  const rounds = {};

  data.forEach((row) => {
    if (bwIdx >= 0) {
      const rowBw = String(row[bwIdx] || "").trim();
      if (rowBw !== String(BEWERB_ID).trim()) return;
    }

    const rasterRaw = rtIdx >= 0 ? String(row[rtIdx] || "").trim() : "";
    const p = parseRaster(rasterRaw);
    if (!p) return;

    const p1 = String(row[p1Idx] || "").trim();
    const p2 = String(row[p2Idx] || "").trim();
    const p3 = String(row[p3Idx] || "").trim();
    const p4 = String(row[p4Idx] || "").trim();

    if (!rounds[p.roundKey]) {
      rounds[p.roundKey] = {
        roundKey: p.roundKey,
        roundName: p.roundName,
        order: p.order,
        matches: [],
      };
    }

    rounds[p.roundKey].matches.push({
      matchNum: p.match,
      top: {
        id: p1,
        name: playerMap.get(p1) || null,
        partner: p2 ? playerMap.get(p2) || null : null,
      },
      bottom: {
        id: p3,
        name: playerMap.get(p3) || null,
        partner: p4 ? playerMap.get(p4) || null : null,
      },
    });
  });

  Object.values(rounds).forEach((r) => {
    r.matches.sort((a, b) => a.matchNum - b.matchNum);
  });

  return Object.values(rounds).sort((a, b) => a.order - b.order);
}

function renderBracket(bracketRounds) {
  const container = document.getElementById("bracketContainer");
  if (!container) return;

  container.innerHTML = "";

  if (!bracketRounds || bracketRounds.length === 0) {
    container.innerHTML = "<p>Keine Rasterdaten für diesen Bewerb.</p>";
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "bracket";

  bracketRounds.forEach((round) => {
    const col = document.createElement("div");
    col.className = "bracket-round";

    const header = document.createElement("div");
    header.className = "bracket-round-header";
    header.textContent = round.roundName;
    col.appendChild(header);

    round.matches.forEach((match) => {
      const md = document.createElement("div");
      md.className = "bracket-match";

      [match.top, match.bottom].forEach((slot) => {
        const el = document.createElement("div");
        el.className = "bracket-player";

        let label = "—";
        if (slot.name) {
          label = slot.name;
          if (slot.partner) label += ` + ${slot.partner}`;
        }

        el.textContent = label;
        if (!slot.name) el.classList.add("bye");

        if (slot.id) {
          el.dataset.playerId = slot.id;
          el.addEventListener("click", () => {
            if (typeof window.openProfileModal === "function") {
              window.openProfileModal(slot.id);
            }
          });
        }

        md.appendChild(el);
      });

      col.appendChild(md);
    });

    wrapper.appendChild(col);
  });

  container.appendChild(wrapper);
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
    const [bewerbRes, preRes, playerRes] = await Promise.all([
      readBewerbe(),
      readPreMatches(),
      readPlayersList(),
    ]);

    const bewerbValues = bewerbRes.data?.values || [];
    const preValues = preRes.data?.values || [];
    const playerValues = playerRes.data?.values || [];

    let bewerbName = `Bewerb ${BEWERB_ID}`;
    if (bewerbValues.length > 1) {
      const bh = bewerbValues[0].map((h) => String(h).trim().toLowerCase());
      const idIdx = bh.indexOf("id");
      const bzIdx = bh.indexOf("bezeichnung");
      const row = bewerbValues.slice(1).find(
        (r) => String(r[idIdx] || "").trim() === String(BEWERB_ID).trim());
      if (row && row[bzIdx]) bewerbName = row[bzIdx];
    }
    if (heading) heading.textContent = `Turnierraster – ${bewerbName}`;

    const playerMap = new Map();
    if (playerValues.length > 1) {
      const ph = playerValues[0].map((h) => String(h).trim().toLowerCase());
      const pidIdx = ph.indexOf("id");
      const pfnIdx = ph.indexOf("vorname");
      const plnIdx = ph.indexOf("nachname");
      playerValues.slice(1).forEach((r) => {
        const id = String(r[pidIdx] || "").trim();
        const name = [r[pfnIdx], r[plnIdx]].filter(Boolean).map((s) => String(s).trim()).join(" ");
        if (id) playerMap.set(id, name);
      });
    }

    if (preValues.length < 2) {
      if (container) container.innerHTML = "<p>Keine Rasterdaten vorhanden.</p>";
      if (info) info.textContent = "";
      return;
    }

    const header = preValues[0];
    const data = preValues.slice(1);

    const bracketRounds = buildRounds(data, header, playerMap);

    const totalMatches = bracketRounds.reduce((sum, r) => sum + r.matches.length, 0);
    if (info) {
      info.innerHTML = `<span class="bracket-player-count">${bracketRounds.length} Runden, ${totalMatches} Partien</span>`;
    }

    renderBracket(bracketRounds);

  } catch (err) {
    console.error("Fehler beim Laden des Turnierrasters:", err);
    if (container) container.innerHTML = `<p>Fehler: ${err.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadBracket();
});
