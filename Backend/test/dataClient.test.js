const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.listeners = new Map();
    this.closeCode = null;
    this.closeReason = "";
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }

  dispatch(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) callback(event);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open");
  }

  send(value) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("socket closed");
    this.sent.push(JSON.parse(value));
  }

  receive(message) {
    this.dispatch("message", { data: JSON.stringify(message) });
  }

  close(code = 1000, reason = "") {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code, reason });
  }
}

function loadDataClient({ cryptoImplementation, fetchImplementation, now, online = true, sessionStorage, storageValues = new Map() } = {}) {
  FakeWebSocket.instances = [];
  const intervals = new Set();
  const intervalCallbacks = new Map();
  const timeouts = new Set();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const reloads = [];
  const storage = {
    getItem(key) { return storageValues.get(key) || null; },
    setItem(key, value) { storageValues.set(key, String(value)); },
    removeItem(key) { storageValues.delete(key); },
  };
  const location = {
    href: "http://test.local/scoreboard.html",
    pathname: "/scoreboard.html",
    protocol: "http:",
    reload() { reloads.push(Date.now()); },
  };
  const navigatorState = { onLine: online };
  const documentState = {
    hidden: false,
    addEventListener(type, callback) { documentListeners.set(type, callback); },
  };
  const trackedSetTimeout = (callback, delay, ...args) => {
    const timer = setTimeout(() => {
      timeouts.delete(timer);
      callback(...args);
    }, delay);
    timeouts.add(timer);
    return timer;
  };
  const trackedClearTimeout = (timer) => {
    timeouts.delete(timer);
    clearTimeout(timer);
  };
  const trackedSetInterval = (callback, delay, ...args) => {
    const timer = setInterval(callback, delay, ...args);
    intervals.add(timer);
    intervalCallbacks.set(timer, () => callback(...args));
    return timer;
  };
  const trackedClearInterval = (timer) => {
    intervals.delete(timer);
    intervalCallbacks.delete(timer);
    clearInterval(timer);
  };
  const RuntimeDate = now
    ? class extends Date { static now() { return now.value; } }
    : Date;
  let uuidCounter = 0;
  const context = vm.createContext({
    URL,
    WebSocket: FakeWebSocket,
    AbortController,
    Date: RuntimeDate,
    clearInterval: trackedClearInterval,
    clearTimeout: trackedClearTimeout,
    console,
    crypto: cryptoImplementation || { randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}` },
    document: documentState,
    localStorage: storage,
    location,
    navigator: navigatorState,
    fetch: fetchImplementation,
    setInterval: trackedSetInterval,
    setTimeout: trackedSetTimeout,
    window: {
      APP_VERSION: "test",
      fetch: fetchImplementation,
      localStorage: storage,
      location,
      sessionStorage: sessionStorage || storage,
      addEventListener(type, callback) { windowListeners.set(type, callback); },
    },
  });
  const filename = path.resolve(__dirname, "../../Frontend/JS/dataClient.js");
  const exported = [];
  let source = `const diagnostic = { debug() {}, error() {}, info() {}, warn() {} };\n${fs.readFileSync(filename, "utf8")}`.replace(/^import .*$/gm, "").replace(
    /\bexport\s+(async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g,
    (_match, asyncKeyword = "", name) => {
      exported.push(name);
      return `${asyncKeyword}function ${name}(`;
    },
  );
  source += `\nglobalThis.__dataClientExports = { ${exported.join(", ")} };`;
  new vm.Script(source, { filename }).runInContext(context);
  return {
    api: context.__dataClientExports,
    document: documentState,
    documentListeners,
    intervals,
    navigator: navigatorState,
    reloads,
    runIntervals() {
      for (const callback of [...intervalCallbacks.values()]) callback();
    },
    sockets: FakeWebSocket.instances,
    storageValues,
    timeouts,
    windowListeners,
  };
}

test("sichtbar gewordene Seiten ersetzen die moeglicherweise eingefrorene Verbindung", async (t) => {
  const runtime = loadDataClient();
  t.after(() => runtime.api.disconnect());
  const firstSocket = runtime.sockets[0];
  firstSocket.open();
  firstSocket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  await Promise.resolve();

  runtime.document.hidden = true;
  runtime.documentListeners.get("visibilitychange")();
  assert.equal(runtime.sockets.length, 1);

  runtime.document.hidden = false;
  runtime.documentListeners.get("visibilitychange")();
  assert.equal(runtime.sockets.length, 2);
  assert.equal(runtime.api.isConnected(), false);

  const replacement = runtime.sockets[1];
  replacement.open();
  replacement.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  assert.equal(runtime.api.isConnected(), true);
});

test("sichtbar gewordene Seiten warten bei Backoff nicht auf einen eingefrorenen Timer", (t) => {
  const runtime = loadDataClient();
  t.after(() => runtime.api.disconnect());
  const firstSocket = runtime.sockets[0];
  firstSocket.open();
  firstSocket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  firstSocket.close(1006, "network lost");
  assert.equal(runtime.sockets.length, 1);

  runtime.documentListeners.get("visibilitychange")();
  assert.equal(runtime.sockets.length, 2);
});

test("Vordergrund-Recovery begrenzt den Backoff auch nach mehreren Fehlversuchen", async (t) => {
  const now = { value: 1000 };
  const runtime = loadDataClient({ now });
  t.after(() => runtime.api.disconnect());
  let latestStatus;
  runtime.api.onConnectionState((status) => { latestStatus = status; });
  const firstSocket = runtime.sockets[0];
  firstSocket.open();
  firstSocket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  await Promise.resolve();

  runtime.document.hidden = true;
  runtime.documentListeners.get("visibilitychange")();
  now.value += 60000;
  runtime.document.hidden = false;
  runtime.documentListeners.get("visibilitychange")();

  const reconnects = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    runtime.sockets.at(-1).close(1006, "network not ready");
    assert.equal(latestStatus.state, "backoff");
    assert.ok(latestStatus.retryInMs <= 2400, `Backoff war ${latestStatus.retryInMs} ms`);
    reconnects.push(runtime.api.restartConnection());
  }

  const recoveredSocket = runtime.sockets.at(-1);
  recoveredSocket.open();
  recoveredSocket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  await Promise.all(reconnects);
  assert.equal(runtime.api.isConnected(), true);
});

test("sichtbare Requests ueberholen einen laufenden passiven Reconnect-Backoff", async (t) => {
  const runtime = loadDataClient();
  t.after(() => runtime.api.disconnect());
  const firstSocket = runtime.sockets[0];
  firstSocket.open();
  firstSocket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  await Promise.resolve();
  firstSocket.close(1006, "network lost");
  assert.equal(runtime.sockets.length, 1);

  const request = runtime.api.request("players", {});
  assert.equal(runtime.sockets.length, 2);
  const replacement = runtime.sockets[1];
  replacement.open();
  replacement.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  await Promise.resolve();
  const message = replacement.sent.find((entry) => entry.type === "request" && entry.endpoint === "players");
  replacement.receive({ type: "response", v: 2, id: message.id, endpoint: "players", data: { success: true } });
  assert.equal((await request).success, true);
});

test("Timerluecke erkennt Android-Standby auch nach einer frischen WebSocket-Nachricht", (t) => {
  const now = { value: 1000 };
  const runtime = loadDataClient({ now });
  t.after(() => runtime.api.disconnect());
  const firstSocket = runtime.sockets[0];
  firstSocket.open();
  firstSocket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });

  now.value += 8 * 60 * 1000;
  firstSocket.receive({ type: "ping", v: 2, ts: now.value });
  runtime.runIntervals();
  assert.equal(runtime.sockets.length, 2);
});

test("Fokus prueft die Serverversion und laedt bei einem Update genau einmal neu", async (t) => {
  const requests = [];
  const runtime = loadDataClient({
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ version: "test-next" }) };
    },
  });
  t.after(() => runtime.api.disconnect());
  const firstSocket = runtime.sockets[0];
  firstSocket.open();
  firstSocket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });

  runtime.windowListeners.get("focus")();
  await new Promise((resolve) => setImmediate(resolve));
  runtime.windowListeners.get("focus")();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/version");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(runtime.reloads.length, 1);
});

test("dataClient korreliert Requests, propagiert Fehler und stellt Subscriptions wieder her", async (t) => {
  const runtime = loadDataClient();
  const { api, sockets } = runtime;
  t.after(() => api.disconnect());
  assert.equal(sockets.length, 1);
  const firstSocket = sockets[0];
  assert.equal(firstSocket.url, "ws://test.local/ws");
  firstSocket.open();
  await Promise.resolve();
  assert.equal(firstSocket.sent[0].type, "hello");
  assert.equal(firstSocket.sent[0].v, 2);
  firstSocket.receive({
    type: "welcome",
    v: 2,
    protocol: 2,
    principal: { type: "anonymous", role: "anonymous" },
  });
  assert.equal(api.isConnected(), true);

  let invalidationRefreshes = 0;
  const stopInvalidations = api.subscribeInvalidations(["matches"], () => {
    invalidationRefreshes += 1;
  }, { delayMs: 1 });
  firstSocket.receive({ type: "event", v: 2, topic: "matches", data: { revision: 1 } });
  firstSocket.receive({ type: "event", v: 2, topic: "matches", data: { revision: 2 } });
  firstSocket.receive({ type: "event", v: 2, topic: "matches", data: { revision: 3 } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(invalidationRefreshes, 1);

  const requestPromise = api.request("players", {});
  await Promise.resolve();
  const requestMessage = firstSocket.sent.find((message) => message.type === "request");
  assert.equal(requestMessage.v, 2);
  firstSocket.receive({
    type: "response",
    v: 2,
    id: requestMessage.id,
    endpoint: "players",
    supportId: "support-1",
    data: { success: false, error: { code: "TEST_ERROR", message: "Testfehler" } },
  });
  await assert.rejects(requestPromise, (error) => {
    assert.equal(error.code, "TEST_ERROR");
    assert.equal(error.supportId, "support-1");
    return true;
  });

  const scoreEvents = [];
  const unsubscribe = api.subscribe("scores", (data) => scoreEvents.push(data));
  assert.equal(firstSocket.sent.at(-1).type, "subscribe");
  const reconnecting = api.restartConnection();
  assert.equal(sockets.length, 2);
  const secondSocket = sockets[1];
  secondSocket.open();
  secondSocket.receive({
    type: "welcome",
    v: 2,
    protocol: 2,
    principal: { type: "anonymous", role: "anonymous" },
  });
  await reconnecting;
  const secondSubscribe = secondSocket.sent.filter((message) => message.type === "subscribe").at(-1);
  assert.deepEqual([...secondSubscribe.topics].sort(), ["matches", "scores"]);
  secondSocket.receive({ type: "event", v: 2, topic: "scores", data: { revision: 7 } });
  assert.equal(scoreEvents[0].revision, 7);

  secondSocket.receive({ type: "ping", v: 2, ts: Date.now() });
  secondSocket.close(1008, "policy violation");
  assert.equal(secondSocket.closeCode, 1008);
  stopInvalidations();
  unsubscribe();
  api.disconnect();
  assert.equal(api.isConnected(), false);
  assert.equal(runtime.intervals.size, 0);
  assert.equal(runtime.timeouts.size, 0);
});

test("dataClient lehnt Pending Requests bei Verbindungsabbruch sofort ab", async (t) => {
  const runtime = loadDataClient();
  t.after(() => runtime.api.disconnect());
  const socket = runtime.sockets[0];
  socket.open();
  socket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  const pending = runtime.api.request("players", {});
  await Promise.resolve();
  socket.close(1006, "network lost");
  await assert.rejects(pending, /getrennt/);
  runtime.api.disconnect();
  assert.equal(runtime.intervals.size, 0);
  assert.equal(runtime.timeouts.size, 0);
});

test("operationId bleibt ohne randomUUID ein gueltiger UUID-v4-Wert", (t) => {
  let next = 0;
  const runtime = loadDataClient({
    cryptoImplementation: {
      getRandomValues(bytes) {
        for (let index = 0; index < bytes.length; index++) bytes[index] = next++;
        return bytes;
      },
    },
  });
  t.after(() => runtime.api.disconnect());
  assert.match(runtime.api.createOperationId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("refreshSheetData wird nach einem temporaeren Fehler nicht automatisch wiederholt", async (t) => {
  const runtime = loadDataClient();
  t.after(() => runtime.api.disconnect());
  const socket = runtime.sockets[0];
  socket.open();
  socket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "user", role: "admin" } });
  const params = { operationId: "00000000-0000-4000-8000-000000000230" };
  const pending = runtime.api.request("refreshSheetData", params);
  await Promise.resolve();
  const first = socket.sent.find((message) => message.type === "request");
  socket.receive({
    type: "response",
    v: 2,
    id: first.id,
    endpoint: "refreshSheetData",
    data: { success: false, error: { code: "SHUTTING_DOWN", message: "shutdown" } },
  });
  await assert.rejects(pending, (error) => error.code === "SHUTTING_DOWN");
  const requests = socket.sent.filter((message) => message.type === "request");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].params.operationId, params.operationId);
});

test("dataClient lehnt Responses mit falschem Endpoint ab", async (t) => {
  const runtime = loadDataClient();
  t.after(() => runtime.api.disconnect());
  const socket = runtime.sockets[0];
  socket.open();
  socket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  const pending = runtime.api.request("players", {});
  await Promise.resolve();
  const request = socket.sent.find((message) => message.type === "request");
  socket.receive({ type: "response", v: 2, id: request.id, endpoint: "matches1", data: { success: true } });
  await assert.rejects(pending, (error) => error.code === "PROTOCOL_MISMATCH");
  assert.equal(socket.closeCode, 4406);
});

test("Reconnect stellt mehr als zwanzig Subscriptions in mehreren Batches wieder her", async (t) => {
  const runtime = loadDataClient();
  t.after(() => runtime.api.disconnect());
  const first = runtime.sockets[0];
  first.open();
  first.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "user", role: "operator" } });
  const unsubscribers = Array.from({ length: 25 }, (_, index) => runtime.api.subscribe(`monitor-status:m-${index}`, () => {}));

  const reconnecting = runtime.api.restartConnection();
  const second = runtime.sockets[1];
  second.open();
  second.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "user", role: "operator" } });
  await reconnecting;
  const batches = second.sent.filter((message) => message.type === "subscribe").map((message) => message.topics.length);
  assert.deepEqual(batches, [20, 5]);
  for (const unsubscribe of unsubscribers) unsubscribe();
});

test("terminale Close-Codes koennen durch Lifecycle-Events nicht neu gestartet werden", async (t) => {
  const runtime = loadDataClient();
  const unhandled = [];
  const unhandledListener = (error) => unhandled.push(error);
  const uncaughtListener = (error) => unhandled.push(error);
  process.on("uncaughtException", uncaughtListener);
  process.on("unhandledRejection", unhandledListener);
  const socket = runtime.sockets[0];
  socket.open();
  socket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  socket.close(1008, "policy violation");

  runtime.document.hidden = true;
  runtime.documentListeners.get("visibilitychange")();
  runtime.document.hidden = false;
  runtime.documentListeners.get("visibilitychange")();
  runtime.windowListeners.get("pageshow")({ persisted: true });
  await Promise.resolve();
  assert.equal(runtime.sockets.length, 1);
  await assert.rejects(runtime.api.restartConnection(), (error) => error.code === "TERMINAL_CONNECTION");
  assert.equal(runtime.sockets.length, 1);
  const recovery = runtime.api.restartConnection({ allowTerminal: true });
  const replacement = runtime.sockets[1];
  replacement.open();
  replacement.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  await recovery;
  assert.equal(runtime.api.isConnected(), true);
  runtime.api.disconnect();
  assert.equal(runtime.api.isConnected(), false);
  assert.equal(runtime.intervals.size, 0);
  assert.equal(runtime.timeouts.size, 0);
  process.off("unhandledRejection", unhandledListener);
  process.off("uncaughtException", uncaughtListener);
  if (unhandled.length) {
    throw unhandled[0];
  }
});

test("App-Versionskonflikt laedt einmal neu und stoppt bei Wiederholung", async (t) => {
  const storageValues = new Map();
  const firstRuntime = loadDataClient({ storageValues });
  t.after(() => firstRuntime.api.disconnect());
  const firstSocket = firstRuntime.sockets[0];
  firstSocket.open();
  await Promise.resolve();
  firstSocket.close(4406, "App-Version inkompatibel");
  assert.equal(firstRuntime.reloads.length, 1);
  assert.ok(storageValues.has("epiber-app-version-reload"));
  const secondRuntime = loadDataClient({ storageValues });
  t.after(() => secondRuntime.api.disconnect());
  let latestStatus;
  secondRuntime.api.onConnectionState((status) => { latestStatus = status; });
  const secondSocket = secondRuntime.sockets[0];
  secondSocket.open();
  await Promise.resolve();
  secondSocket.close(4406, "App-Version inkompatibel");
  assert.equal(secondRuntime.reloads.length, 0);
  assert.equal(latestStatus.state, "stopped");
  assert.equal(latestStatus.closeReason, "updates-required");
  assert.equal(latestStatus.terminalReason, "version-mismatch");
  assert.equal(latestStatus.statusText, "Seite neu laden");
  await assert.rejects(secondRuntime.api.restartConnection(), (error) => error.code === "TERMINAL_CONNECTION");
  assert.equal(secondRuntime.sockets.length, 1);
});

test("erfolgreiches Welcome entfernt den Versionskonflikt-Marker", (t) => {
  const storageValues = new Map([["epiber-app-version-reload", String(Date.now())]]);
  const runtime = loadDataClient({ storageValues });
  t.after(() => runtime.api.disconnect());
  const socket = runtime.sockets[0];
  socket.open();
  socket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  assert.equal(storageValues.has("epiber-app-version-reload"), false);
});

test("generischer 4406 ist terminal und kein Update-Hinweis", async (t) => {
  const runtime = loadDataClient();
  t.after(() => runtime.api.disconnect());
  let latestStatus;
  runtime.api.onConnectionState((status) => { latestStatus = status; });
  const socket = runtime.sockets[0];
  socket.open();
  await Promise.resolve();
  socket.close(4406, "Protokollversion inkompatibel");
  assert.equal(latestStatus.state, "stopped");
  assert.equal(latestStatus.closeReason, "connection-incompatible");
  assert.equal(latestStatus.statusText, "Seite neu laden");
  assert.equal(runtime.reloads.length, 0);
  let lateStatus;
  runtime.api.onConnectionState((status) => { lateStatus = status; });
  assert.equal(lateStatus.statusText, "Seite neu laden");
  await assert.rejects(runtime.api.restartConnection(), (error) => error.code === "TERMINAL_CONNECTION");
  assert.equal(runtime.sockets.length, 1);

  const recovered = runtime.api.restartConnection({ allowTerminal: true });
  const recoveredSocket = runtime.sockets[1];
  recoveredSocket.open();
  await Promise.resolve();
  recoveredSocket.receive({ type: "welcome", v: 2, protocol: 2, principal: { type: "anonymous", role: "anonymous" } });
  await recovered;
  runtime.api.disconnect();
  runtime.api.onConnectionState((status) => { lateStatus = status; });
  assert.equal(lateStatus.statusText, "Bitte kurz warten");
});

test("neue Requests werden offline sofort abgelehnt", async (t) => {
  const runtime = loadDataClient({ online: false });
  t.after(() => runtime.api.disconnect());
  assert.equal(runtime.sockets.length, 0);
  await assert.rejects(runtime.api.request("players", {}), (error) => {
    assert.equal(error.code, "OFFLINE");
    assert.match(error.message, /offline/);
    return true;
  });
  assert.equal(runtime.timeouts.size, 0);
});

test("wartende Requests werden beim Offline-Ereignis sofort abgelehnt", async (t) => {
  const runtime = loadDataClient();
  t.after(() => runtime.api.disconnect());
  const request = runtime.api.request("players", {});
  runtime.navigator.onLine = false;
  runtime.windowListeners.get("offline")();
  await assert.rejects(request, (error) => error.code === "OFFLINE");
});

test("gesperrter Session-Storage verursacht keine Reloadschleife", async (t) => {
  const blockedStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  const runtime = loadDataClient({ sessionStorage: blockedStorage });
  t.after(() => runtime.api.disconnect());
  let latestStatus;
  runtime.api.onConnectionState((status) => { latestStatus = status; });
  const socket = runtime.sockets[0];
  socket.open();
  await Promise.resolve();
  socket.close(4406, "App-Version inkompatibel");
  assert.equal(runtime.reloads.length, 0);
  assert.equal(latestStatus.state, "stopped");
  assert.equal(latestStatus.terminalReason, "version-mismatch");
});
