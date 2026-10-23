"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { createWorkerRuntime } = require("../db/createWorkerRuntime");
const { runMigrations } = require("../db/migrationRunner");
const { applyFullDevelSeed, applyTechnicalSeed } = require("../db/seedRunner");
const { WorkerService } = require("../workerService");
const { createWorkerHandlers } = require("../workerHandlers");
const { createWorkerApplication } = require("../worker");
const { startPostgresTestCluster } = require("./postgresTestCluster");

async function fixture(t) {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  const client = new Client(cluster.connectionConfig);
  await client.connect();
  t.after(() => client.end());
  await client.query("UPDATE ops.jobs SET status='success', lease_owner=NULL, lease_until=NULL, completed_at=clock_timestamp()");
  await client.query("UPDATE ops.outbox SET status='sent', lease_owner=NULL, lease_until=NULL, completed_at=clock_timestamp()");
  const events = [];
  const runtime = createWorkerRuntime({
    connectionConfig: { ...cluster.connectionConfig, application_name: "epiber-worker-test" },
    expectedTenantCode: "devel-epiber",
    log: (level, event, fields) => events.push({ level, event, fields }),
  });
  t.after(() => runtime.close());
  const repositories = await runtime.connect();
  return { client, events, repository: repositories.ops };
}

test("PostgreSQL-Worker verarbeitet registrierte Jobs und Outbox mit Lease und Abschlussstatus", { timeout: 30_000 }, async (t) => {
  const { client, events, repository } = await fixture(t);
  await client.query(`
    INSERT INTO ops.jobs(tenant_id, job_type, payload_version, payload, idempotency_key, status, available_at)
    VALUES ('0199c800-0000-7000-8000-000000000001', 'test.job', 1, '{"value":1}', 'worker-job-success', 'pending', clock_timestamp())
  `);
  await client.query(`
    INSERT INTO ops.outbox(tenant_id, event_type, payload_version, payload, idempotency_key, status, available_at)
    VALUES ('0199c800-0000-7000-8000-000000000001', 'test.outbox', 1, '{"value":2}', 'worker-outbox-success', 'pending', clock_timestamp())
  `);
  const handled = [];
  const service = new WorkerService({
    repository,
    workerId: "worker-test-success",
    jobs: { "test.job": { version: 1, run: async ({ payload }) => handled.push(["job", payload.value]) } },
    outbox: { "test.outbox": { version: 1, run: async ({ payload }) => handled.push(["outbox", payload.value]) } },
    log: (level, event, fields) => events.push({ level, event, fields }),
  });
  assert.equal(await service.runOnce(), true);
  assert.equal(await service.runOnce(), true);
  assert.deepEqual(handled, [["job", 1], ["outbox", 2]]);
  const states = await client.query(`
    SELECT (SELECT status FROM ops.jobs WHERE idempotency_key='worker-job-success') AS job,
           (SELECT status FROM ops.outbox WHERE idempotency_key='worker-outbox-success') AS outbox
  `);
  assert.deepEqual(states.rows[0], { job: "success", outbox: "sent" });
  assert.equal(events.some(({ event, fields }) => event === "postgres_job_completed" && fields.result === "success"), true);
  assert.equal(events.some(({ event, fields }) => event === "postgres_outbox_completed" && fields.result === "success"), true);
  assert.equal(JSON.stringify(events).includes("\"value\""), false);
});

test("PostgreSQL-Worker beendet unbekannte Jobs und Outbox fail-closed", { timeout: 30_000 }, async (t) => {
  const { client, repository } = await fixture(t);
  await client.query(`
    INSERT INTO ops.jobs(tenant_id, job_type, payload_version, payload, idempotency_key, status, available_at)
    VALUES ('0199c800-0000-7000-8000-000000000001', 'unknown.job', 1, '{}', 'worker-job-unknown', 'pending', clock_timestamp())
  `);
  await client.query(`
    INSERT INTO ops.outbox(tenant_id, event_type, payload_version, payload, idempotency_key, status, available_at)
    VALUES ('0199c800-0000-7000-8000-000000000001', 'unknown.outbox', 1, '{}', 'worker-outbox-unknown', 'pending', clock_timestamp())
  `);
  const service = new WorkerService({ repository, workerId: "worker-test-unknown" });
  await service.runOnce();
  await service.runOnce();
  const states = await client.query(`
    SELECT (SELECT status FROM ops.jobs WHERE idempotency_key='worker-job-unknown') AS job,
           (SELECT last_error_code FROM ops.jobs WHERE idempotency_key='worker-job-unknown') AS "jobError",
           (SELECT status FROM ops.outbox WHERE idempotency_key='worker-outbox-unknown') AS outbox,
           (SELECT last_error_code FROM ops.outbox WHERE idempotency_key='worker-outbox-unknown') AS "outboxError"
  `);
  assert.deepEqual(states.rows[0], {
    job: "dead",
    jobError: "JOB_HANDLER_NOT_REGISTERED",
    outbox: "unknown",
    outboxError: "OUTBOX_HANDLER_NOT_REGISTERED",
  });
});

test("PostgreSQL-Worker projiziert interne Outbox-Invalidierung nur als NOTIFY-Weckhinweis", { timeout: 30_000 }, async (t) => {
  const { client, repository } = await fixture(t);
  let resolveNotification;
  const notification = new Promise((resolve) => { resolveNotification = resolve; });
  client.on("notification", (message) => {
    if (message.channel === "epiber_app_invalidate") resolveNotification(JSON.parse(message.payload));
  });
  await client.query("LISTEN epiber_app_invalidate");
  await client.query(`
    INSERT INTO ops.outbox(tenant_id, event_type, payload_version, payload, idempotency_key, status, available_at)
    VALUES ('0199c800-0000-7000-8000-000000000001', 'websocket.invalidate', 1,
            '{"eventId":"event-runtime","projection":"messaging"}', 'worker-invalidation', 'pending', clock_timestamp())
  `);
  const handlers = createWorkerHandlers(repository);
  const service = new WorkerService({ repository, workerId: "worker-test-invalidation", ...handlers });
  assert.equal(await service.runOnce(), true);
  const payload = await Promise.race([notification, new Promise((_, reject) => setTimeout(() => reject(new Error("NOTIFY_TIMEOUT")), 2_000))]);
  assert.deepEqual(payload, { eventId: "event-runtime", projection: "messaging" });
  const state = await client.query("SELECT status FROM ops.outbox WHERE idempotency_key='worker-invalidation'");
  assert.equal(state.rows[0].status, "sent");
});

test("PostgreSQL-Worker registriert und verarbeitet die begrenzten Retentionklassen", { timeout: 30_000 }, async (t) => {
  const { client, repository } = await fixture(t);
  await repository.ensureMaintenanceJobs(new Date("2026-10-12T02:15:00.000Z"));
  assert.equal((await repository.ensureMaintenanceJobs(new Date("2026-10-12T02:15:00.000Z"))).scheduled, 0);
  const scheduled = await client.query("SELECT job_type FROM ops.jobs WHERE status='pending' ORDER BY job_type");
  assert.deepEqual(scheduled.rows.map(({ job_type: type }) => type), [
    "hall_time.expire_waitlists", "retention.daily", "retention.hourly", "retention.short",
  ]);
  const handlers = createWorkerHandlers(repository);
  const service = new WorkerService({ repository, workerId: "worker-test-retention", ...handlers });
  for (let index = 0; index < 4; index++) assert.equal(await service.runOnce(), true);
  const completed = await client.query("SELECT count(*)::int AS count FROM ops.jobs WHERE job_type=ANY($1::text[]) AND status='success'", [["retention.short", "retention.hourly", "retention.daily", "hall_time.expire_waitlists"]]);
  assert.equal(completed.rows[0].count, 4);
  for (const [time, count] of [
    ["2026-10-12T02:29:59.999Z", 0],
    ["2026-10-12T02:30:00.000Z", 2],
    ["2026-10-12T03:00:00.000Z", 3],
    ["2026-10-13T02:14:59.999Z", 3],
    ["2026-10-13T02:15:00.000Z", 3],
  ]) {
    assert.equal((await repository.ensureMaintenanceJobs(new Date(time))).scheduled, count, time);
    assert.equal((await repository.ensureMaintenanceJobs(new Date(time))).scheduled, 0, `${time}: replay`);
  }
});

test("PostgreSQL-Workerprozess startet fail-closed und beendet Listener sowie Pool kontrolliert", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  const events = [];
  let resolveCompleted;
  const completed = new Promise((resolve) => { resolveCompleted = resolve; });
  const logger = {
    log(level, event, fields = {}) {
      events.push({ level, event, fields });
      if (event === "postgres_outbox_completed" && fields.result === "success") resolveCompleted();
    },
    flush: async () => {},
  };
  const application = await createWorkerApplication({
    env: {
      PGHOST: cluster.connectionConfig.host,
      PGPORT: String(cluster.connectionConfig.port),
      PGDATABASE: cluster.connectionConfig.database,
      PGUSER: cluster.connectionConfig.user,
      EPIBER_TENANT_CODE: "devel-epiber",
    },
    log: logger,
  });
  t.after(() => application.stop("test-cleanup").catch(() => {}));
  await application.start();
  const client = new Client(cluster.connectionConfig);
  await client.connect();
  try {
    await client.query(`
      INSERT INTO ops.outbox(tenant_id, event_type, payload_version, payload, idempotency_key, status, available_at)
      VALUES ('0199c800-0000-7000-8000-000000000001', 'websocket.invalidate', 1,
              '{"eventId":"event-process","projection":"play"}', 'worker-process', 'pending', clock_timestamp())
    `);
    await client.query("SELECT pg_notify('epiber_worker_wake','')");
    await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error("WORKER_TIMEOUT")), 3_000))]);
    assert.equal((await client.query("SELECT status FROM ops.outbox WHERE idempotency_key='worker-process'")).rows[0].status, "sent");
  } finally {
    await client.end();
  }
  await application.stop("test");
  assert.equal(application.runtime.status().ready, false);
  assert.equal(events.some(({ event }) => event === "postgres_worker_stopped"), true);
});
