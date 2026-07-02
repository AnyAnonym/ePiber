import {onCall} from "firebase-functions/v2/https";
import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();
const STATE_DOC = "navigator/state";
const SCROLL_DOC = "navigator/scroll";

export const setNavigatorTarget = onCall(async (request) => {
  const {path, status} = request.data || {};
  if (!path) return {success: false, error: "path erforderlich"};
  const payload = {
    target: path,
    status: status || "pending",
    updated: new Date().toISOString(),
  };
  await db.doc(STATE_DOC).set(payload);
  return {success: true};
});

export const getNavigatorTarget = onCall(async () => {
  const snap = await db.doc(STATE_DOC).get();
  if (!snap.exists) return {success: true, path: "", status: ""};
  const data = snap.data();
  return {success: true, path: data.target || "", status: data.status || ""};
});

export const setNavigatorScroll = onCall(async (request) => {
  const {amount} = request.data || {};
  if (typeof amount !== "number") return {success: false, error: "amount (number) erforderlich"};
  await db.doc(SCROLL_DOC).set({amount, ts: Date.now()});
  return {success: true};
});

export const getNavigatorScroll = onCall(async () => {
  const snap = await db.doc(SCROLL_DOC).get();
  if (!snap.exists) return {success: true, amount: 0, ts: 0};
  const data = snap.data();
  return {success: true, amount: data.amount || 0, ts: data.ts || 0};
});
