"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WorkerService } = require("../workerService");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("Worker buendelt Wake-Signale und drainiert aktive Wartungsplanung vor Stop", async () => {
  const gate = deferred();
  let schedules = 0, claims = 0, unsubscribed = 0;
  const worker = new WorkerService({
    repository: { ensureMaintenanceJobs: async () => { schedules++; await gate.promise; }, claimJob: async () => { claims++; return null; }, claimOutbox: async () => null },
    subscribe: async (wake) => { wake(); wake(); return () => { unsubscribed++; }; },
  });
  worker.start(); worker.wake(); worker.wake();
  await flush();
  assert.equal(schedules, 1);
  let stopped = false;
  const stop = worker.stop().then(() => { stopped = true; });
  await flush(); assert.equal(stopped, false);
  gate.resolve(); await stop;
  assert.equal(claims, 0); assert.equal(unsubscribed, 1); assert.equal(worker.timer, null);
});

test("Worker behaelt genau eine Claim-Kette und plant ohne Neustart ueber Zeitgrenzen", async (t) => {
  let now = Date.parse("2026-10-23T23:59:00Z"), active = 0, peak = 0, claims = 0;
  const times = [], logs = [];
  const gate = deferred();
  const worker = new WorkerService({ now: () => now, pollMs: 100_000,
    repository: {
      ensureMaintenanceJobs: async (time) => { times.push(time.toISOString()); return { scheduled: 2 }; },
      claimJob: async () => { claims++; active++; peak = Math.max(peak, active); if (claims === 1) await gate.promise; active--; return null; },
      claimOutbox: async () => null,
    }, log: (level, event, fields) => logs.push({ level, event, fields }),
  });
  t.after(() => worker.stop());
  worker.start(); await flush(); worker.wake(); worker.wake(); await flush();
  assert.equal(claims, 1); gate.resolve(); await flush();
  // Consume the coalesced follow-up, without depending on real timer ordering.
  worker.wake(); await flush();
  assert.equal(peak, 1); assert.equal(times.length, 1);
  for (const elapsed of [60_000, 15 * 60_000, 60 * 60_000, 24 * 60 * 60_000]) {
    now += elapsed; worker.wake(); worker.wake(); await flush();
  }
  assert.equal(times.length, 5); assert.equal(peak, 1);
  assert.equal(logs.filter(({ event }) => event === "postgres_worker_maintenance_schedule_completed").length, 5);
  await worker.stop(); assert.equal(worker.timer, null);
});

test("Worker retryt Wartungsfehler, bereinigt spaeten Listener und gibt keine Rohfehler frei", async () => {
  const listener = deferred(); let unsubscriptions = 0, attempts = 0;
  const logs = [];
  const worker = new WorkerService({ repository: {
    ensureMaintenanceJobs: async () => { if (++attempts === 1) throw { code: "private-password" }; return { scheduled: 0 }; },
    claimJob: async () => null, claimOutbox: async () => null,
  }, subscribe: () => listener.promise, log: (level, event, fields) => logs.push({ level, event, fields }) });
  worker.start(); await flush(); worker.wake(); await flush(); assert.equal(attempts, 2);
  const stop = worker.stop(); listener.resolve(() => { unsubscriptions++; }); await stop;
  assert.equal(unsubscriptions, 1); assert.equal(worker.timer, null);
  assert.equal(JSON.stringify(logs).includes("private-password"), false);
});
