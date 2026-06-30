import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readMatchesList = httpsCallable(functions, "readMatchesList");
const readPreMatches = httpsCallable(functions, "readPreMatches");
const readPlayersList = httpsCallable(functions, "readPlayersList");
const readBewerbe = httpsCallable(functions, "readBewerbe");

const COURT_URL = 'https://scorer-tennis.b-cdn.net/json/24.voll.json';
const COURT_POLL = 2000;
const MATCHES_POLL = 5000;

let playerMap = new Map();
let bewerbMap = new Map();

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
      const id = r[idIdx];
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

  const all = values.slice(1)
    .filter((row) => row && row[i1] && !/^BYE$/i.test(String(row[i1])) && !/^BYE$/i.test(String(row[i3])))
    .sort((a, b) => dateToTs(b[d]) - dateToTs(a[d]))
    .slice(0, 4);

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
    const p2raw = pid2.cleanId ? " (& " + (playerMap.get(pid2.cleanId) || pid2.cleanId) + ")" : "";
    const p4raw = pid4.cleanId ? " (& " + (playerMap.get(pid4.cleanId) || pid4.cleanId) + ")" : "";
    const p1badge = badgeHtml(pid1.special);
    const p3badge = badgeHtml(pid3.special);
    const p2badge = badgeHtml(pid2.special);
    const p4badge = badgeHtml(pid4.special);

    const datum = parseSheetDate(row[d]);
    const bewerbId = bewerbIdIdx !== -1 ? String(row[bewerbIdIdx] || "").trim() : "";
    const bewerbName = bewerbMap.get(bewerbId) || "";
    const header = datum + (bewerbName ? " — " + bewerbName : "");

    const sets = String(row[ergebnisIdx] || "").split("/").filter(Boolean);
    const s1 = sets[0] ? sets[0].replace(/\((\d+)\)/g, '') : "—";
    const s2 = sets[1] ? sets[1].replace(/\((\d+)\)/g, '') : "—";
    const s3 = sets[2] ? sets[2].replace(/\((\d+)\)/g, '') : "—";

    return `<div class="archived-entry">
      <div class="ae-header">${header}</div>
      <span class="ae-t1">${p1} ${p1badge}${p2raw} ${p2badge}</span>
      <span class="ae-vs">vs.</span>
      <span class="ae-t2">${p3} ${p3badge}${p4raw} ${p4badge}</span>
      <span class="ae-s1">${s1}</span>
      <span class="ae-s2">${s2}</span>
      <span class="ae-s3">${s3}</span>
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

  const all = values.slice(1)
    .filter((row) => row && row[i1] && !/^BYE$/i.test(String(row[i1])) && !/^BYE$/i.test(String(row[i3])))
    .map((row) => ({ row, ts: dateToTs(row[d]) }))
    .sort((a, b) => {
      const aFut = a.ts > Date.now();
      const bFut = b.ts > Date.now();
      if (aFut !== bFut) return aFut ? -1 : 1;
      if (a.ts && b.ts) return a.ts - b.ts;
      return a.ts ? -1 : b.ts ? 1 : 0;
    })
    .slice(0, 4);

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
    const p2raw = pid2.cleanId ? " (& " + (playerMap.get(pid2.cleanId) || pid2.cleanId) + ")" : "";
    const p4raw = pid4.cleanId ? " (& " + (playerMap.get(pid4.cleanId) || pid4.cleanId) + ")" : "";
    const p1badge = badgeHtml(pid1.special);
    const p3badge = badgeHtml(pid3.special);
    const p2badge = badgeHtml(pid2.special);
    const p4badge = badgeHtml(pid4.special);

    const datum = parseSheetDate(row[d]);
    const bewerbId = bewerbIdIdx !== -1 ? String(row[bewerbIdIdx] || "").trim() : "";
    const bewerbName = bewerbMap.get(bewerbId) || "";
    const hdr = datum + (bewerbName ? " — " + bewerbName : "");

    return `<div class="pre-entry">
      <div class="ae-header">${hdr}</div>
      <span class="ae-t1">${p1} ${p1badge}${p2raw} ${p2badge}</span>
      <span class="ae-vs">vs.</span>
      <span class="ae-t2">${p3} ${p3badge}${p4raw} ${p4badge}</span>
    </div>`;
  });

  el.innerHTML = titleHtml + lines.join("");
}

async function pollMatches() {
  try {
    const res = await readMatchesList();
    const { success, values } = res.data;
    if (success && Array.isArray(values) && values.length >= 2) {
      renderMatches(values);
    }
  } catch (err) {
    // silent
  }
}

async function pollPreMatches() {
  try {
    const res = await readPreMatches();
    const { success, values } = res.data;
    if (success && Array.isArray(values) && values.length >= 2) {
      renderPreMatches(values);
    }
  } catch (err) {
    // silent
  }
}

// ── Court data (JSON) ──

function updateCourt(court) {
  const p = court.platz;
  if (p !== '1' && p !== '2') return;
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
  setTimeout(pollCourt, COURT_POLL);
}

// ── Init ──

await loadPlayers();
await loadBewerbe();
pollCourt();
pollMatches();
pollPreMatches();
setInterval(pollMatches, MATCHES_POLL);
setInterval(pollPreMatches, MATCHES_POLL);
