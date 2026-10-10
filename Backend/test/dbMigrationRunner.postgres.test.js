"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { runMigrations } = require("../db/migrationRunner");
const { applyFullDevelSeed, applyTechnicalSeed } = require("../db/seedRunner");
const { verifySchemaSnapshot } = require("../db/schemaSnapshot");
const { applyBootstrap, verifyBootstrap } = require("../db/bootstrap");
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
  assert.match(verifySchemaSnapshot(cluster.connectionConfig), /CREATE TABLE core\.tenants/);

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
  const fullSeed = await applyFullDevelSeed({
    connectionConfig: cluster.connectionConfig,
    asOf: "2026-10-10T00:00:00.000Z",
    output: () => {},
  });
  assert.match(fullSeed.checksum, /^[0-9a-f]{64}$/);
  const fullClient = new Client(cluster.connectionConfig);
  await fullClient.connect();
  try {
    const counts = await fullClient.query(`
      SELECT (SELECT count(*) FROM identity.people) AS people,
             (SELECT count(*) FROM play.matches) AS matches,
             (SELECT count(*) FROM venue.hall_time_allocations) AS allocations,
             (SELECT count(*) FROM messaging.events) AS events,
             (SELECT count(*) FROM ops.seed_runs WHERE result = 'success') AS seed_runs
    `);
    assert.deepEqual(counts.rows[0], { people: "5", matches: "1", allocations: "2", events: "1", seed_runs: "2" });
  } finally {
    await fullClient.end();
  }
});

test("Bootstrap trennt Owner, Migration und Laufzeitrollen mit minimalen Grants", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  const prefix = "epiber_test";
  const database = "epiber_role_test";
  const passwords = Object.fromEntries(
    ["migrator", "app", "worker", "monitor", "backup", "refresh"].map((suffix) => [suffix, `test-${suffix}-password`]),
  );

  const prepared = await applyBootstrap({
    adminConnectionConfig: cluster.connectionConfig,
    prefix,
    database,
    passwords,
    output: () => {},
  });
  assert.equal(prepared.grantsApplied, false);

  const migrationConnection = {
    ...cluster.connectionConfig,
    database,
    user: prepared.names.migrator,
    password: passwords.migrator,
    options: `-c role=${prepared.names.owner}`,
  };
  await runMigrations({ connectionConfig: migrationConnection, command: "up", targetGeneration: 6, output: () => {} });

  const granted = await applyBootstrap({
    adminConnectionConfig: cluster.connectionConfig,
    prefix,
    database,
    passwords,
    output: () => {},
  });
  assert.equal(granted.grantsApplied, true);
  const checks = await verifyBootstrap({ adminConnectionConfig: cluster.connectionConfig, prefix, database });
  assert.ok(Object.values(checks).every(Boolean));
});
