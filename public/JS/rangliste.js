import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readRlPlatzierung     = httpsCallable(functions, "readRlPlatzierung");
const readPlayersList       = httpsCallable(functions, "readPlayersList");
const readPlayerDetails     = httpsCallable(functions, "readPlayerDetails");
const readPreMatches        = httpsCallable(functions, "readPreMatches");
const readMatchRestrictions = httpsCallable(functions, "readMatchRestrictions");
const readBewerbe           = httpsCallable(functions, "readBewerbe");

const params    = new URLSearchParams(window.location.search);
const BEWERB_ID = params.get("id")
  || document.getElementById("rankingContainer")?.dataset.bewerbId
  || "2";

window.currentBewerbId = BEWERB_ID;

// ═══════════════════════════════════════════════════════════════════════════
//  COUNTDOWN-TIMER (analog zu clock.js: new Date(), update jede Minute)
// ═══════════════════════════════════════════════════════════════════════════
function startProtectionTimer(box, endDate) {
  box.querySelector(".box-timer")?.remove();

  const el = document.createElement("span");
  el.className = "box-timer";
  box.appendChild(el);

  function tick() {
    const ms = endDate - new Date();   // ← wie clock.js: aktuelles Datum
    if (ms <= 0) {
      clearInterval(intervalId);
      el.remove();
      return;
    }
    const days  = Math.floor(ms / 86_400_000);
    const hours = Math.floor((ms % 86_400_000) / 3_600_000);
    const mins  = Math.floor((ms % 3_600_000)  /    60_000);
    el.textContent = days > 0 ? `🔒 ${days}T ${hours}h` : `🔒 ${hours}h ${mins}m`;
  }

  tick();
  const intervalId = setInterval(tick, 60_000); // jede Minute, wie clock.js
}

// ═══════════════════════════════════════════════════════════════════════════
//  DATEN-LOADER  (jeder unabhängig – kein Fehler blockiert den anderen)
// ═══════════════════════════════════════════════════════════════════════════

/** Lädt IDs aller Spieler in offener Forderung + Rohdaten für Gegner-Analyse */
async function fetchBusyIds() {
  const res = await readPreMatches();
  const { success, values = [] } = res?.data || {};
  if (!success || values.length < 2) return { busyIds: new Set(), preMatches: [] };

  const header = values[0].map((h) => h.trim().toLowerCase());
  const statusIdx = header.indexOf("status");
  const bewerbIdx = header.indexOf("bewerbid");
  const p1Idx = header.indexOf("spielerid1");
  const p2Idx = header.indexOf("spielerid2");
  const p3Idx = header.indexOf("spielerid3");
  const p4Idx = header.indexOf("spielerid4");

  const busyIds = new Set();
  values.slice(1).forEach((row) => {
    if (bewerbIdx !== -1) {
      const rowBewerb = String(row[bewerbIdx] || "").trim();
      if (rowBewerb !== BEWERB_ID) return;
    }
    const st = String(row[statusIdx] || "offen").trim().toLowerCase();
    if (st === "offen" || st === "bestaetigt") {
      [row[p1Idx], row[p2Idx], row[p3Idx], row[p4Idx]]
        .filter(Boolean)
        .forEach((id) => busyIds.add(String(id).trim()));
    }
  });
  return { busyIds, preMatches: values };
}

/**
 * Vergleicht Matchdaten mit new Date() (wie clock.js).
 * Gibt zurück, wer Schutzzeit (nach Sieg) bzw. Sperrzeit (nach Niederlage) hat.
 */
async function fetchRestrictions() {
  const res = await readMatchRestrictions({ bewerbId: BEWERB_ID });
  const { success, schutzzeit = [], sperrzeit = [] } = res?.data || {};
  if (!success) return { schutzzeitMap: new Map(), sperrzeitMap: new Map() };

  return {
    schutzzeitMap: new Map(
      schutzzeit.map(({ id, until }) => [String(id).trim(), new Date(until)])
    ),
    sperrzeitMap: new Map(
      sperrzeit.map(({ id, until })  => [String(id).trim(), new Date(until)])
    ),
  };
}

/** Identifiziert den aktuell eingeloggten Spieler */
async function fetchMyState(rankedList) {
  const email =
    localStorage.getItem("currentUserEmail") ||
    localStorage.getItem("loggedInEmail");

  if (!email) return null;

  const res = await readPlayerDetails();
  const { success, players = [] } = res?.data || {};
  if (!success) return null;

  const me = players.find(
    (p) => (p.email || "").trim().toLowerCase() === email.trim().toLowerCase()
  );
  if (!me) return null;

  if (me.id) localStorage.setItem("currentUserId", String(me.id));

  const myPlayerId = String(me.id).trim();
  const myEntry    = rankedList.find(
    (p) => p.name.trim().toLowerCase() === (me.fullName || "").trim().toLowerCase()
  );

  return myEntry
    ? { myPlayerId, myRank: myEntry.rank }
    : { myPlayerId, myRank: null };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ZENTRALE REGEL-FUNKTION  (alle Regeln an einem Ort)
//
//  Reihenfolge der Farbzuweisung:
//   1. Mein Kästchen       → blau  (.selected)
//   2. In offener Forderung → gelb  (.challenged)
//   3. Hat Schutzzeit       → lila  (.protected) + Timer
//   4. Ich habe Sperrzeit   → lila  (.protected) + Timer
//   5. Normal forderbar     → grün  (.challengeable)
//   6. Nicht forderbar      → keine Klasse (grau)
//      Ausnahme: hat Schutzzeit → lila (sichtbar für alle)
// ═══════════════════════════════════════════════════════════════════════════
async function applyAllRules(container, pyramid, rankedList) {

  // ── Schritt 1: Alle Daten PARALLEL laden (Promise.allSettled = kein Fail)
  console.log("📊 Lade Ranglisten-Daten parallel...");

  const [busyRes, restrictRes, myRes] = await Promise.allSettled([
    fetchBusyIds(),
    fetchRestrictions(),
    fetchMyState(rankedList),
  ]);

  const busyData = busyRes.status === "fulfilled"
    ? busyRes.value
    : (console.warn("⚠️ BusyIds nicht geladen:", busyRes.reason),
       { busyIds: new Set(), preMatches: [] });

  const { schutzzeitMap, sperrzeitMap } = restrictRes.status === "fulfilled"
    ? restrictRes.value
    : (console.warn("⚠️ Beschränkungen nicht geladen:", restrictRes.reason),
       { schutzzeitMap: new Map(), sperrzeitMap: new Map() });

  const myState = myRes.status === "fulfilled"
    ? myRes.value
    : (console.warn("⚠️ Eigener Spieler nicht geladen:", myRes.reason), null);

  console.log(`✅ Daten geladen | Busy: ${busyData.busyIds.size} | Schutz: ${schutzzeitMap.size} | Sperre: ${sperrzeitMap.size}`);

  // Aktuelle Platzierung speichern für Raushängen-Funktion
  if (myState?.myRank != null) {
    localStorage.setItem("currentRank", String(myState.myRank));
    localStorage.setItem("currentBewerbId", BEWERB_ID);
  }

  // ── Schritt 2: Meine Position in der Pyramide finden
  let myPlayerId = null, myRow = -1, myCol = -1;

  if (myState?.myRank != null) {
    myPlayerId = myState.myPlayerId;
    for (let r = 0; r < pyramid.length; r++) {
      const idx = pyramid[r].findIndex((p) => p.rank === myState.myRank);
      if (idx !== -1) { myRow = r; myCol = idx; break; }
    }
  } else if (myState?.myPlayerId) {
    myPlayerId = myState.myPlayerId;
  }

  // ── Schritt 3: Forderbare IDs berechnen (Regelwerk)
  const challengeableIds = new Set();
  if (myRow !== -1 && myCol !== -1) {
    const me = pyramid[myRow][myCol];

    // Gleiche Zeile – alle links von mir
    for (let i = 0; i < myCol; i++) {
      const p = pyramid[myRow][i];
      if (p?.playerId) challengeableIds.add(String(p.playerId).trim());
    }

    // Reihe darüber – alle rechts von meiner Spalte
    const rowAbove = pyramid[myRow - 1];
    if (Array.isArray(rowAbove)) {
      for (let j = myCol; j < rowAbove.length; j++) {
        const p = rowAbove[j];
        if (p?.playerId) challengeableIds.add(String(p.playerId).trim());
      }
    }

    // Ausnahme: Rang 3 darf auch Rang 1 fordern
    if (me.rank === 3) {
      const rank1 = pyramid.flat().find((p) => p.rank === 1);
      if (rank1?.playerId) challengeableIds.add(String(rank1.playerId).trim());
    }
  }

  // ── Schritt 4: Bin ich selbst gesperrt? (Sperrzeit nach Niederlage)
  const iAmBlocked     = myPlayerId ? sperrzeitMap.has(myPlayerId) : false;
  const myBlockedUntil = iAmBlocked ? sperrzeitMap.get(myPlayerId) : null;

  if (iAmBlocked) {
    console.log(`⛔ Du bist gesperrt bis: ${myBlockedUntil.toLocaleString("de-AT")}`);
  }

  // ── Schritt 5: Gegner bei Forderungen mit mir ermitteln
  const myChallengeOpponents = new Set();
  if (myPlayerId && busyData.preMatches.length >= 2) {
    const pmHeader = busyData.preMatches[0].map((h) => h.trim().toLowerCase());
    const pmP1Idx = pmHeader.indexOf("spielerid1");
    const pmP2Idx = pmHeader.indexOf("spielerid2");
    const pmP3Idx = pmHeader.indexOf("spielerid3");
    const pmP4Idx = pmHeader.indexOf("spielerid4");
    const pmStatusIdx = pmHeader.indexOf("status");
    const pmBewerbIdx = pmHeader.indexOf("bewerbid");
    busyData.preMatches.slice(1).forEach((row) => {
      if (pmBewerbIdx !== -1 && String(row[pmBewerbIdx] || "").trim() !== BEWERB_ID) return;
      const st = String(row[pmStatusIdx] || "offen").trim().toLowerCase();
      if (st !== "offen" && st !== "bestaetigt") return;
      const players = [pmP1Idx, pmP2Idx, pmP3Idx, pmP4Idx]
        .map((idx) => (idx !== -1 ? String(row[idx] || "").trim() : ""))
        .filter(Boolean);
      if (players.includes(myPlayerId)) {
        players.forEach((p) => { if (p !== myPlayerId) myChallengeOpponents.add(p); });
      }
    });
  }

  // ── Schritt 6: DOM ATOMAR aktualisieren  ← erst HIER werden Klassen geändert
  container.querySelectorAll(".box").forEach((b) => {
    b.classList.remove("selected", "challengeable", "challenged", "protected",
      "schutz", "sperrzeit", "challenge-with-me");
    b.style.cursor = "";
    b.title = "";
    b.querySelector(".box-timer")?.remove();
  });

  // Mein Kästchen → immer blau
  if (myRow !== -1 && myCol !== -1) {
    pyramid[myRow][myCol].box.classList.add("selected");
  }

  pyramid.flat().forEach(({ playerId, box, rank }) => {
    const id = String(playerId).trim();

    // Eigenes Kästchen nie überschreiben
    if (myPlayerId && id === myPlayerId) return;

    // ── 1. Offene Forderung (gilt für alle, nicht nur forderbare)
    if (busyData.busyIds.has(id)) {
      box.classList.add("challenged");
      if (myChallengeOpponents.has(id)) {
        // Forderung MIT mir → gelber Hintergrund + blauer Rahmen
        box.classList.add("challenge-with-me");
      }
      // Forderung zwischen anderen → gelber Hintergrund + schwarzer Rahmen
      box.style.cursor = "not-allowed";
      box.title = "Dieser Spieler hat bereits eine offene Forderung";
      return;
    }

    // ── 2. Schutzzeit nach Sieg → rosa (gilt für alle, nicht nur forderbare)
    if (schutzzeitMap.has(id)) {
      box.classList.add("schutz");
      box.style.cursor = "default";
      box.title = `Schutzzeit nach Sieg – läuft ab am ${schutzzeitMap.get(id).toLocaleString("de-AT")}`;
      startProtectionTimer(box, schutzzeitMap.get(id));
      return;
    }

    // ── 3. Sperrzeit nach Niederlage → sichtbar für alle
    if (sperrzeitMap.has(id)) {
      box.classList.add("sperrzeit");
      box.title = `Sperrzeit nach Niederlage – läuft ab am ${sperrzeitMap.get(id).toLocaleString("de-AT")}`;
      startProtectionTimer(box, sperrzeitMap.get(id));
    }

    // ── 4. Nur forderbare Positionen werden hier weiter behandelt
    if (challengeableIds.has(id)) {
      if (iAmBlocked) {
        // Ich selbst habe Sperrzeit → alle forderbaren Positionen lila
        box.classList.add("protected");
        box.style.cursor = "not-allowed";
        box.title = `Du hast Sperrzeit – läuft ab am ${myBlockedUntil.toLocaleString("de-AT")}`;
        startProtectionTimer(box, myBlockedUntil);

      } else {
        // Alles OK → grün, kann gefordert werden
        box.classList.add("challengeable");
        box.style.cursor = "grab";
        box.title = "Diesen Spieler fordern";
      }
    }
    // ── 4. Nicht forderbar, kein gelb/lila → bleibt grau (keine Klasse)
  });

  console.log(`🎨 Forderbar: ${challengeableIds.size} | Busy: ${
    [...challengeableIds].filter(id => busyData.busyIds.has(id)).length} | Schutz: ${
    [...challengeableIds].filter(id => schutzzeitMap.has(id)).length} | Sperre: ${
    [...challengeableIds].filter(id => sperrzeitMap.has(id)).length}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  RANGLISTE LADEN
// ═══════════════════════════════════════════════════════════════════════════
export async function loadRanking() {
  try {
    const [rankRes, playersRes] = await Promise.all([
      readRlPlatzierung(),
      readPlayersList(),
    ]);

    if (!rankRes.data?.success || !playersRes.data?.success) {
      console.error("❌ Fehler beim Laden der Ranglisten-Daten");
      return [];
    }

    const rankValues = rankRes.data.values || [];
    const playerValues = playersRes.data.values || [];

    if (rankValues.length < 2 || playerValues.length < 2) return [];

    const rHeader = rankValues[0].map((h) => h.trim().toLowerCase());
    const bewerbIdIdx = rHeader.indexOf("bewerbid");
    const rankIdx = rHeader.indexOf("rang");
    const personIdIdx = rHeader.indexOf("personid");

    const pHeader = playerValues[0].map((h) => h.trim().toLowerCase());
    const pIdIdx = pHeader.indexOf("id");
    const pFnIdx = pHeader.indexOf("vorname");
    const pLnIdx = pHeader.indexOf("nachname");

    const playerMap = new Map();
    playerValues.slice(1).forEach((r) => {
      const id = r[pIdIdx];
      const name = `${(r[pFnIdx] || "").trim()} ${(r[pLnIdx] || "").trim()}`.trim();
      playerMap.set(id, name);
    });

    const rankedList = rankValues.slice(1)
      .filter((row) => {
        const bewerbId = String(row[bewerbIdIdx] || "").trim();
        return !BEWERB_ID || bewerbId === BEWERB_ID;
      })
      .map((row) => ({
        bewerbId: row[bewerbIdIdx] || "",
        rank: Number(row[rankIdx]),
        playerId: row[personIdIdx],
        name: playerMap.get(row[personIdIdx]) || "Unbekannt",
      }))
      .sort((a, b) => a.rank - b.rank);

    console.log(`🏆 ${rankedList.length} Spieler geladen (BewerbID: ${BEWERB_ID})`);
    return rankedList;
  } catch (err) {
    console.error("❌ Fehler beim Laden der Rangliste:", err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PYRAMIDE AUFBAUEN
// ═══════════════════════════════════════════════════════════════════════════
function renderRankingLegend() {
  const section = document.getElementById("rankingSection");
  if (!section) return;

  const heading = section.querySelector("h2");
  let body = section.querySelector(".ranking-body");
  if (!body) {
    body = document.createElement("div");
    body.className = "ranking-body";
    if (heading && heading.nextSibling) {
      section.insertBefore(body, heading.nextSibling);
    } else {
      section.appendChild(body);
    }
  }

  const container = document.getElementById("rankingContainer");
  if (container && container.parentElement !== body) {
    body.appendChild(container);
  }

  let legend = document.getElementById("rankingLegend");
  if (!legend) {
    legend = document.createElement("div");
    legend.id = "rankingLegend";
    legend.className = "ranking-legend";
    body.insertBefore(legend, body.firstChild);
  }

  // Sichtbarkeit abhängig vom Login-Status (localStorage keys, wie in fetchMyState verwendet)
  const isLoggedIn = Boolean(
    localStorage.getItem("currentUserEmail") ||
    localStorage.getItem("loggedInEmail") ||
    localStorage.getItem("currentUserId")
  );

  const items = [];
  // "Forderbar" nur sichtbar für eingeloggte Nutzer
  if (isLoggedIn) {
    items.push('<div class="legend-item"><span class="legend-swatch challengeable"></span><span>Forderbar</span></div>');
  }
  // Diese Einträge sind für alle sichtbar
  items.push('<div class="legend-item"><span class="legend-swatch challenged"></span><span>In offener Forderung</span></div>');
  items.push('<div class="legend-item"><span class="legend-swatch schutz"></span><span>Schutzzeit</span></div>');
  items.push('<div class="legend-item"><span class="legend-swatch sperrzeit"></span><span>Sperrzeit</span></div>');
  // "Mein Kästchen" nur für eingeloggte Nutzer
  if (isLoggedIn) {
    items.push('<div class="legend-item"><span class="legend-swatch selected"></span><span>Mein Kästchen</span></div>');
  }

  legend.innerHTML = `
    <div class="legend-label">Legende:</div>
    <div class="legend-items">
      ${items.join("\n      ")}
    </div>
    <button id="withdrawBtn" class="btn-login" style="margin-top: 12px; width: 100%; display: ${isLoggedIn ? 'block' : 'none'};">Raushängen</button>
  `;

  document.getElementById("withdrawBtn")?.addEventListener("click", () => {
    const btn = document.getElementById("withdrawBtn");
    if (btn && btn.style.display !== "none") {
      document.getElementById("withdrawModal")?.classList.remove("hidden");
    }
  });
}

export async function renderRanking() {
  const container = document.getElementById("rankingContainer");
  if (!container) return;

  const h2 = document.querySelector("#rankingSection h2");
  if (h2) {
    try {
      const res = await readBewerbe();
      const bewerbeValues = res.data?.values || [];
      if (bewerbeValues.length > 1) {
        const bHeader = bewerbeValues[0].map((h) => h.trim().toLowerCase());
        const bIdIdx = bHeader.indexOf("id");
        const bBezIdx = bHeader.indexOf("bezeichnung");
        const bewerbRow = bewerbeValues.slice(1).find((r) => String(r[bIdIdx] || "").trim() === BEWERB_ID);
        h2.textContent = bewerbRow ? (bewerbRow[bBezIdx] || "Rangliste") : "Rangliste";
      } else {
        h2.textContent = "Rangliste";
      }
    } catch {
      h2.textContent = "Rangliste";
    }
  }

  renderRankingLegend();

  const rankedList = await loadRanking();
  container.innerHTML = "";

  if (!rankedList.length) {
    container.innerHTML = "<p>Es gibt noch keine Spieler für diese Rangliste.</p>";
    return;
  }

  rankedList.sort((a, b) => a.rank - b.rank);

  const pyramid = [];
  let current = 0, level = 1;

  while (current < rankedList.length) {
    const remaining = rankedList.length - current;
    const rowSize   = Math.min(level, remaining);
    const rowEl     = document.createElement("div");
    rowEl.className = "row";
    rowEl.style.justifyContent = "flex-start";
    rowEl.style.gap = "20px";

    const rowBoxes = [];

    for (let i = 0; i < rowSize && current < rankedList.length; i++, current++) {
      const player = rankedList[current];
      const box    = document.createElement("div");
      box.className = "box";

      const parts     = (player.name || "").split(" ");
      const firstName = parts[0] || "";
      const lastName  = parts.slice(1).join(" ") || "";

      box.innerHTML = `
        <span class="box-rank-bg">${player.rank}</span>
        <span class="box-name">${firstName}<br>${lastName}</span>
      `;

      rowEl.appendChild(box);
      box.addEventListener("click", () => {
        const isLoggedIn = Boolean(
          localStorage.getItem("currentUserEmail") ||
          localStorage.getItem("loggedInEmail") ||
          localStorage.getItem("currentUserId")
        );
        if (isLoggedIn) {
          window.openProfileModal({
            playerId: player.playerId || "",
            boxElement: box,
          });
        }
      });

      rowBoxes.push({
        rank:     player.rank,
        playerId: String(player.playerId || "").trim(),
        name:     player.name,
        box,
      });
    }

    // Leere Platzhalter für visuelle Balance
    for (let i = rowSize; i < level; i++) {
      const ph = document.createElement("div");
      ph.className = "box";
      ph.style.visibility = "hidden";
      rowEl.appendChild(ph);
    }

    pyramid.push(rowBoxes);
    container.appendChild(rowEl);
    level++;
  }

  // Alle Regeln anwenden (Daten zuerst, dann DOM)
  await applyAllRules(container, pyramid, rankedList);
}

document.addEventListener("DOMContentLoaded", () => {
  renderRanking();
});
