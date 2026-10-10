"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { runMigrations } = require("../db/migrationRunner");
const { applyTechnicalSeed } = require("../db/seedRunner");
const { startPostgresTestCluster } = require("./postgresTestCluster");

test("Migration Runner baut und verifiziert eine leere PostgreSQL-18-Datenbank", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  const events = [];
  const output = (line) => events.push(JSON.parse(line));

  const initial = await runMigrations({
    connectionConfig: cluster.connectionConfig,
    command: "status",
    output,
  });
  assert.equal(initial.generation, 0);
  assert.deepEqual(initial.pending.map(({ id }) => id), [1, 2, 3, 4, 5, 6]);

  await runMigrations({
    connectionConfig: cluster.connectionConfig,
    command: "up",
    targetGeneration: 6,
    output,
  });
  const verified = await runMigrations({
    connectionConfig: cluster.connectionConfig,
    command: "verify",
    targetGeneration: 6,
    output,
  });
  assert.equal(verified.generation, 6);
  assert.deepEqual(verified.pending, []);

  const client = new Client(cluster.connectionConfig);
  await client.connect();
  try {
    const result = await client.query(`
      SELECT max(migration_id) AS migration_id,
             bool_and(result = 'success') AS successful,
             to_regclass('core.tenants') AS tenants,
             to_regclass('ops.import_runs') AS import_runs,
             to_regclass('identity.people') AS people,
             to_regclass('identity.sessions') AS sessions,
             to_regclass('play.matches') AS matches,
             to_regclass('play.ranking_entries') AS rankings,
             to_regclass('venue.court_live_state') AS court_state,
             to_regclass('venue.hall_time_allocations') AS hall_allocations,
             to_regclass('messaging.events') AS message_events,
             to_regclass('ops.idempotency_operations') AS operations
        FROM ops.schema_migrations
       GROUP BY tenants, import_runs, people, sessions, matches, rankings, court_state, hall_allocations, message_events, operations
    `);
    assert.deepEqual(result.rows, [{
      migration_id: 6,
      successful: true,
      tenants: "core.tenants",
      import_runs: "ops.import_runs",
      people: "identity.people",
      sessions: "identity.sessions",
      matches: "play.matches",
      rankings: "play.ranking_entries",
      court_state: "venue.court_live_state",
      hall_allocations: "venue.hall_time_allocations",
      message_events: "messaging.events",
      operations: "ops.idempotency_operations",
    }]);
    const publicCreate = await client.query("SELECT has_schema_privilege('public', 'public', 'CREATE') AS allowed");
    assert.equal(publicCreate.rows[0].allowed, false);
  } finally {
    await client.end();
  }

  assert.ok(events.some(({ event, result }) => event === "db_migration_completed" && result === "success"));
  assert.equal(JSON.stringify(events).includes("postgres-password"), false);

  const seedEvents = [];
  const seeded = await applyTechnicalSeed({
    connectionConfig: cluster.connectionConfig,
    asOf: "2026-10-10T00:00:00.000Z",
    output: (line) => seedEvents.push(JSON.parse(line)),
  });
  assert.match(seeded.checksum, /^[0-9a-f]{64}$/);
  const seedClient = new Client(cluster.connectionConfig);
  await seedClient.connect();
  try {
    const seedState = await seedClient.query(`
      SELECT t.tenant_code, s.section_code, r.result
        FROM core.tenants t
        JOIN core.sections s ON s.tenant_id = t.id
        JOIN ops.seed_runs r ON r.tenant_id = t.id
    `);
    assert.deepEqual(seedState.rows, [{ tenant_code: "devel-epiber", section_code: "tennis", result: "success" }]);
  } finally {
    await seedClient.end();
  }
  await assert.rejects(() => applyTechnicalSeed({
    connectionConfig: cluster.connectionConfig,
    asOf: "2026-10-10T00:00:00.000Z",
    output: () => {},
  }), (error) => error.code === "SEED_DATABASE_NOT_EMPTY");
  assert.ok(seedEvents.some(({ event, result }) => event === "db_seed_completed" && result === "success"));
});
