import { getUser, ready, subscribeAuth } from "./authClient.js";
import { diagnostic } from "./diagnostics.js";

const element = (id) => document.getElementById(id);
const supported = () => globalThis.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const labels = { queued: "Wartet auf Versand", sending: "Versand läuft", accepted: "Vom Push-Dienst angenommen – Anzeige nicht nachgewiesen", failed: "Versand abgelehnt", expired: "Test oder Registrierung abgelaufen", unknown: "Versandausgang unklar – kein automatischer Neuversand", cancelled: "Abgebrochen" };
let snapshot = null;
let deviceId = null;
let busy = false;
let generation = 0;
let accountId = null;

function savedDevice() {
  try { return localStorage.getItem(`epiber-push:${accountId}`); } catch { return null; }
}
function saveDevice(value) {
  deviceId = value;
  try {
    if (value) localStorage.setItem(`epiber-push:${accountId}`, value);
    else localStorage.removeItem(`epiber-push:${accountId}`);
  } catch { /* Server registration remains authoritative if storage is unavailable. */ }
}
async function request(body = null) {
  const response = await fetch("/api/push-pilot", {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message || "Push-Anfrage fehlgeschlagen"), { code: result.error?.code || "PUSH_REQUEST_FAILED" });
  return result;
}
async function write(action, value, expectedGeneration) {
  if (expectedGeneration !== generation || !accountId) throw new Error("Anmeldung wurde geändert. Bitte erneut versuchen.");
  return request({ operationId: crypto.randomUUID(), accountId, action, value });
}
function render() {
  const enabled = Boolean(accountId && snapshot?.enabled);
  const active = snapshot?.devices.find((device) => device.id === deviceId && !device.revoked);
  element("push-activate").disabled = busy || !enabled || !supported() || Notification.permission === "denied";
  element("push-test").disabled = busy || !enabled || !active || !supported() || Notification.permission !== "granted";
  element("push-refresh").disabled = busy || !accountId;
  element("push-device-status").textContent = !accountId ? "Bitte zuerst anmelden." : !snapshot?.enabled ? "Der Push-Pilot ist serverseitig noch nicht aktiviert."
    : !supported() ? "Push ist in diesem Browserkontext nicht verfügbar. Bitte einen unterstützten aktuellen Browser verwenden und auf Apple-Geräten die Home-Bildschirm-App öffnen."
      : Notification.permission === "denied" ? "Benachrichtigungen sind blockiert. Bitte Browser- und Systemeinstellungen prüfen."
        : active ? `Dieses Browserprofil ist registriert. Browserfreigabe: ${Notification.permission === "granted" ? "erteilt" : "erneut erforderlich"}.`
          : "Dieses Browserprofil ist noch nicht deinem Konto zugeordnet. Aktivieren registriert es neu oder stellt eine bestehende Zuordnung wieder her.";
  element("push-devices").replaceChildren();
  for (const [index, device] of (snapshot?.devices || []).entries()) {
    const row = document.createElement("li");
    row.append(document.createTextNode(`Gerät ${index + 1}${device.id === deviceId ? " (dieses Browserprofil)" : ""}: ${device.revoked ? "deaktiviert" : "registriert"}`));
    if (!device.revoked) {
      const button = document.createElement("button");
      button.textContent = "Deaktivieren";
      button.disabled = busy;
      button.addEventListener("click", () => run(async (current) => {
        await write("revoke", device.id, current);
        if (current !== generation) return;
        if (device.id === deviceId) {
          saveDevice(null);
          const registration = await navigator.serviceWorker?.getRegistration("/");
          const local = await registration?.pushManager.getSubscription();
          await local?.unsubscribe();
        }
      }));
      row.append(button);
    }
    element("push-devices").append(row);
  }
  element("push-tests").replaceChildren();
  for (const test of snapshot?.tests || []) {
    const row = document.createElement("li");
    row.append(document.createTextNode(`${test.createdAt ? new Date(test.createdAt).toLocaleString("de-AT") + ": " : ""}${labels[test.status] || "Status unbekannt"}${test.confirmed ? " · Empfang von dir bestätigt" : " · Empfang nicht bestätigt"}`));
    if (!test.confirmed) {
      const button = document.createElement("button");
      button.textContent = "Ich habe diesen Test empfangen";
      button.disabled = busy;
      button.addEventListener("click", () => run((current) => write("confirm", test.id, current)));
      row.append(button);
    }
    element("push-tests").append(row);
  }
}
async function refresh(current = generation) {
  if (!accountId) { render(); return; }
  const value = await request();
  if (current !== generation) return;
  snapshot = value;
  deviceId = deviceId || savedDevice();
  render();
  if (!busy) element("push-status").textContent = "Push-Status geladen.";
}
async function run(operation) {
  if (busy || !accountId) return;
  const current = generation;
  busy = true;
  render();
  element("push-status").textContent = "Wird verarbeitet …";
  try {
    await operation(current);
    if (current !== generation) return;
    await refresh(current);
    element("push-status").textContent = "Status aktualisiert. Bitte tatsächlichen Testempfang ausdrücklich bestätigen.";
  } catch (error) {
    if (current !== generation) return;
    // Native provider exceptions may include subscription endpoints. Do not log them.
    diagnostic.error("push_pilot_action_failed", { code: "PUSH_ACTION_FAILED" });
    const messages = {
      PUSH_DEVICE_CONFLICT: "Dieses Browserprofil gehört bereits zu einem anderen Konto. Dort zuerst Push deaktivieren; danach hier erneut aktivieren.",
      PUSH_TEST_RATE_LIMIT: "Bitte eine Minute bis zum nächsten Test warten.",
      PUSH_DEVICE_LIMIT: "Höchstens zehn Geräte sind erlaubt. Bitte ein altes Gerät deaktivieren.",
      AUTH_REQUIRED: "Deine Anmeldung ist abgelaufen oder wurde geändert. Bitte erneut anmelden.",
    };
    element("push-status").textContent = messages[error.code] || "Aktion nicht sicher abgeschlossen. Status aktualisieren und Browserfreigabe prüfen. Bei unklarem Versand nicht blind erneut senden.";
  } finally {
    if (current === generation) { busy = false; render(); }
  }
}
element("push-activate").addEventListener("click", () => {
  // Permission must be requested directly during the user gesture (Apple included).
  const permission = Notification.requestPermission();
  run(async (current) => {
    if (await permission !== "granted") throw new Error("Freigabe fehlt");
    const registration = await navigator.serviceWorker.register("/push-worker.js", { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    let target = await registration.pushManager.getSubscription();
    const key = Uint8Array.from(atob(snapshot.publicKey.replace(/-/g, "+").replace(/_/g, "/") + "="), (char) => char.charCodeAt(0));
    if (target?.options.applicationServerKey && !Array.from(new Uint8Array(target.options.applicationServerKey)).every((byte, index) => byte === key[index])) {
      await target.unsubscribe();
      target = null;
    }
    target = target || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const encoded = target.toJSON();
    const result = await write("register", { endpoint: encoded.endpoint, keys: encoded.keys }, current);
    if (current === generation) saveDevice(result.deviceId);
  });
});
element("push-test").addEventListener("click", () => run((current) => write("test", deviceId, current)));
element("push-refresh").addEventListener("click", () => run(refresh));
subscribeAuth((user) => {
  if ((user?.id || null) === accountId) return;
  generation++;
  accountId = user?.id || null;
  snapshot = null;
  deviceId = null;
  busy = false;
  const current = generation;
  element("push-status").textContent = accountId ? "Push-Status wird geladen …" : "Bitte anmelden, um Push einzurichten.";
  render();
  refresh(current).catch(() => {
    if (current !== generation) return;
    diagnostic.error("push_pilot_load_failed", { code: "PUSH_LOAD_FAILED" });
    element("push-status").textContent = "Push-Status konnte nicht geladen werden. Bitte erneut aktualisieren.";
  });
});
await ready;
if (!getUser()) render();
