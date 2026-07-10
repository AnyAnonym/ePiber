import {onCall} from "firebase-functions/v2/https";
import {initializeApp, getApps} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {ScoreboardCourts} from "../globalBackendVariables.js";
import {SCORER_SERVICE_URL} from "../backendVariables.js";

if (!getApps().length) {
  initializeApp();
}
const db = getFirestore();
const STATE_DOC = "scoreboard/courts";

// Initialer Seed: Testdaten aus globalBackendVariables schreiben falls leer
async function ensureDefaults() {
  const snap = await db.doc(STATE_DOC).get();
  if (!snap.exists) {
    await db.doc(STATE_DOC).set(ScoreboardCourts);
  }
}

// Aktiv-Status an Cloud Run Service senden
async function notifyScorerService() {
  try {
    const snap = await db.doc(STATE_DOC).get();
    const data = snap.data() || {};
    const courts = {
      "1": (data["1"] && data["1"].aktiv) || 0,
      "2": (data["2"] && data["2"].aktiv) || 0,
    };
    await fetch(SCORER_SERVICE_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({courts}),
    });
  } catch {
    // silent — Service evtl. nicht erreichbar
  }
}

export const setScoreboardCourt = onCall({region: "europe-west3", invoker: "public"}, async (request) => {
  const {court, matchId, bewerb, homePlayer, guestPlayer, dateTime, aktiv, runde} = request.data || {};
  if (!court || (court !== "1" && court !== "2")) {
    return {success: false, error: "court muss '1' oder '2' sein"};
  }
  const payload = {
    [`${court}.matchId`]: matchId || "",
    [`${court}.bewerb`]: bewerb || "",
    [`${court}.homePlayer`]: homePlayer || "",
    [`${court}.guestPlayer`]: guestPlayer || "",
    [`${court}.dateTime`]: dateTime || "",
    [`${court}.aktiv`]: typeof aktiv === "number" ? aktiv : 0,
    [`${court}.runde`]: runde || "",
  };
  try {
    await db.doc(STATE_DOC).update(payload);
  } catch {
    await ensureDefaults();
    await db.doc(STATE_DOC).update(payload);
  }

  // Signal an Cloud Run Service senden
  await notifyScorerService();

  return {success: true};
});

export const getScoreboardCourts = onCall({region: "europe-west3", invoker: "public"}, async () => {
  const snap = await db.doc(STATE_DOC).get();
  if (!snap.exists) {
    await ensureDefaults();
    const snap2 = await db.doc(STATE_DOC).get();
    return {success: true, courts: snap2.data() || {}};
  }
  return {success: true, courts: snap.data()};
});
