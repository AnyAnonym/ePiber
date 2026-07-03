import {onCall} from "firebase-functions/v2/https";
import {initializeApp, getApps} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {ScoreboardCourts} from "../globalBackendVariables.js";

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

export const setScoreboardCourt = onCall({invoker: "public"}, async (request) => {
  const {court, matchId, bewerb, homePlayer, guestPlayer, dateTime} = request.data || {};
  if (!court || (court !== "1" && court !== "2")) {
    return {success: false, error: "court muss '1' oder '2' sein"};
  }
  const payload = {
    [`${court}.matchId`]: matchId || "",
    [`${court}.bewerb`]: bewerb || "",
    [`${court}.homePlayer`]: homePlayer || "",
    [`${court}.guestPlayer`]: guestPlayer || "",
    [`${court}.dateTime`]: dateTime || "",
  };
  try {
    await db.doc(STATE_DOC).update(payload);
  } catch {
    // Dokument existiert noch nicht → set statt update
    await ensureDefaults();
    await db.doc(STATE_DOC).update(payload);
  }
  return {success: true};
});

export const getScoreboardCourts = onCall({invoker: "public"}, async () => {
  const snap = await db.doc(STATE_DOC).get();
  if (!snap.exists) {
    await ensureDefaults();
    const snap2 = await db.doc(STATE_DOC).get();
    return {success: true, courts: snap2.data() || {}};
  }
  return {success: true, courts: snap.data()};
});
