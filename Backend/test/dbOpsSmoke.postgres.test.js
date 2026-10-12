"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { createWorkerRuntime } = require("../db/createWorkerRuntime");
const { runOpsSmoke } = require("../db/opsSmoke");
const { runMigrations } = require("../db/migrationRunner");
const { applyTechnicalSeed } = require("../db/seedRunner");
const { createWorkerHandlers } = require("../workerHandlers");
const { WorkerService } = require("../workerService");
const { startPostgresTestCluster } = require("./postgresTestCluster");

test("technischer Ops-Smoke prueft Commit, Idempotenz, Outbox, Worker und Cleanup ohne Fachobjekt", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  const runtime = createWorkerRuntime({ connectionConfig: cluster.connectionConfig, expectedTenantCode: "devel-epiber" });
  const repositories = await runtime.connect();
  t.after(() => runtime.close());
  const handlers = createWorkerHandlers(repositories.ops);
  const worker = new WorkerService({ repository: repositories.ops, workerId: "ops-smoke-test", ...handlers });
  const lines = [];
  const result = await runOpsSmoke({
    appConnectionConfig: cluster.connectionConfig,
    cleanupConnectionConfig: cluster.connectionConfig,
    tenantCode: "devel-epiber",
    output: (line) => lines.push(JSON.parse(line)),
    afterCommit: () => worker.runOnce(),
  });
  assert.equal(result.cleaned, true);
  assert.equal(lines.at(-1).result, "success");
  const client = new Client(cluster.connectionConfig); await client.connect();
  assert.equal((await client.query("SELECT count(*)::integer AS count FROM ops.idempotency_operations WHERE command='ops.smoke'")).rows[0].count, 0);
  assert.equal((await client.query("SELECT count(*)::integer AS count FROM ops.outbox WHERE idempotency_key LIKE 'ops-smoke:%'")).rows[0].count, 0);
  assert.equal((await client.query("SELECT count(*)::integer AS count FROM play.matches")).rows[0].count, 0);
  await client.end();
});
