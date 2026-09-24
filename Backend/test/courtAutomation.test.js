const test = require("node:test");
const assert = require("node:assert/strict");
const { setTestEnvironment } = require("./helpers.js");

setTestEnvironment();
const { CourtAutomation, pendingActivation } = require("../courtAutomation.js");

function harness({ now, court1, matches, graceMs, auditFails = false } = {}) {
  let currentNow = now || new Date(2026, 8, 24, 17, 0).getTime();
  const stateListeners = new Set();
  const dataListeners = new Set();
  const courts = {
    "1": { matchId: "", aktiv: 0, automaticActivation: null, revision: 1, ...(court1 || {}) },
    "2": { matchId: "", aktiv: 0, automaticActivation: null, revision: 1 },
  };
  let matchValues = matches || [["ID", "MatchDate", "Ergebnis"]];
  let timer = null;
  const pollingStates = [];
  const auditEvents = [];
  const logs = [];
  const stateStore = {
    getCourt(court) { return structuredClone(courts[court]); },
    getScoreboardCourts() { return structuredClone(courts); },
    setScoreboardCourt(court, data, expectedRevision) {
      if (courts[court].revision !== expectedRevision) throw Object.assign(new Error("Revision"), { code: "REVISION_CONFLICT" });
      courts[court] = { ...courts[court], ...structuredClone(data), revision: expectedRevision + 1 };
      for (const listener of stateListeners) listener({ type: "court", court, value: courts[court] });
      return structuredClone(courts[court]);
    },
    onChange(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener); },
  };
  const dataStore = {
    get(table) { return table === "matches1" ? matchValues : []; },
    onChange(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
  };
  const automation = new CourtAutomation({
    stateStore,
    dataStore,
    courtPoller: { setCourtActive(value) { pollingStates.push(value); } },
    auditLogRepository: { record(event) {
      if (auditFails) throw Object.assign(new Error("Audit nicht verfuegbar"), { code: "AUDIT_LOG_UNAVAILABLE" });
      auditEvents.push(structuredClone(event));
    } },
    now: () => currentNow,
    setTimer(callback, delay) { timer = { callback, delay, cleared: false }; return timer; },
    clearTimer(handle) { handle.cleared = true; if (timer === handle) timer = null; },
    log(level, event, fields) { logs.push({ level, event, fields }); },
    graceMs,
  });
  return {
    automation,
    auditEvents,
    courts,
    logs,
    pollingStates,
    get timer() { return timer; },
    setNow(value) { currentNow = value; },
    setAuditFailure(value) { auditFails = value; },
    setMatches(value) {
      matchValues = value;
      for (const listener of dataListeners) listener({ table: "matches1", current: true, changed: true });
    },
  };
}

test("vorgewaehltes Match wird zum Termin aktiviert und nur einmal verbraucht", () => {
  const matchDate = "260924-1800";
  const dueAt = new Date(2026, 8, 24, 18, 0).getTime();
  const runtime = harness({
    now: new Date(2026, 8, 24, 17, 0).getTime(),
    court1: { matchId: "m1", automaticActivation: pendingActivation("m1", matchDate) },
    matches: [["ID", "MatchDate", "Ergebnis"], ["m1", matchDate, ""]],
  });

  runtime.automation.start();
  assert.equal(runtime.timer.delay, 60 * 60 * 1000);
  runtime.setNow(dueAt);
  runtime.timer.callback();

  assert.equal(runtime.courts["1"].aktiv, 1);
  assert.equal(runtime.courts["1"].automaticActivation.status, "activated");
  assert.deepEqual(runtime.pollingStates.at(-1), { "1": true, "2": false });
  assert.deepEqual(runtime.auditEvents.filter((event) => event.action === "courtAutomaticActivation").map((event) => event.result), ["started", "success"]);

  runtime.courts["1"].aktiv = 0;
  runtime.automation.reconcile("manual-check");
  assert.equal(runtime.courts["1"].aktiv, 0);
  runtime.automation.stop();
});

test("verpasster Start ausserhalb des Wiederanlauffensters bleibt inaktiv", () => {
  const matchDate = "260924-1800";
  const runtime = harness({
    now: new Date(2026, 8, 24, 18, 31).getTime(),
    court1: { matchId: "m1", automaticActivation: pendingActivation("m1", matchDate) },
    matches: [["ID", "MatchDate", "Ergebnis"], ["m1", matchDate, ""]],
  });

  runtime.automation.start();

  assert.equal(runtime.courts["1"].aktiv, 0);
  assert.equal(runtime.courts["1"].automaticActivation.status, "expired");
  assert.equal(runtime.logs.some((entry) => entry.fields?.errorCode === "ACTIVATION_WINDOW_EXPIRED"), true);
  runtime.automation.stop();
});

test("bestaetigtes Ergebnis deaktiviert nur den weiterhin zugewiesenen Platz", () => {
  const matchDate = "260924-1800";
  const runtime = harness({
    now: new Date(2026, 8, 24, 19, 30).getTime(),
    court1: {
      matchId: "m1",
      aktiv: 1,
      automaticActivation: { ...pendingActivation("m1", matchDate), status: "activated" },
    },
    matches: [["ID", "MatchDate", "Ergebnis"], ["m1", matchDate, "6-4/6-4"]],
  });

  runtime.automation.start();

  assert.equal(runtime.courts["1"].aktiv, 0);
  assert.equal(runtime.courts["1"].automaticActivation.status, "finished");
  assert.deepEqual(runtime.auditEvents.filter((event) => event.action === "courtAutomaticDeactivation").map((event) => event.result), ["started", "success"]);

  runtime.setMatches([["ID", "MatchDate", "Ergebnis"], ["m1", matchDate, ""]]);
  assert.equal(runtime.courts["1"].aktiv, 0);
  assert.equal(runtime.courts["1"].automaticActivation.status, "finished");
  runtime.automation.stop();
});

test("Walkover ohne Satzergebnis gilt als bestaetigter Abschluss", () => {
  const matchDate = "260924-1800";
  const runtime = harness({
    now: new Date(2026, 8, 24, 18, 10).getTime(),
    court1: {
      matchId: "m1",
      aktiv: 1,
      automaticActivation: { ...pendingActivation("m1", matchDate), status: "activated" },
    },
    matches: [
      ["ID", "MatchDate", "Ergebnis", "Spieler1ID", "Spieler3ID"],
      ["m1", matchDate, "", "p1", "p2[wo]"],
    ],
  });

  runtime.automation.start();

  assert.equal(runtime.courts["1"].aktiv, 0);
  assert.equal(runtime.courts["1"].automaticActivation.status, "finished");
  runtime.automation.stop();
});

test("transienter Auditfehler verschiebt die Aktivierung bis zum kontrollierten Retry", () => {
  const matchDate = "260924-1800";
  const runtime = harness({
    now: new Date(2026, 8, 24, 18, 0).getTime(),
    court1: { matchId: "m1", automaticActivation: pendingActivation("m1", matchDate) },
    matches: [["ID", "MatchDate", "Ergebnis"], ["m1", matchDate, ""]],
    auditFails: true,
  });

  runtime.automation.start();

  assert.equal(runtime.courts["1"].aktiv, 0);
  assert.equal(runtime.timer.delay, 5_000);
  runtime.setAuditFailure(false);
  runtime.setNow(new Date(2026, 8, 24, 18, 0, 5).getTime());
  runtime.timer.callback();
  assert.equal(runtime.courts["1"].aktiv, 1);
  runtime.automation.stop();
});

test("Terminaenderung schaltet eine noch offene Vorwahl auf den neuen Termin um", () => {
  const runtime = harness({
    now: new Date(2026, 8, 24, 17, 0).getTime(),
    court1: { matchId: "m1", automaticActivation: pendingActivation("m1", "260924-1800") },
    matches: [["ID", "MatchDate", "Ergebnis"], ["m1", "260924-1900", ""]],
  });

  runtime.automation.start();

  assert.equal(runtime.courts["1"].automaticActivation.matchDate, "260924-1900");
  assert.equal(runtime.courts["1"].automaticActivation.status, "pending");
  assert.equal(runtime.courts["1"].dateTime, "260924-1900");
  assert.equal(runtime.timer.delay, 0);
  runtime.timer.callback();
  assert.equal(runtime.timer.delay, 2 * 60 * 60 * 1000);
  runtime.automation.stop();
});
