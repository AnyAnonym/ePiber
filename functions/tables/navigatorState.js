import {onCall} from "firebase-functions/v2/https";
import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();
const DOC = "navigator/state";

export const setNavigatorTarget = onCall(async (request) => {
  const {path, status} = request.data || {};
  if (!path) return {success: false, error: "path erforderlich"};
  const payload = {
    target: path,
    status: status || "pending",
    updated: new Date().toISOString(),
  };
  await db.doc(DOC).set(payload);
  return {success: true};
});

export const getNavigatorTarget = onCall(async () => {
  const snap = await db.doc(DOC).get();
  if (!snap.exists) return {success: true, path: "", status: ""};
  const data = snap.data();
  return {success: true, path: data.target || "", status: data.status || ""};
});
