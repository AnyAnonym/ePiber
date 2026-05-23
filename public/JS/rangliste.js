import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readRankedPlayers     = httpsCallable(functions, "readRankedPlayers");
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

/** Lädt IDs aller Spieler, die gerade in einer offenen Forderung stecken */
async function fetchBusyIds() {
  const res = await readPreMatches({ bewerbId: BEWERB_ID });
  const { success, preMatches = [] } = res?.data || {};
  if (!success) return new Set();

  const ids = new Set();
  preMatches.forEach((pm) => {
    const st = String(pm.status || "").trim().toLowerCase();
    if (st === "offen" || st === "bestaetigt") {
      [pm.player1Id, pm.player2Id, pm.player3Id, pm.player4Id]
        .filter(Boolean)
        .forEach((id) => ids.add(String(id).trim()));
    }
  });
  return ids;
}

/**
 * Vergleicht Matchdaten mit new Date() (wie clock.js).
 * Gibt zurück, wer Schutzzeit (nach Sieg) bzw. Sperrzeit (nach Niederlage) hat.
 */
async function fetchRestrictions() {
  const res = await readMatchRestrictions();
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

  const busyIds = busyRes.status === "fulfilled"
    ? busyRes.value
    : (console.warn("⚠️ BusyIds nicht geladen:", busyRes.reason), new Set());

  const { schutzzeitMap, sperrzeitMap } = restrictRes.status === "fulfilled"
    ? restrictRes.value
    : (console.warn("⚠️ Beschränkungen nicht geladen:", restrictRes.reason),
       { schutzzeitMap: new Map(), sperrzeitMap: new Map() });

  const myState = myRes.status === "fulfilled"
    ? myRes.value
    : (console.warn("⚠️ Eigener Spieler nicht geladen:", myRes.reason), null);

  console.log(`✅ Daten geladen | Busy: ${busyIds.size} | Schutz: ${schutzzeitMap.size} | Sperre: ${sperrzeitMap.size}`);

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

  // ── Schritt 5: DOM ATOMAR aktualisieren  ← erst HIER werden Klassen geändert
  container.querySelectorAll(".box").forEach((b) => {
    b.classList.remove("selected", "challengeable", "challenged", "protected");
    b.style.cursor = "";
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

    // ── 1. Offene Forderung → gelb (gilt für alle, nicht nur forderbare)
    if (busyIds.has(id)) {
      box.classList.add("challenged");
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

  console.log(`🎨 Forderbar: ${challengeableIds.size} | Busy(gelb): ${
    [...challengeableIds].filter(id => busyIds.has(id)).length} | Geschützt(rosa): ${
    [...challengeableIds].filter(id => schutzzeitMap.has(id)).length} | Sperre(lila): ${
    [...challengeableIds].filter(id => sperrzeitMap.has(id)).length}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  RANGLISTE LADEN
// ═══════════════════════════════════════════════════════════════════════════
export async function loadRanking() {
  try {
    const res = await readRankedPlayers({ bewerbId: BEWERB_ID });
    const data = res?.data;
    if (!data?.success || !Array.isArray(data.rankedList)) {
      console.error("❌ Keine gültigen Ranglisten-Daten:", data);
      return [];
    }
    console.log(`🏆 ${data.rankedList.length} Spieler geladen (BewerbID: ${BEWERB_ID})`);
    return data.rankedList;
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
  // "Nicht forderbar" und "Forderbar" nur sichtbar für eingeloggte Nutzer
  if (isLoggedIn) {
    items.push('<div class="legend-item"><span class="legend-swatch default"></span><span>Nicht forderbar</span></div>');
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
      const bewerbe = res.data?.bewerbe || [];
      const bewerb = bewerbe.find((b) => String(b.id) === BEWERB_ID);
      h2.textContent = bewerb ? bewerb.bezeichnung : "Rangliste";
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
      box.addEventListener("click", () =>
        window.openProfileModal({ playerId: player.playerId || "", boxElement: box })
      );

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
