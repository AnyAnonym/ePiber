import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readMatchesList = httpsCallable(functions, "readMatchesList");
const readPreMatches = httpsCallable(functions, "readPreMatches");
const readPlayersList = httpsCallable(functions, "readPlayersList");
const readBewerbe = httpsCallable(functions, "readBewerbe");
const getScoreboardCourts = httpsCallable(functions, "getScoreboardCourts");

const COURT_URL = 'https://scorer-tennis.b-cdn.net/json/24.voll.json';
const COURT_POLL = 1000;
const MATCHES_POLL = 5000;
const SCOREBOARD_POLL = 1000;

let playerMap = new Map();
let bewerbMap = new Map();
let preMatchRasterMap = new Map();
let matchRasterMap = new Map();

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
    values.slice(1).forEach((r) => {
      const id = String(r[idIdx] || "").trim();
      const name = `${r[fnIdx] || ""} ${r[lnIdx] || ""}`.trim();
      if (id) map.set(id, name || id);
    });
    playerMap = map;
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

function parseSheetDate(raw) {
  if (!raw) return "";
  const m = String(raw).trim().match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return raw;
  const [, yy, mm, dd, hh, mi] = m;
  return `${dd}.${mm}. - ${hh}:${mi}`;
}

function dateToTs(raw) {
  if (!raw) return 0;
  const m = String(raw).trim().match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return 0;
  const [, yy, mm, dd, hh, mi] = m;
  const yyyy = parseInt(yy, 10) >= 50 ? 1900 + parseInt(yy) : 2000 + parseInt(yy);
  return new Date(yyyy, parseInt(mm) - 1, parseInt(dd), parseInt(hh), parseInt(mi)).getTime();
}

function parsePlayerId(raw) {
  const s = String(raw || "").trim();
  const wo = /\[w\.o\.\]/i.test(s);
  const ret = /\[ret\]/i.test(s);
  const cleanId = s.replace(/\[w\.o\.\]/gi, "").replace(/\[ret\]/gi, "").trim();
  const special = wo ? "wo" : ret ? "ret" : null;
  return { cleanId, special };
}

function badgeHtml(type) {
  if (type === "wo") return '<span class="badge badge-wo">w.o.</span>';
  if (type === "ret") return '<span class="badge badge-wo">ret.</span>';
  return "";
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

// Ermittelt Gewinner: 1 = Team1/Spieler1 gewinnt, 2 = Team2/Spieler3 gewinnt, 0 = unentschieden/unklar
function determineWinner(ergebnis) {
  if (!ergebnis) return 0;
  const sets = String(ergebnis).split("/").filter(Boolean);
  let wins1 = 0, wins2 = 0;
  sets.forEach((s) => {
    const clean = s.replace(/\(\d+\)/g, '').trim();
    const parts = clean.split("-").map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      if (parts[0] > parts[1]) wins1++;
      else if (parts[1] > parts[0]) wins2++;
    }
  });
  if (wins1 > wins2) return 1;
  if (wins2 > wins1) return 2;
  return 0;
}

function buildPlayersHtml(p1, p2, p3, p4, p1badge, p2badge, p3badge, p4badge, winner) {
  const cls1 = winner === 1 ? "ae-winner" : winner === 2 ? "ae-loser" : "";
  const cls2 = winner === 2 ? "ae-winner" : winner === 1 ? "ae-loser" : "";
  const isDouble = p2 || p4;
  if (isDouble) {
    return `<div class="ae-players">
      <div class="ae-team ${cls1}">${p1} ${p1badge}${p2 ? '<br>' + p2 + ' ' + p2badge : ''}</div>
      <div class="ae-separator">-</div>
      <div class="ae-team ${cls2}">${p3} ${p3badge}${p4 ? '<br>' + p4 + ' ' + p4badge : ''}</div>
    </div>`;
  }
  return `<div class="ae-players">
    <span><span class="${cls1}">${p1} ${p1badge}</span> - <span class="${cls2}">${p3} ${p3badge}</span></span>
  </div>`;
}

function renderMatches(values) {
  const el = document.getElementById('letzte');
  if (!el) return;

  const header = values[0].map((h) => h.trim().toLowerCase());
  const idx = (label) => header.indexOf(label);
  const i1 = idx("spielerid1");
  const i3 = idx("spielerid3");
  const i2 = idx("spielerid2");
  const i4 = idx("spielerid4");
  const ergebnisIdx = idx("ergebnis");
  const d = idx("zeitpunkt");
  const bewerbIdIdx = idx("bewerbid");
  const rasterIdx = idx("rasterpaarung");

  const all = values.slice(1)
    .filter((row) => row && row[i1] && !/^BYE$/i.test(String(row[i1])) && !/^BYE$/i.test(String(row[i3])))
    .sort((a, b) => dateToTs(b[d]) - dateToTs(a[d]))
    .slice(0, 6);

  const titleHtml = '<div class="archived-title">Letzte Spiele</div>';
  if (all.length === 0) {
    el.innerHTML = titleHtml + '<div class="archived-empty">–</div>';
    return;
  }

  const lines = all.map((row) => {
    const pid1 = parsePlayerId(row[i1]);
    const pid3 = parsePlayerId(row[i3]);
    const pid2 = parsePlayerId(row[i2]);
    const pid4 = parsePlayerId(row[i4]);
    const p1 = playerMap.get(pid1.cleanId) || pid1.cleanId;
    const p3 = playerMap.get(pid3.cleanId) || pid3.cleanId;
    const p2 = pid2.cleanId ? (playerMap.get(pid2.cleanId) || pid2.cleanId) : "";
    const p4 = pid4.cleanId ? (playerMap.get(pid4.cleanId) || pid4.cleanId) : "";

    const datum = parseSheetDate(row[d]);
    const bewerbId = bewerbIdIdx !== -1 ? String(row[bewerbIdIdx] || "").trim() : "";
    const bewerbName = bewerbMap.get(bewerbId) || "";
    const runde = rasterIdx !== -1 ? parseRunde(row[rasterIdx]) : "";
    const headerParts = [datum, bewerbName, runde].filter(Boolean);
    const hdr = headerParts.join(" | ");

    const ergebnis = String(row[ergebnisIdx] || "").replace(/\((\d+)\)/g, '').trim();
    const winner = determineWinner(row[ergebnisIdx]);
    const playersHtml = buildPlayersHtml(p1, p2, p3, p4, badgeHtml(pid1.special), badgeHtml(pid2.special), badgeHtml(pid3.special), badgeHtml(pid4.special), winner);

    return `<div class="archived-entry">
      <div class="ae-header">${hdr}</div>
      <div class="ae-content">
        ${playersHtml}
        <div class="ae-result">${ergebnis || "—"}</div>
      </div>
    </div>`;
  });

  el.innerHTML = titleHtml + lines.join("");
}

function renderPreMatches(values) {
  const el = document.getElementById('nächste');
  if (!el) return;

  const header = values[0].map((h) => h.trim().toLowerCase());
  const idx = (label) => header.indexOf(label);
  const i1 = idx("spielerid1");
  const i3 = idx("spielerid3");
  const i2 = idx("spielerid2");
  const i4 = idx("spielerid4");
  const d = idx("zeitpunktmatch");
  const bewerbIdIdx = idx("bewerbid");
  const rasterIdx = idx("rasterpaarung");

  const all = values.slice(1)
    .filter((row) => row && row[i1] && !/^BYE$/i.test(String(row[i1])) && !/^BYE$/i.test(String(row[i3])))
    .map((row) => ({ row, ts: dateToTs(row[d]) }))
    .sort((a, b) => {
      if (a.ts && b.ts) return a.ts - b.ts;
      return a.ts ? -1 : b.ts ? 1 : 0;
    })
    .slice(0, 6);

  const titleHtml = '<div class="archived-title">Nächste Spiele</div>';
  if (all.length === 0) {
    el.innerHTML = titleHtml + '<div class="archived-empty">–</div>';
    return;
  }

  const lines = all.map(({ row }) => {
    const pid1 = parsePlayerId(row[i1]);
    const pid3 = parsePlayerId(row[i3]);
    const pid2 = parsePlayerId(row[i2]);
    const pid4 = parsePlayerId(row[i4]);
    const p1 = playerMap.get(pid1.cleanId) || pid1.cleanId;
    const p3 = playerMap.get(pid3.cleanId) || pid3.cleanId;
    const p2 = pid2.cleanId ? (playerMap.get(pid2.cleanId) || pid2.cleanId) : "";
    const p4 = pid4.cleanId ? (playerMap.get(pid4.cleanId) || pid4.cleanId) : "";

    const datum = parseSheetDate(row[d]);
    const bewerbId = bewerbIdIdx !== -1 ? String(row[bewerbIdIdx] || "").trim() : "";
    const bewerbName = bewerbMap.get(bewerbId) || "";
    const runde = rasterIdx !== -1 ? parseRunde(row[rasterIdx]) : "";
    const headerParts = [datum, bewerbName, runde].filter(Boolean);
    const hdr = headerParts.join(" | ");

    const playersHtml = buildPlayersHtml(p1, p2, p3, p4, badgeHtml(pid1.special), badgeHtml(pid2.special), badgeHtml(pid3.special), badgeHtml(pid4.special), 0);

    return `<div class="pre-entry">
      <div class="ae-header">${hdr}</div>
      <div class="ae-content">
        ${playersHtml}
      </div>
    </div>`;
  });

  el.innerHTML = titleHtml + lines.join("");
}

async function pollMatches() {
  try {
    const res = await readMatchesList();
    const { success, values } = res.data;
    if (success && Array.isArray(values) && values.length >= 2) {
      buildRasterMap(values, matchRasterMap, "id", "rasterpaarung");
      renderMatches(values);
    }
  } catch (err) {
    // silent
  }
  setTimeout(pollMatches, MATCHES_POLL);
}

async function pollPreMatches() {
  try {
    const res = await readPreMatches();
    const { success, values } = res.data;
    if (success && Array.isArray(values) && values.length >= 2) {
      buildRasterMap(values, preMatchRasterMap, "id", "rasterpaarung");
      renderPreMatches(values);
    }
  } catch (err) {
    // silent
  }
  setTimeout(pollPreMatches, MATCHES_POLL);
}

function buildRasterMap(values, targetMap, idCol, rasterCol) {
  const header = values[0].map((h) => h.trim().toLowerCase());
  const idIdx = header.indexOf(idCol);
  const rIdx = header.indexOf(rasterCol);
  if (idIdx === -1 || rIdx === -1) return;
  targetMap.clear();
  values.slice(1).forEach((row) => {
    const id = String(row[idIdx] || "").trim();
    const raster = String(row[rIdx] || "").trim();
    if (id && raster) targetMap.set(id, raster);
  });
}

// ── Court data (JSON – nur Sätze/Punkte, gesteuert durch aktiv-Status) ──

let courtActive = { "1": false, "2": false };
let courtPollingRunning = false;

function updateCourt(court) {
  const p = court.platz;
  if (p !== '1' && p !== '2') return;
  if (!courtActive[p]) return;
  const prefix = 'p' + p;
  setText(prefix + '-h-s1', court.satz1home);
  setText(prefix + '-h-s2', court.satz2home);
  setText(prefix + '-h-s3', court.satz3home);
  setText(prefix + '-h-p',  court.punktehome);
  setText(prefix + '-g-s1', court.satz1gast);
  setText(prefix + '-g-s2', court.satz2gast);
  setText(prefix + '-g-s3', court.satz3gast);
  setText(prefix + '-g-p',  court.punktegast);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || '-';
}

async function pollCourt() {
  try {
    const res = await fetch(COURT_URL, { cache: 'no-store' });
    const data = await res.json();
    if (data && Array.isArray(data.courts)) {
      data.courts.forEach(updateCourt);
    }
  } catch (err) {
    // silent
  }
  // Nur weiter pollen wenn mindestens ein Platz aktiv ist
  if (courtActive["1"] || courtActive["2"]) {
    courtPollingRunning = true;
    setTimeout(pollCourt, COURT_POLL);
  } else {
    courtPollingRunning = false;
  }
}

function startCourtPollingIfNeeded() {
  if (!courtPollingRunning && (courtActive["1"] || courtActive["2"])) {
    courtPollingRunning = true;
    pollCourt();
  }
}

// ── Scoreboard state (Spielernamen + Bewerb + aktiv-Status aus Firestore) ──
// Wird IMMER gepollt, unabhängig vom aktiv-Status

function updateScoreboardCourt(courtKey, courtData) {
  if (courtKey !== '1' && courtKey !== '2') return;
  const prefix = 'p' + courtKey;
  setText(prefix + '-name-h', courtData.homePlayer);
  setText(prefix + '-name-g', courtData.guestPlayer);
  setText(prefix + '-datetime', courtData.dateTime);

  // Bewerb + Runde zusammensetzen
  // Runde aus Firestore, oder per matchId aus preMatch/Match-Daten nachschlagen
  let runde = courtData.runde || "";
  if (!runde && courtData.matchId) {
    const rasterRaw = preMatchRasterMap.get(courtData.matchId) || matchRasterMap.get(courtData.matchId) || "";
    runde = parseRunde(rasterRaw);
  }
  const bewerbParts = [courtData.bewerb, runde].filter(Boolean);
  setText(prefix + '-bewerb', bewerbParts.join(" | "));

  // Aktiv-Status setzen und Header einfärben
  const isActive = courtData.aktiv === 1;
  courtActive[courtKey] = isActive;

  const headerEl = document.querySelector(`#platz${courtKey} .platz-header`);
  if (headerEl) {
    headerEl.classList.remove("court-active", "court-inactive");
    headerEl.classList.add(isActive ? "court-active" : "court-inactive");
  }
}

async function pollScoreboard() {
  try {
    const res = await getScoreboardCourts();
    const { success, courts } = res.data;
    if (success && courts) {
      Object.keys(courts).forEach((key) => {
        updateScoreboardCourt(key, courts[key]);
      });
    }
  } catch (err) {
    // silent
  }
  // Court-Polling starten/stoppen basierend auf aktiv-Status
  startCourtPollingIfNeeded();
  setTimeout(pollScoreboard, SCOREBOARD_POLL);
}

// ── Init ──

await loadPlayers();
await loadBewerbe();

// Erster Durchlauf: Scoreboard + Court immer initial laden (für Layout),
// danach steuert aktiv-Status ob Court weiter pollt
await Promise.all([pollScoreboard(), pollCourt(), pollMatches(), pollPreMatches()]);

const loader = document.getElementById("scoreboard-loader");
const content = document.getElementById("scoreboard-content");
if (content) content.classList.add("loaded");
if (loader) loader.classList.add("hidden");
setTimeout(() => { if (loader) loader.remove(); }, 500);
