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
    const p1 = String(row[p1Idx] || "").trim();
    const p3 = p3Idx !== -1 ? String(row[p3Idx] || "").trim() : "";
    if (p1) ids.push({ group: g, id: p1 });
    if (p3) ids.push({ group: g, id: p3 });
  });
  return ids;
}

function buildStats(matchData, matchHeader, bewerbId) {
  const h = matchHeader.map((c) => String(c).trim().toLowerCase());
  const bwIdx = h.indexOf("bewerbid");
  const p1Idx = h.indexOf("spielerid1");
  const p3Idx = h.indexOf("spielerid3");
  const gwIdx = h.indexOf("gewinner");

  const played = {};
  const won = {};

  matchData.forEach((row) => {
    if (bwIdx >= 0 && String(row[bwIdx] || "").trim() !== String(bewerbId).trim()) return;
    const p1 = String(row[p1Idx] || "").trim();
    const p3 = p3Idx !== -1 ? String(row[p3Idx] || "").trim() : "";
    const winner = gwIdx !== -1 ? String(row[gwIdx] || "").trim() : "";

    if (p1) {
      played[p1] = (played[p1] || 0) + 1;
      if (winner === p1) won[p1] = (won[p1] || 0) + 1;
    }
    if (p3) {
      played[p3] = (played[p3] || 0) + 1;
      if (winner === p3) won[p3] = (won[p3] || 0) + 1;
    }
  });

  return { played, won };
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
      html += `<div style="display:inline-flex;flex-direction:column;border:2px solid #0b57d0;border-radius:12px;padding:16px;margin:0 12px 16px 0;min-width:350px;background:#fff;vertical-align:top;">`;
      html += `<div style="margin:0 0 12px 0;font-weight:700;font-size:1.05rem;color:#0b57d0;text-align:center;">Gruppe ${gNum}</div>`;
      html += `<table style="width:100%;border-collapse:collapse;font-size:0.9rem;">`;
      html += `<thead><tr style="background:#eef;font-weight:600;">`;
      html += `<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #0b57d0;">Name</th>`;
      html += `<th style="padding:6px 8px;text-align:center;border-bottom:2px solid #0b57d0;">gespielte Partien</th>`;
      html += `<th style="padding:6px 8px;text-align:center;border-bottom:2px solid #0b57d0;">gewonnene Partien</th>`;
      html += `</tr></thead><tbody>`;
      ids.forEach((id) => {
        const p = stats.played[id] || 0;
        const w = stats.won[id] || 0;
        html += `<tr style="border-bottom:1px solid #e0e0e0;">`;
        html += `<td style="padding:6px 8px;">${playerMap.get(id) || "—"}</td>`;
        html += `<td style="padding:6px 8px;text-align:center;">${p}</td>`;
        html += `<td style="padding:6px 8px;text-align:center;">${w}</td>`;
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
