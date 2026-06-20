import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readPreMatches  = httpsCallable(functions, "readPreMatches");
const readMatchesList = httpsCallable(functions, "readMatchesList");
const readPlayersList = httpsCallable(functions, "readPlayersList");

function parseGroup(val) {
  if (!val) return null;
  const s = String(val).trim().toUpperCase();
  if (!s) return null;
  const m = s.match(/^G(\d+)/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function parsePlayerId(raw) {
  const s = String(raw || "").trim();
  const cleanId = s.replace(/\[w\.o\.\]/gi, "").trim();
  return cleanId;
}

function collectPlayers(data, header, bewerbId) {
  const h = header.map((c) => String(c).trim().toLowerCase());
  const bwIdx = h.indexOf("bewerbid");
  const rtIdx = h.indexOf("rasterpaarung");
  const p1Idx = h.indexOf("spielerid1");
  const p3Idx = h.indexOf("spielerid3");

  const ids = [];
  data.forEach((row) => {
    if (bwIdx >= 0 && String(row[bwIdx] || "").trim() !== String(bewerbId).trim()) return;
    const g = parseGroup(rtIdx >= 0 ? String(row[rtIdx] || "").trim() : "");
    if (g === null) return;
    const p1 = parsePlayerId(row[p1Idx]);
    const p3 = p3Idx !== -1 ? parsePlayerId(row[p3Idx]) : "";
    if (p1) ids.push({ group: g, id: p1 });
    if (p3) ids.push({ group: g, id: p3 });
  });
  return ids;
}

function parseResult(val) {
  if (!val) return null;
  const parts = String(val).trim().split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const sets = [];
  for (const p of parts) {
    if (/\[ret\]/.test(p)) continue;
    const sc = p.split("-");
    if (sc.length !== 2) return null;
    const a = parseInt(sc[0], 10);
    const b = parseInt(sc[1], 10);
    if (isNaN(a) || isNaN(b)) return null;
    sets.push({ left: a, right: b });
  }
  if (sets.length === 0) return null;
  return sets;
}

function buildStats(matchData, matchHeader, bewerbId) {
  const h = matchHeader.map((c) => String(c).trim().toLowerCase());
  const bwIdx = h.indexOf("bewerbid");
  const p1Idx = h.indexOf("spielerid1");
  const p3Idx = h.indexOf("spielerid3");
  const gwIdx = h.indexOf("gewinner");
  const ergebnisIdx = h.indexOf("ergebnis");

  const stats = {};

  matchData.forEach((row) => {
    if (bwIdx >= 0 && String(row[bwIdx] || "").trim() !== String(bewerbId).trim()) return;
    const p1 = parsePlayerId(row[p1Idx]);
    const p3 = p3Idx !== -1 ? parsePlayerId(row[p3Idx]) : "";
    const winner = gwIdx !== -1 ? String(row[gwIdx] || "").trim() : "";
    const rawResult = ergebnisIdx !== -1 ? String(row[ergebnisIdx] || "").trim() : "";
    const sets = parseResult(rawResult);

    [p1, p3].forEach((pid, idx) => {
      if (!pid) return;
      if (!stats[pid]) stats[pid] = { siege: 0, saetzeW: 0, saetzeL: 0, gamesW: 0, gamesL: 0 };
      if (winner === pid) stats[pid].siege++;
      if (sets) {
        sets.forEach((s) => {
          const mine = idx === 0 ? s.left : s.right;
          const opp = idx === 0 ? s.right : s.left;
          stats[pid].gamesW += mine;
          stats[pid].gamesL += opp;
          if (mine > opp) stats[pid].saetzeW++;
          else stats[pid].saetzeL++;
        });
      }
    });
  });

  return stats;
}

export async function renderRoundRobin(bewerbId, container, opts) {
  container.innerHTML = "<p class='loading-text'>Lade Gruppen...</p>";

  try {
    const [preRes, matchRes, playerRes] = await Promise.all([
      readPreMatches(),
      readMatchesList(),
      readPlayersList(),
    ]);

    const preValues   = preRes.data?.values || [];
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

    const preHeader   = preValues[0] || [];
    const matchHeader = matchValues[0] || [];

    const all = [
      ...collectPlayers(preValues.slice(1), preHeader, bewerbId),
      ...collectPlayers(matchValues.slice(1), matchHeader, bewerbId),
    ];

    const seen = new Set();
    const unique = [];
    all.forEach((e) => {
      const key = e.group + ":" + e.id;
      if (!seen.has(key)) { seen.add(key); unique.push(e); }
    });

    const stats = buildStats(matchValues.slice(1), matchHeader, bewerbId);

    const groups = new Map();
    unique.forEach((e) => {
      if (!groups.has(e.group)) groups.set(e.group, []);
      groups.get(e.group).push(e.id);
    });

    const sorted = [...groups.entries()].sort((a, b) => a[0] - b[0]);

    if (sorted.length === 0) {
      container.innerHTML = "<p>Keine Gruppen für diesen Bewerb gefunden.</p>";
      return;
    }

    let html = "";
    sorted.forEach(([gNum, ids]) => {
      const rows = ids.map((id) => {
        const s = stats[id] || { siege: 0, saetzeW: 0, saetzeL: 0, gamesW: 0, gamesL: 0 };
        return { id, ...s };
      });

      rows.sort((a, b) => {
        if (b.siege !== a.siege) return b.siege - a.siege;
        const diffA = a.saetzeW - a.saetzeL;
        const diffB = b.saetzeW - b.saetzeL;
        if (diffB !== diffA) return diffB - diffA;
        return (b.gamesW - b.gamesL) - (a.gamesW - a.gamesL);
      });

      html += `<div style="display:inline-flex;flex-direction:column;border:2px solid #0b57d0;border-radius:12px;padding:16px;margin:0 12px 16px 0;min-width:400px;background:#fff;vertical-align:top;">`;
      html += `<div style="margin:0 0 12px 0;font-weight:700;font-size:1.05rem;color:#0b57d0;text-align:center;">Gruppe ${gNum}</div>`;
      html += `<table style="width:100%;border-collapse:collapse;font-size:0.9rem;">`;
      html += `<thead><tr style="background:#eef;font-weight:600;">`;
      html += `<th style="padding:6px 8px;text-align:center;border-bottom:2px solid #0b57d0;">Rang</th>`;
      html += `<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #0b57d0;">Name</th>`;
      html += `<th style="padding:6px 8px;text-align:center;border-bottom:2px solid #0b57d0;">Siege</th>`;
      html += `<th style="padding:6px 8px;text-align:center;border-bottom:2px solid #0b57d0;">Sätze<br><span style="font-weight:400;font-size:0.7rem;">W-L</span></th>`;
      html += `<th style="padding:6px 8px;text-align:center;border-bottom:2px solid #0b57d0;">Games<br><span style="font-weight:400;font-size:0.7rem;">W-L</span></th>`;
      html += `</tr></thead><tbody>`;
      rows.forEach((r, idx) => {
        html += `<tr style="border-bottom:1px solid #e0e0e0;">`;
        html += `<td style="padding:6px 8px;text-align:center;">${idx + 1}</td>`;
        html += `<td style="padding:6px 8px;">${playerMap.get(r.id) || "—"}</td>`;
        html += `<td style="padding:6px 8px;text-align:center;">${r.siege}</td>`;
        html += `<td style="padding:6px 8px;text-align:center;">${r.saetzeW}-${r.saetzeL}</td>`;
        html += `<td style="padding:6px 8px;text-align:center;">${r.gamesW}-${r.gamesL}</td>`;
        html += `</tr>`;
      });
      html += `</tbody></table></div>`;
    });

    container.innerHTML = html;
  } catch (err) {
    console.error("RoundRobin Fehler:", err);
    container.innerHTML = "<p>Fehler beim Laden der Gruppen.</p>";
  }
}
