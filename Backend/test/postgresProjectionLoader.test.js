"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { setTestEnvironment } = require("./helpers.js");
setTestEnvironment();
const { TABLE_NAMES } = require("../config.js");
const dataStore = require("../dataStore.js");
const { PostgresProjectionLoader } = require("../postgresProjectionLoader.js");
const { PostgresPlayService } = require("../postgresPlayService.js");
const metrics = require("../metrics.js");

const tables = (value) => Object.fromEntries(TABLE_NAMES.map((table) => [table, [["ID"], [value]]]));
const gate = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test.beforeEach(() => { dataStore.resetForTests(); metrics.resetForTests(); });

test("PostgreSQL-Refresh holt eine nach Loadbeginn angeforderte Generation ohne parallelen Load nach", async () => {
  const firstStarted = gate(), firstDone = gate();
  let source = "before", calls = 0, active = 0, maximum = 0;
  const loader = new PostgresProjectionLoader({ dataStore, projectionService: { async load() {
    active++; maximum = Math.max(maximum, active);
    const snapshot = tables(source);
    if (++calls === 1) { firstStarted.resolve(); await firstDone.promise; }
    active--;
    return snapshot;
  } } });
  const initial = loader.initialLoad();
  await firstStarted.promise;
  source = "after-commit";
  const refresh = loader.refresh("invalidation");
  assert.equal(loader.getStatus().active, true);
  assert.ok(loader.getStatus().inProgress.startedAt);
  firstDone.resolve();
  await Promise.all([initial, refresh]);
  assert.equal(calls, 2);
  assert.equal(maximum, 1);
  assert.equal(dataStore.get("players")[1][0], "after-commit");
  assert.equal(loader.getStatus().inProgress, null);
});

test("PostgreSQL-Refresh benachrichtigt jede Projektion einmal und erst nach dem atomaren Snapshot", async (t) => {
  const observed = [];
  const unsubscribe = dataStore.onChange(({ table }) => {
    assert.ok(TABLE_NAMES.every((name) => dataStore.get(name)[1]?.[0] === "current"));
    observed.push(table);
  });
  t.after(unsubscribe);
  const loader = new PostgresProjectionLoader({ dataStore, projectionService: { load: async () => tables("current") } });
  const first = await loader.initialLoad();
  assert.equal(first.tableCount, 8);
  assert.deepEqual(observed.sort(), [...TABLE_NAMES].sort());
  observed.length = 0;
  assert.deepEqual((await loader.refresh("invalidation")).changedTables, []);
  assert.deepEqual(observed, []);
});

test("Loadfehler erhalten Last-good, kontrollierte Statusdaten und Abschlusslogs; Retry ist moeglich", async () => {
  const logs = [];
  let fail = false;
  const loader = new PostgresProjectionLoader({ dataStore, log: (level, event, fields) => logs.push({ level, event, fields }), projectionService: { load() {
    if (fail) throw Object.assign(new Error("PRIVATE_PAYLOAD password=secret"), { code: "bad private code" });
    return tables("last-good");
  } } });
  await loader.initialLoad();
  const loadedAt = loader.getStatus().lastSuccessfulRefreshAt;
  fail = true;
  await assert.rejects(loader.refresh("admin-request"));
  assert.equal(loader.active, null);
  assert.equal(dataStore.get("players")[1][0], "last-good");
  assert.equal(loader.getStatus().lastSuccessfulRefreshAt, loadedAt);
  assert.equal(loader.getStatus().lastControlledFailure.code, "POSTGRES_PROJECTION_REFRESH_FAILED");
  assert.doesNotMatch(JSON.stringify({ status: loader.getStatus(), logs }), /PRIVATE_PAYLOAD|password=secret|bad private code/);
  assert.match(metrics.render(), /epiber_projection_refresh_operations_total\{reason="admin-request",result="failed"\} 1/);
  fail = false;
  await loader.refresh("admin-request");
  assert.equal(loader.getStatus().lastControlledFailure, null);
});

test("Shutdown wartet auf akzeptierte Projektionsloads und lehnt neue ab", async () => {
  const done = gate(), started = gate();
  const loader = new PostgresProjectionLoader({ dataStore, projectionService: { async load() { started.resolve(); await done.promise; return tables("final"); } } });
  const load = loader.initialLoad();
  await started.promise;
  const stop = loader.stop();
  await assert.rejects(loader.refresh("admin-request"), { code: "SHUTTING_DOWN" });
  done.resolve();
  await Promise.all([load, stop]);
  assert.equal(loader.getStatus().active, false);
});

test("Admin-Cache-Refresh verwendet den Loaderzeitpunkt, prueft Rollen und gibt keine DB-Fehler frei", async () => {
  let calls = 0;
  const service = new PostgresPlayService({ projectionLoader: { async refresh() {
    calls++;
    return { tableCount: 8, changedTables: ["players"], refreshedAt: 1234 };
  } } });
  await assert.rejects(service.refreshProjections({ role: "player" }, { operationId: "op" }), { code: "FORBIDDEN" });
  assert.equal(calls, 0);
  assert.deepEqual(await service.refreshProjections({ role: "admin" }, { operationId: "op" }), {
    success: true, operationId: "op", tableCount: 8, changedTableCount: 1, refreshedAt: 1234,
  });
  service.projectionLoader.refresh = async () => { throw new Error("PRIVATE_SQL_AND_PERSON_DATA"); };
  await assert.rejects(service.refreshProjections({ role: "admin" }, { operationId: "op" }), (error) => {
    assert.equal(error.code, "DATA_REFRESH_FAILED");
    assert.doesNotMatch(error.message, /PRIVATE_SQL/);
    return true;
  });
});
