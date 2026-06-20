import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readPreMatches   = httpsCallable(functions, "readPreMatches");
const readMatchesList  = httpsCallable(functions, "readMatchesList");
const readPlayersList  = httpsCallable(functions, "readPlayersList");
const readBewerbe      = httpsCallable(functions, "readBewerbe");
const readBewerbsart   = httpsCallable(functions, "readBewerbsart");

const params = new URLSearchParams(window.location.search);
const BEWERB_ID = params.get("id");

const ROUND_DISPLAY = {
  R1: "1. Runde", R2: "2. Runde", R3: "3. Runde",
  AF: "Achtelfinale", VF: "Viertelfinale", HF: "Halbfinale", F: "Finale",
};

function parsePlayerId(raw) {
  const s = String(raw || "").trim();
  const wo = /\[w\.o\.\]/.test(s);
  const cleanId = s.replace(/\[w\.o\.\]/gi, "").trim();
  const pre = /^PRE$/i.test(cleanId);
  return { cleanId, special: wo ? "wo" : null, pre };
}

function badgeHtml(type) {
  if (type === "wo") return '<span class="badge badge-wo">w.o.</span>';
  if (type === "ret") return '<span class="badge badge-wo">ret.</span>';
  return "";
}

function parseRaster(val) {
  if (!val) return null;
  const s = String(val).trim().toUpperCase();
  if (!s) return null;
  if (s === "F") return { roundKey: "F", match: 1 };
  const m = s.match(/^(R[1-9]|AF|VF|HF)-P(\d+)$/);
  if (!m) return null;
  return { roundKey: m[1], match: parseInt(m[2], 10) };
}

function parseResult(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  const parts = s.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const sets = parts.map((p) => {
    if (/\[ret\]/.test(p)) {
      const sc = p.split("-");
      const retOnLeft = sc[0] && sc[0].includes("[ret]");
      return { left: 0, right: 0, special: "ret", retOnLeft };
    }
    const sc = p.split("-");
    if (sc.length !== 2) return null;
    const a = parseInt(sc[0], 10);
    const b = parseInt(sc[1], 10);
    if (isNaN(a) || isNaN(b)) return null;
    return { left: a, right: b };
  });
  if (sets.some((s) => s === null)) return null;
  return sets;
}

function buildRounds(preData, preHeader, matchData, matchHeader, playerMap, r1CountConfigPlayers) {
  const slotMap = {};

  function processRows(data, header, isMatch) {
    const h = header.map((c) => String(c).trim().toLowerCase());
    const bwIdx = h.indexOf("bewerbid");
    const p1Idx = h.indexOf("spielerid1");
    const p3Idx = h.indexOf("spielerid3");
    const rtIdx = h.indexOf("rasterpaarung");
    const ergebnisIdx = isMatch ? h.indexOf("ergebnis") : -1;
    const gewinnerIdx = isMatch ? h.indexOf("gewinner") : -1;

    data.forEach((row) => {
      if (bwIdx >= 0 && String(row[bwIdx] || "").trim() !== String(BEWERB_ID).trim()) return;
      const p = parseRaster(rtIdx >= 0 ? String(row[rtIdx] || "").trim() : "");
      if (!p) return;
      const key = p.roundKey + "-" + p.match;

      const pid1 = parsePlayerId(row[p1Idx]);
      const pid3 = parsePlayerId(row[p3Idx]);

      const entry = {
        top: { id: pid1.cleanId, name: null, special: pid1.special, pre: pid1.pre },
        bottom: { id: pid3.cleanId, name: null, special: pid3.special, pre: pid3.pre },
        result: null,
        winner: null,
      };

      if (isMatch) {
        const rawResult = String(row[ergebnisIdx] || "").trim();
        entry.result = parseResult(rawResult);
        entry.winner = String(row[gewinnerIdx] || "").trim();
      }

      const existing = slotMap[key];
      if (!existing || isMatch) {
        slotMap[key] = entry;
      }
    });
  }

  processRows(preData, preHeader, false);
  processRows(matchData, matchHeader, true);

  Object.values(slotMap).forEach((e) => {
    const resolve = (id) => /^BYE$/i.test(id) ? "BYE" : /^PRE$/i.test(id) ? null : (playerMap.get(id) || null);
    if (e.top.id) e.top.name = resolve(e.top.id);
    if (e.bottom.id) e.bottom.name = resolve(e.bottom.id);
  });

  let r1Count = 0;
  for (const key of Object.keys(slotMap)) {
    const m = key.match(/^R1-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > r1Count) r1Count = n;
    }
  }

  if (r1CountConfigPlayers < 2) return [];

  const effCount = Math.floor(r1CountConfigPlayers / 2);

  // Halving sequence: [32,16,8,4,2,1] for 64er, [16,8,4,2,1] for 32er
  const seq = [effCount];
  while (seq[seq.length - 1] > 1) seq.push(Math.ceil(seq[seq.length - 1] / 2));

  const n = seq.length;
  const roundDefs = [];

  // Number of fixed-named rounds at the end: up to 4 (AF, VF, HF, F)
  const fixedCount = Math.min(n, 4);
  const rCount = n - fixedCount; // R rounds before the fixed block

  // R rounds (R1, R2, ...)
  for (let i = 0; i < rCount; i++) {
    const rNum = i + 1;
    roundDefs.push({
      label: ROUND_DISPLAY["R" + rNum] || "R" + rNum + ". Runde",
      count: seq[i],
      keyPfx: "R" + rNum,
    });
  }

  // Fixed rounds: mapped from the end — F, HF, VF, AF
  const FIXED = ["AF", "VF", "HF", "F"];
  const fixedOffset = 4 - fixedCount; // how many fixed names to skip from the left
  for (let i = 0; i < fixedCount; i++) {
    const keyPfx = FIXED[fixedOffset + i];
    roundDefs.push({
      label: ROUND_DISPLAY[keyPfx] || keyPfx,
      count: seq[rCount + i],
      keyPfx,
    });
  }

  console.log("buildRounds: r1CountConfigPlayers=" + r1CountConfigPlayers + " effCount=" + effCount + " seq=" + JSON.stringify(seq));
  console.log("roundDefs:", JSON.stringify(roundDefs.map(d => d.label + ":" + d.count)));

  const result = roundDefs.map((rd) => {
    const matches = [];
    for (let m = 1; m <= rd.count; m++) {
      const key = rd.keyPfx + "-" + m;
      const sm = slotMap[key];
      matches.push({
        matchNum: m,
        top: sm ? sm.top : { id: "", name: null },
        bottom: sm ? sm.bottom : { id: "", name: null },
        result: sm ? sm.result : null,
        winner: sm ? sm.winner : null,
      });
    }
    return { roundName: rd.label, matches };
  });
  console.log("result rounds:", JSON.stringify(result.map(r => r.roundName + ":" + r.matches.length)));
  return result;
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

  console.log("addConnectors: columns=" + Object.keys(byCol).length + " per col:", JSON.stringify(Object.entries(byCol).map(([k,v]) => k+":"+v.length)));

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
  const r1Count = rounds[0].matches.length;
  const gridRows = r1Count * 2;

  console.log("renderBracket: rounds=" + numRounds + " r1Count=" + r1Count + " gridRows=" + gridRows);

  const bracketDiv = document.createElement("div");
  bracketDiv.className = "bracket";

  const headerRow = document.createElement("div");
  headerRow.className = "bracket-header-row";
  headerRow.style.setProperty("--cols", numRounds);
  rounds.forEach((r) => {
    const h = document.createElement("div");
    h.className = "bracket-round-header";
    h.textContent = r.roundName;
    headerRow.appendChild(h);
  });
  bracketDiv.appendChild(headerRow);

  const grid = document.createElement("div");
  grid.className = "bracket-grid";
  grid.style.setProperty("--cols", numRounds);
  grid.style.setProperty("--rows", gridRows);
  grid.style.height = (gridRows * 52) + "px";

  rounds.forEach((round, rIdx) => {
    round.matches.forEach((match, mIdx) => {
      const row = (1 + 2 * mIdx) * Math.pow(2, rIdx);

      const md = document.createElement("div");
      md.className = "bracket-match";
      md.style.gridColumn = rIdx + 1;
      md.style.gridRow = row;

      if (match.result) md.classList.add("has-result");

      [match.top, match.bottom].forEach((slot, sIdx) => {
        const el = document.createElement("div");
        el.className = "bracket-player";
        slot._el = el;
        if (slot.pre) el.classList.add("blink-green");

        const slotId = slot.id;
        const isWinner = match.winner && slotId && match.winner === slotId;

        if (isWinner) el.classList.add("winner");

        if (match.result && slot.name) {
          const side = sIdx === 0 ? "left" : "right";
          const score = match.result.map((s) => side === "left" ? s.left : s.right).join(" | ");
          const hasRet = match.result.some((s) => s.special && (side === "left" ? s.retOnLeft : !s.retOnLeft));
          el.innerHTML = `<span class="pname">${slot.name}</span> <span class="pscore">${score}</span>${hasRet ? " " + badgeHtml("ret") : ""}`;
        } else {
          el.innerHTML = (slot.name || "—") + (slot.name ? " " + badgeHtml(slot.special) : "");
          if (!slot.name) el.classList.add("bye");
        }

        if (slotId) {
          el.dataset.playerId = slotId;
          el.addEventListener("click", () => {
            if (typeof window.openProfileModal === "function") {
              window.openProfileModal(slotId);
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

let cachedRounds = null;
let cachedPlayerMap = null;
let cachedR1Count = 16;
let cachedBewerbName = "";

async function loadBracket() {
  const container = document.getElementById("bracketContainer");

  if (!BEWERB_ID) {
    if (container) container.innerHTML = "<p>Bitte eine Bewerb-ID angeben.</p>";
    return;
  }

  if (container) container.innerHTML = "<p class='loading-text'>Lade Raster...</p>";

  try {
    const [bewerbRes, bewbsRes, preRes, matchRes, playerRes] = await Promise.all([
      readBewerbe(),
      readBewerbsart(),
      readPreMatches(),
      readMatchesList(),
      readPlayersList(),
    ]);

    const bewerbValues = bewerbRes.data?.values || [];
    const bewbsValues = bewbsRes.data?.values || [];
    const preValues = preRes.data?.values || [];
    const matchValues = matchRes.data?.values || [];
    const playerValues = playerRes.data?.values || [];

    let r1CountConfigPlayers = 16;
    let bewerbName = "";
    let isRoundRobin = false;
    if (bewerbValues.length > 1 && bewbsValues.length > 1) {
      const bh = bewerbValues[0].map((h) => String(h).trim().toLowerCase());
      const bIdIdx = bh.indexOf("id");
      const bBewbsIdx = bh.indexOf("bewerbsartid");
      const bBezIdx = bh.indexOf("bezeichnung");
      const bewerbRow = bewerbValues.slice(1).find(
        (r) => String(r[bIdIdx] || "").trim() === String(BEWERB_ID).trim());
      if (bewerbRow && bBewbsIdx !== -1) {
        const bewbsId = String(bewerbRow[bBewbsIdx] || "").trim();
        if (bBezIdx !== -1) bewerbName = String(bewerbRow[bBezIdx] || "").trim();
        const ash = bewbsValues[0].map((h) => String(h).trim().toLowerCase());
        const aIdIdx = ash.indexOf("id");
        const aRastIdx = ash.indexOf("rasterfunktion");
        const aRoundRobinIdx = ash.indexOf("roundrobin");
        if (aIdIdx !== -1 && aRastIdx !== -1) {
          const artRow = bewbsValues.slice(1).find(
            (r) => String(r[aIdIdx] || "").trim() === bewbsId);
          if (artRow && artRow[aRastIdx]) {
            const parsed = parseInt(artRow[aRastIdx], 10);
            if (!isNaN(parsed) && parsed >= 2) r1CountConfigPlayers = parsed;
          }
          if (artRow && aRoundRobinIdx !== -1) {
            isRoundRobin = String(artRow[aRoundRobinIdx] || "0").trim() === "1";
          }
        }
      }
    }

    const heading = document.getElementById("bracketHeading");
    const info = document.getElementById("bracketInfo");

    function setHeading(text) {
      if (heading) heading.textContent = text;
    }
    setHeading("Turnierraster - " + (bewerbName || "Bewerb"));

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

    const preHeader = preValues[0] || [];
    const preData = preValues.slice(1);
    const matchHeader = matchValues[0] || [];
    const matchData = matchValues.slice(1);

    const rounds = buildRounds(preData, preHeader, matchData, matchHeader, playerMap, r1CountConfigPlayers);
    cachedRounds = rounds;
    cachedPlayerMap = playerMap;
    cachedR1Count = r1CountConfigPlayers;
    cachedBewerbName = bewerbName;

    if (rounds.length === 0) {
      if (container) container.innerHTML = "<p>Keine Rasterdaten für diesen Bewerb.</p>";
      return;
    }

    renderBracket(rounds);

    if (isRoundRobin && info) {
      info.innerHTML = "";
      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:12px;margin-bottom:16px;";

      const btnRaster = document.createElement("button");
      btnRaster.className = "btn-action";
      btnRaster.textContent = "Raster";
      btnRaster.addEventListener("click", () => {
        setHeading("Turnierraster - " + (bewerbName || "Bewerb"));
        container.innerHTML = "";
        renderBracket(rounds);
        startPolling();
      });

      const btnGruppe = document.createElement("button");
      btnGruppe.className = "btn-action";
      btnGruppe.textContent = "Gruppe";
      btnGruppe.addEventListener("click", async () => {
        stopPolling();
        setHeading("Round Robin - " + (bewerbName || "Bewerb"));
        try {
          const mod = await import("./RoundRobin.js?v=2");
          if (mod.renderRoundRobin) {
            container.innerHTML = "";
            mod.renderRoundRobin(BEWERB_ID, container, { r1CountConfigPlayers, bewerbName });
          }
        } catch (err) {
          console.error("RoundRobin Fehler:", err);
          container.innerHTML = "<p>Fehler beim Laden der Gruppen-Ansicht.</p>";
        }
      });

      btnRow.appendChild(btnRaster);
      btnRow.appendChild(btnGruppe);
      info.appendChild(btnRow);
    }

  } catch (err) {
    console.error("Fehler beim Laden des Turnierrasters:", err);
    if (container) container.innerHTML = `<p>Fehler: ${err.message}</p>`;
  }
}

let pollTimer = null;

async function refreshNames() {
  if (!cachedRounds) return;
  try {
    const [preRes, matchRes, playerRes] = await Promise.all([
      readPreMatches(), readMatchesList(), readPlayersList(),
    ]);
    const preValues = preRes.data?.values || [];
    const matchValues = matchRes.data?.values || [];
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

    const preHeader = preValues[0] || [];
    const preData = preValues.slice(1);
    const matchHeader = matchValues[0] || [];
    const matchData = matchValues.slice(1);

    const fresh = buildRounds(preData, preHeader, matchData, matchHeader, playerMap, cachedR1Count);
    if (fresh.length === 0) return;

    fresh.forEach((round, rIdx) => {
      round.matches.forEach((match, mIdx) => {
        const oldMatch = cachedRounds[rIdx]?.matches[mIdx];
        if (!oldMatch) return;
        [match.top, match.bottom].forEach((slot, sIdx) => {
          const oldSlot = sIdx === 0 ? oldMatch.top : oldMatch.bottom;
          const el = oldSlot._el;
          if (!el) return;
          const nameChanged = slot.name !== oldSlot.name;
          const preChanged = slot.pre !== oldSlot.pre;
          const specialChanged = slot.special !== oldSlot.special;
          if (!nameChanged && !preChanged && !specialChanged) return;

          oldSlot.name = slot.name;
          oldSlot.pre = slot.pre;
          oldSlot.id = slot.id;
          oldSlot.special = slot.special;

          if (slot.id) el.dataset.playerId = slot.id;

          if (match.result && slot.name) {
            const side = sIdx === 0 ? "left" : "right";
            const score = match.result.map((s) => side === "left" ? s.left : s.right).join(" | ");
            const hasRet = match.result.some((s) => s.special && (side === "left" ? s.retOnLeft : !s.retOnLeft));
            el.innerHTML = `<span class="pname">${slot.name}</span> <span class="pscore">${score}</span>${hasRet ? " " + badgeHtml("ret") : ""}`;
          } else {
            el.innerHTML = (slot.name || "—") + (slot.name ? " " + badgeHtml(slot.special) : "");
            el.classList.toggle("bye", !slot.name);
          }
          el.classList.toggle("blink-green", !!slot.pre);
        });
      });
    });
  } catch (err) {
    console.error("refreshNames Fehler:", err);
  }
}

function startPolling() {
  stopPolling();
  const poll = async () => {
    const c = document.getElementById("bracketContainer");
    if (c && c.innerHTML !== "" && cachedRounds) {
      await refreshNames();
    }
    pollTimer = setTimeout(poll, 2000);
  };
  pollTimer = setTimeout(poll, 2000);
}

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadBracket();
  startPolling();
});
