import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readPreMatches   = httpsCallable(functions, "readPreMatches");
const readPlayersList  = httpsCallable(functions, "readPlayersList");

const params = new URLSearchParams(window.location.search);
const BEWERB_ID = params.get("id");

const ROUND_LABELS = ["1. Runde", "Achtelfinale", "Viertelfinale", "Halbfinale", "Finale"];

function parseRaster(val) {
  if (!val) return null;
  const s = String(val).trim().toUpperCase();
  if (!s) return null;
  if (s === "F") return { roundKey: "F", match: 1 };
  const m = s.match(/^(R[1-9]|AF|VF|HF)-P(\d+)$/);
  if (!m) return null;
  return { roundKey: m[1], match: parseInt(m[2], 10) };
}

function buildRounds(data, header, playerMap) {
  const h = header.map((c) => String(c).trim().toLowerCase());
  const bwIdx = h.indexOf("bewerbid");
  const p1Idx = h.indexOf("spielerid1");
  const p3Idx = h.indexOf("spielerid3");
  const rtIdx = h.indexOf("rasterpaarung");

  const slotMap = {};

  data.forEach((row) => {
    if (bwIdx >= 0 && String(row[bwIdx] || "").trim() !== String(BEWERB_ID).trim()) return;
    const p = parseRaster(rtIdx >= 0 ? String(row[rtIdx] || "").trim() : "");
    if (!p) return;
    const key = p.roundKey + "-" + p.match;
    slotMap[key] = {
      top: { id: String(row[p1Idx] || "").trim(), name: null },
      bottom: { id: String(row[p3Idx] || "").trim(), name: null },
    };
  });

  Object.values(slotMap).forEach((e) => {
    if (e.top.id) e.top.name = playerMap.get(e.top.id) || null;
    if (e.bottom.id) e.bottom.name = playerMap.get(e.bottom.id) || null;
  });

  let r1Count = 0;
  for (const key of Object.keys(slotMap)) {
    const m = key.match(/^R1-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > r1Count) r1Count = n;
    }
  }

  if (r1Count < 1) return [];

  const roundDefs = [
    { label: ROUND_LABELS[0], count: r1Count, keyPfx: "R1" },
    { label: ROUND_LABELS[1], count: Math.ceil(r1Count / 2), keyPfx: "AF" },
    { label: ROUND_LABELS[2], count: Math.ceil(r1Count / 4), keyPfx: "VF" },
    { label: ROUND_LABELS[3], count: Math.ceil(r1Count / 8), keyPfx: "HF" },
    { label: ROUND_LABELS[4], count: 1, keyPfx: "F" },
  ];

  return roundDefs.map((rd) => {
    const matches = [];
    for (let m = 1; m <= rd.count; m++) {
      const key = rd.keyPfx + "-" + m;
      const sm = slotMap[key];
      matches.push({
        matchNum: m,
        top: sm ? sm.top : { id: "", name: null },
        bottom: sm ? sm.bottom : { id: "", name: null },
      });
    }
    return { roundName: rd.label, matches };
  });
}

function addConnectors(grid, rounds) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "bracket-lines");
  grid.appendChild(svg);

  const matchEls = grid.querySelectorAll(".bracket-match");
  const byCol = {};
  matchEls.forEach((el) => {
    const col = parseInt(el.style.gridColumn, 10);
    if (!byCol[col]) byCol[col] = [];
    byCol[col].push(el);
  });

  for (let col = 1; col < rounds.length; col++) {
    const left = byCol[col];
    const right = byCol[col + 1];
    if (!left || !right) continue;

    left.sort((a, b) => parseInt(a.style.gridRow, 10) - parseInt(b.style.gridRow, 10));
    right.sort((a, b) => parseInt(a.style.gridRow, 10) - parseInt(b.style.gridRow, 10));

    for (let i = 0; i < left.length; i += 2) {
      const topEl = left[i];
      const botEl = left[i + 1];
      const nextEl = right[Math.floor(i / 2)];
      if (!topEl || !botEl || !nextEl) continue;

      const gRect = grid.getBoundingClientRect();
      const tRect = topEl.getBoundingClientRect();
      const bRect = botEl.getBoundingClientRect();
      const nRect = nextEl.getBoundingClientRect();

      const x1 = tRect.right - gRect.left;
      const y1 = tRect.top + tRect.height / 2 - gRect.top;
      const x2 = bRect.right - gRect.left;
      const y2 = bRect.top + bRect.height / 2 - gRect.top;
      const x3 = nRect.left - gRect.left;
      const y3 = nRect.top + nRect.height / 2 - gRect.top;

      const midX = (x1 + x3) / 2;
      const midY = (y1 + y2) / 2;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const d = [
        `M ${x1} ${y1}`,
        `L ${midX} ${y1}`,
        `L ${midX} ${y2}`,
        `L ${x2} ${y2}`,
        `M ${midX} ${midY}`,
        `L ${x3} ${midY}`,
      ].join(" ");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
  }
}

function renderBracket(rounds) {
  const container = document.getElementById("bracketContainer");
  if (!container) return;
  container.innerHTML = "";

  if (!rounds || rounds.length === 0) {
    container.innerHTML = "<p>Keine Rasterdaten für diesen Bewerb.</p>";
    return;
  }

  const numRounds = rounds.length;
  const gridRows = Math.pow(2, numRounds);

  const bracketDiv = document.createElement("div");
  bracketDiv.className = "bracket";

  const grid = document.createElement("div");
  grid.className = "bracket-grid";
  grid.style.setProperty("--cols", numRounds);
  grid.style.setProperty("--rows", gridRows);
  grid.style.height = (gridRows * 80) + "px";

  rounds.forEach((round, rIdx) => {
    round.matches.forEach((match, mIdx) => {
      const row = (1 + 2 * mIdx) * Math.pow(2, rIdx);

      const md = document.createElement("div");
      md.className = "bracket-match";
      md.style.gridColumn = rIdx + 1;
      md.style.gridRow = row;

      [match.top, match.bottom].forEach((slot) => {
        const el = document.createElement("div");
        el.className = "bracket-player";

        let label = "—";
        if (slot.name) {
          label = slot.name;
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

      grid.appendChild(md);
    });
  });

  bracketDiv.appendChild(grid);
  container.appendChild(bracketDiv);

  addConnectors(grid, rounds);
}

async function loadBracket() {
  const container = document.getElementById("bracketContainer");

  if (!BEWERB_ID) {
    if (container) container.innerHTML = "<p>Bitte eine Bewerb-ID angeben.</p>";
    return;
  }

  if (container) container.innerHTML = "<p class='loading-text'>Lade Raster...</p>";

  try {
    const [preRes, playerRes] = await Promise.all([
      readPreMatches(),
      readPlayersList(),
    ]);

    const preValues = preRes.data?.values || [];
    const playerValues = playerRes.data?.values || [];

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
      return;
    }

    const rounds = buildRounds(preValues.slice(1), preValues[0], playerMap);

    if (rounds.length === 0) {
      if (container) container.innerHTML = "<p>Keine Rasterdaten für diesen Bewerb.</p>";
      return;
    }

    renderBracket(rounds);

  } catch (err) {
    console.error("Fehler beim Laden des Turnierrasters:", err);
    if (container) container.innerHTML = `<p>Fehler: ${err.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadBracket();
});
