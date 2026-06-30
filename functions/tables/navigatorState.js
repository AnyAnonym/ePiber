import {onCall} from "firebase-functions/v2/https";
import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();
const DOC = "navigator/state";

export const setNavigatorTarget = onCall(async (request) => {
  const {path} = request.data || {};
  if (!path) return {success: false, error: "path erforderlich"};
  await db.doc(DOC).set({target: path, updated: new Date().toISOString()});
  return {success: true};
});

export const getNavigatorTarget = onCall(async () => {
  const snap = await db.doc(DOC).get();
  const path = snap.exists ? (snap.data().target || "") : "";
  return {success: true, path};
});
