import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readPreMatches  = httpsCallable(functions, "readPreMatches");
const readMatchesList = httpsCallable(functions, "readMatchesList");
const readPlayersList = httpsCallable(functions, "readPlayersList");
const readBewerbe     = httpsCallable(functions, "readBewerbe");
const readBewerbsart  = httpsCallable(functions, "readBewerbsart");

// ── Hilfsfunktionen ──

function parseGroup(val) {
  if (!val) return null;
  const s = String(val).trim().toUpperCase();
  const m = s.match(/^G(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parsePlayerId(raw) {
  return String(raw || "").trim().replace(/\[w\.o\.\]/gi, "").replace(/\[ret\]/gi, "").trim();
}

function parseSpezifikum(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\((\d+)\|(\d+)\)/);
  if (!m) return null;
  return { from: parseInt(m[1], 10), to: parseInt(m[2], 10) };
}

function parseResult(val) {
  if (!val) return null;
  const parts = String(val).trim().split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const sets = [];
  for (const p of parts) {
    if (/\[ret\]/i.test(p)) continue;
    const sc = p.replace(/\(\d+\)/g, "").split("-");
    if (sc.length !== 2) continue;
    const a = parseInt(sc[0], 10);
    const b = parseInt(sc[1], 10);
    if (isNaN(a) || isNaN(b)) continue;
    sets.push({ left: a, right: b });
  }
  return sets.length > 0 ? sets : null;
}

function formatPlayerName(id, playerMap) {
  return playerMap.get(id) || "—";
}

function formatTeamName(pid1, pid2, playerMap) {
  const n1 = formatPlayerName(pid1, playerMap);
  if (!pid2) return `<span class="rr-player">${n1}</span>`;
  const n2 = formatPlayerName(pid2, playerMap);
  return `<span class="rr-player">${n1}</span><span class="rr-team-sep"> / </span><span class="rr-player">${n2}</span>`;
}

function parseSheetDate(raw) {
  if (!raw) return "";
  const m = String(raw).trim().match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return String(raw).trim();
  const [, , mm, dd, hh, mi] = m;
  return `${dd}.${mm}. - ${hh}:${mi}`;
}

function dateToTs(raw) {
  if (!raw) return Infinity;
  const m = String(raw).trim().match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return Infinity;
  const [, yy, mm, dd, hh, mi] = m;
  const yyyy = parseInt(yy, 10) >= 50 ? 1900 + parseInt(yy) : 2000 + parseInt(yy);
  return new Date(yyyy, parseInt(mm) - 1, parseInt(dd), parseInt(hh), parseInt(mi)).getTime();
}

// Paarungslayout:
// 0 = Datum + Uhrzeit (alle)
// 1 = nur Uhrzeit (alle)
// 2 = ohne Datum/Uhrzeit (alle)
// 3 = gespielte: Datum + Uhrzeit, offene: immer Datum + Uhrzeit
// 4 = gespielte: nur Uhrzeit, offene: immer Datum + Uhrzeit
// 5 = gespielte: ohne Datum/Uhrzeit, offene: immer Datum + Uhrzeit
function formatPairingDate(datumRaw, played, paarungslayout) {
  const pl = parseInt(paarungslayout) || 0;

  if (!datumRaw) return "";
  const m = String(datumRaw).trim().match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return "";
  const [, , mm, dd, hh, mi] = m;
  const fullDate = `${dd}.${mm}. - ${hh}:${mi}`;
  const timeOnly = `${hh}:${mi}`;

  // Offene Spiele: bei 3/4/5 immer Datum + Uhrzeit
  if (!played && pl >= 3 && pl <= 5) return fullDate;

  if (pl === 2 || pl === 5) return "";
  if (pl === 1 || pl === 4) return timeOnly;
  return fullDate;
}

// ── Spieler aus preMatches und matches sammeln (inkl. Doppel) ──

function collectPlayers(data, header, bewerbId) {
  const h = header.map((c) => String(c).trim().toLowerCase());
  const bwIdx = h.indexOf("bewerbid");
  const rtIdx = h.indexOf("rasterpaarung");
  const p1Idx = h.indexOf("spielerid1");
  const p2Idx = h.indexOf("spielerid2");
  const p3Idx = h.indexOf("spielerid3");
  const p4Idx = h.indexOf("spielerid4");

  const entries = [];
  data.forEach((row) => {
    if (bwIdx >= 0 && String(row[bwIdx] || "").trim() !== String(bewerbId).trim()) return;
    const g = parseGroup(rtIdx >= 0 ? String(row[rtIdx] || "").trim() : "");
    if (g === null) return;

    const id1 = parsePlayerId(row[p1Idx]);
    const id2 = p2Idx >= 0 ? parsePlayerId(row[p2Idx]) : "";
    const id3 = p3Idx >= 0 ? parsePlayerId(row[p3Idx]) : "";
    const id4 = p4Idx >= 0 ? parsePlayerId(row[p4Idx]) : "";

    // Team-Key: für Doppel "id1+id2", für Einzel nur "id1"
    if (id1) entries.push({ group: g, id: id1, partnerId: id2 });
    if (id3) entries.push({ group: g, id: id3, partnerId: id4 });
  });
  return entries;
}

// ── Statistik aus gespielten Matches ──

function buildStats(matchData, matchHeader, bewerbId) {
  const h = matchHeader.map((c) => String(c).trim().toLowerCase());
  const bwIdx = h.indexOf("bewerbid");
  const p1Idx = h.indexOf("spielerid1");
  const p2Idx = h.indexOf("spielerid2");
  const p3Idx = h.indexOf("spielerid3");
  const p4Idx = h.indexOf("spielerid4");
  const gwIdx = h.indexOf("gewinner");
  const ergebnisIdx = h.indexOf("ergebnis");

  const stats = {};
  const playerMatches = {};

  matchData.forEach((row) => {
    if (bwIdx >= 0 && String(row[bwIdx] || "").trim() !== String(bewerbId).trim()) return;

    const id1 = parsePlayerId(row[p1Idx]);
    const id2 = p2Idx >= 0 ? parsePlayerId(row[p2Idx]) : "";
    const id3 = p3Idx >= 0 ? parsePlayerId(row[p3Idx]) : "";
    const id4 = p4Idx >= 0 ? parsePlayerId(row[p4Idx]) : "";
    const winner = gwIdx !== -1 ? String(row[gwIdx] || "").trim() : "";
    const rawResult = ergebnisIdx !== -1 ? String(row[ergebnisIdx] || "").trim() : "";
    const sets = parseResult(rawResult);

    // Für Einzel: key = id1/id3; für Doppel: key = id1 (Hauptspieler)
    const teams = [
      { key: id1, partner: id2, oppKey: id3, oppPartner: id4, side: 0 },
      { key: id3, partner: id4, oppKey: id1, oppPartner: id2, side: 1 },
    ];

    teams.forEach(({ key, oppKey, oppPartner, side }) => {
      if (!key) return;
      if (!stats[key]) stats[key] = { siege: 0, saetzeW: 0, saetzeL: 0, gamesW: 0, gamesL: 0 };
      if (winner === key) stats[key].siege++;
      if (sets) {
        sets.forEach((s) => {
          const mine = side === 0 ? s.left : s.right;
          const opp = side === 0 ? s.right : s.left;
          stats[key].gamesW += mine;
          stats[key].gamesL += opp;
          if (mine > opp) stats[key].saetzeW++;
          else stats[key].saetzeL++;
        });
      }
      if (oppKey) {
        if (!playerMatches[key]) playerMatches[key] = [];
        playerMatches[key].push({ opponent: oppKey, oppPartner, result: rawResult || "—" });
      }
    });
  });

  return { stats, playerMatches };
}

// ── Paarungen sammeln (offen + gespielt) ──

function collectPairings(preData, preHeader, matchData, matchHeader, bewerbId, playerMap) {
  const pairings = [];

  function extract(data, header, isPlayed) {
    const h = header.map((c) => String(c).trim().toLowerCase());
    const bwIdx = h.indexOf("bewerbid");
    const rtIdx = h.indexOf("rasterpaarung");
    const p1Idx = h.indexOf("spielerid1");
    const p2Idx = h.indexOf("spielerid2");
    const p3Idx = h.indexOf("spielerid3");
    const p4Idx = h.indexOf("spielerid4");
    const erIdx = h.indexOf("ergebnis");
    const gwIdx = h.indexOf("gewinner");
    const dIdx = h.indexOf(isPlayed ? "zeitpunkt" : "zeitpunktmatch");

    data.forEach((row) => {
      if (bwIdx >= 0 && String(row[bwIdx] || "").trim() !== String(bewerbId).trim()) return;
      const g = parseGroup(rtIdx >= 0 ? String(row[rtIdx] || "").trim() : "");
      if (g === null) return;

      const id1 = parsePlayerId(row[p1Idx]);
      const id2 = p2Idx >= 0 ? parsePlayerId(row[p2Idx]) : "";
      const id3 = p3Idx >= 0 ? parsePlayerId(row[p3Idx]) : "";
      const id4 = p4Idx >= 0 ? parsePlayerId(row[p4Idx]) : "";
      const ergebnis = erIdx >= 0 ? String(row[erIdx] || "").trim() : "";
      const datum = dIdx >= 0 ? String(row[dIdx] || "").trim() : "";
      const winnerId = gwIdx >= 0 ? String(row[gwIdx] || "").trim() : "";

      const team1 = formatTeamName(id1, id2, playerMap);
      const team2 = formatTeamName(id3, id4, playerMap);

      // winner: 1 = Team1 gewinnt, 2 = Team2 gewinnt, 0 = kein Gewinner
      let winner = 0;
      if (winnerId === id1) winner = 1;
      else if (winnerId === id3) winner = 2;

      pairings.push({
        group: g,
        team1,
        team2,
        ergebnis: ergebnis || (isPlayed ? "—" : ""),
        played: isPlayed && !!ergebnis,
        datumRaw: datum,
        datum: parseSheetDate(datum),
        datumTs: dateToTs(datum),
        winner,
      });
    });
  }

  extract(preData, preHeader, false);
  extract(matchData, matchHeader, true);

  return pairings;
}

// ── Render ──

export async function renderRoundRobin(bewerbId, container, paarungslayout) {
  container.innerHTML = "<p class='loading-text'>Lade Gruppen...</p>";

  try {
    const [preRes, matchRes, playerRes, bewerbRes, bewerbsartRes] = await Promise.all([
      readPreMatches(),
      readMatchesList(),
      readPlayersList(),
      readBewerbe(),
      readBewerbsart(),
    ]);

    const preValues = preRes.data?.values || [];
    const matchValues = matchRes.data?.values || [];
    const playerValues = playerRes.data?.values || [];
    const bewerbValues = bewerbRes.data?.values || [];
    const bewerbsartValues = bewerbsartRes.data?.values || [];

    // Spieler-Map
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

    // Spezifikum aus Bewerbsart ermitteln
    let highlightRange = null;
    if (bewerbValues.length > 1 && bewerbsartValues.length > 1) {
      const bh = bewerbValues[0].map((h) => h.trim().toLowerCase());
      const bIdIdx = bh.indexOf("id");
      const bBaIdx = bh.indexOf("bewerbsartid");
      const bewerbRow = bewerbValues.slice(1).find((r) => String(r[bIdIdx] || "").trim() === String(bewerbId).trim());
      if (bewerbRow) {
        const baId = String(bewerbRow[bBaIdx] || "").trim();
        const ash = bewerbsartValues[0].map((h) => h.trim().toLowerCase());
        const aIdIdx = ash.indexOf("id");
        const aSpezIdx = ash.indexOf("spezifikum");
        if (aSpezIdx >= 0) {
          const baRow = bewerbsartValues.slice(1).find((r) => String(r[aIdIdx] || "").trim() === baId);
          if (baRow) highlightRange = parseSpezifikum(baRow[aSpezIdx]);
        }
      }
    }

    const preHeader = preValues[0] || [];
    const matchHeader = matchValues[0] || [];

    // Spieler sammeln (inkl. Doppelpartner)
    const all = [
      ...collectPlayers(preValues.slice(1), preHeader, bewerbId),
      ...collectPlayers(matchValues.slice(1), matchHeader, bewerbId),
    ];

    // Deduplizieren — key = Hauptspieler-ID pro Gruppe
    const seen = new Set();
    const unique = [];
    all.forEach((e) => {
      const key = e.group + ":" + e.id;
      if (!seen.has(key)) { seen.add(key); unique.push(e); }
    });

    // Partner-Map: Hauptspieler → Partner
    const partnerMap = new Map();
    all.forEach((e) => {
      if (e.partnerId) partnerMap.set(e.id, e.partnerId);
    });

    // Gruppen
    const groups = new Map();
    unique.forEach((e) => {
      if (!groups.has(e.group)) groups.set(e.group, []);
      groups.get(e.group).push(e.id);
    });

    const sortedGroups = [...groups.entries()].sort((a, b) => a[0] - b[0]);

    if (sortedGroups.length === 0) {
      container.innerHTML = "<p>Keine Gruppen für diesen Bewerb gefunden.</p>";
      return;
    }

    // Statistik
    const { stats, playerMatches } = buildStats(matchValues.slice(1), matchHeader, bewerbId);

    // Paarungen
    const pairings = collectPairings(
      preValues.slice(1), preHeader,
      matchValues.slice(1), matchHeader,
      bewerbId, playerMap,
    );

    // ── HTML: Gruppentabellen ──
    let html = '<div class="rr-groups">';

    sortedGroups.forEach(([gNum, ids]) => {
      const rows = ids.map((id) => {
        const s = stats[id] || { siege: 0, saetzeW: 0, saetzeL: 0, gamesW: 0, gamesL: 0 };
        const matches = playerMatches[id] || [];
        const partner = partnerMap.get(id) || "";
        return { id, partner, ...s, matches };
      });

      rows.sort((a, b) => {
        if (b.siege !== a.siege) return b.siege - a.siege;
        const diffA = a.saetzeW - a.saetzeL;
        const diffB = b.saetzeW - b.saetzeL;
        if (diffB !== diffA) return diffB - diffA;
        return (b.gamesW - b.gamesL) - (a.gamesW - a.gamesL);
      });

      html += `<div class="rr-group-card">`;
      html += `<div class="rr-group-title">Gruppe ${gNum}</div>`;
      html += `<table class="rr-table">`;
      html += `<thead><tr>`;
      html += `<th>Rang</th><th class="rr-name-col">Name</th><th>Spiele</th><th>Siege</th>`;
      html += `<th>Sätze<br><span class="rr-sub">W-L</span></th>`;
      html += `<th>Games<br><span class="rr-sub">W-L</span></th>`;
      html += `</tr></thead><tbody>`;

      rows.forEach((r, idx) => {
        const rang = idx + 1;
        const isHighlighted = highlightRange && rang >= highlightRange.from && rang <= highlightRange.to;
        const cls = isHighlighted ? ' class="rr-highlight"' : "";
        const teamName = formatTeamName(r.id, r.partner, playerMap);
        html += `<tr${cls}>`;
        html += `<td class="rr-center">${rang}</td>`;
        html += `<td>${teamName}</td>`;
        html += `<td class="rr-center">${r.matches.length}</td>`;
        html += `<td class="rr-center">${r.siege}</td>`;
        html += `<td class="rr-center">${r.saetzeW}-${r.saetzeL}</td>`;
        html += `<td class="rr-center">${r.gamesW}-${r.gamesL}</td>`;
        html += `</tr>`;
      });

      html += `</tbody></table>`;

      // Paarungen dieser Gruppe, sortiert nach Datum (nächstes zuerst)
      const groupPairings = pairings
        .filter((p) => p.group === gNum)
        .sort((a, b) => a.datumTs - b.datumTs);
      if (groupPairings.length > 0) {
        html += `<div class="rr-pairings-title">Paarungen</div>`;
        html += `<div class="rr-pairings">`;
        groupPairings.forEach((p) => {
          const cls = p.played ? "rr-pairing played" : "rr-pairing open";
          const t1cls = p.winner === 1 ? "rr-pairing-winner" : p.winner === 2 ? "rr-pairing-loser" : "";
          const t2cls = p.winner === 2 ? "rr-pairing-winner" : p.winner === 1 ? "rr-pairing-loser" : "";
          const datumDisplay = formatPairingDate(p.datumRaw, p.played, paarungslayout);
          html += `<div class="${cls}">`;
          if (datumDisplay) html += `<span class="rr-pairing-date">${datumDisplay}</span>`;
          html += `<span class="rr-pairing-teams"><span class="${t1cls}">${p.team1}</span> <span class="rr-pairing-sep">-</span> <span class="${t2cls}">${p.team2}</span></span>`;
          if (p.ergebnis) html += `<span class="rr-pairing-result">${p.ergebnis}</span>`;
          html += `</div>`;
        });
        html += `</div>`;
      }

      html += `</div>`;
    });

    html += "</div>";
    container.innerHTML = html;
  } catch (err) {
    console.error("RoundRobin Fehler:", err);
    container.innerHTML = "<p>Fehler beim Laden der Gruppen.</p>";
  }
}

// ── Seiten-Init ──

async function loadBewerbName(bewerbId) {
  const heading = document.getElementById("roundRobinHeading");
  if (!heading || !bewerbId) return;
  try {
    const res = await readBewerbe();
    const values = res.data?.values || [];
    if (values.length < 2) return;
    const bHeader = values[0].map((h) => h.trim().toLowerCase());
    const bIdIdx = bHeader.indexOf("id");
    const bBezIdx = bHeader.indexOf("bezeichnung");
    const row = values.slice(1).find((r) => String(r[bIdIdx] || "").trim() === String(bewerbId).trim());
    if (row && row[bBezIdx]) {
      heading.textContent = row[bBezIdx];
    }
  } catch (err) {
    // silent
  }
}

const params = new URLSearchParams(window.location.search);
const BEWERB_ID = params.get("id");
const PAARUNGSLAYOUT = params.get("paarungslayout") || "0";

if (BEWERB_ID) {
  const container = document.getElementById("roundRobinContainer");
  if (container) {
    loadBewerbName(BEWERB_ID);
    renderRoundRobin(BEWERB_ID, container, PAARUNGSLAYOUT);
  }
} else {
  const container = document.getElementById("roundRobinContainer");
  if (container) container.innerHTML = "<p>Keine Bewerb-ID angegeben.</p>";
}
