"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { runMigrations } = require("../db/migrationRunner");
const { applyFullDevelSeed, applyTechnicalSeed, validateFullDevelSeed } = require("../db/seedRunner");
const { verifySchemaSnapshot } = require("../db/schemaSnapshot");
const { applyBootstrap, applyExistingDatabaseGrants, verifyBootstrap } = require("../db/bootstrap");
const { applyPersonalAccess, verifyPersonalAccess } = require("../db/personalAccess");
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
  assert.deepEqual(initial.pending.map(({ id }) => id), [1, 2, 3, 4, 5, 6, 7, 8]);

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
  const fullSeed = await applyFullDevelSeed({
    connectionConfig: cluster.connectionConfig,
    asOf: "2026-10-10T00:00:00.000Z",
    output: () => {},
  });
  assert.match(fullSeed.checksum, /^[0-9a-f]{64}$/);
  assert.match(fullSeed.projectionChecksum, /^[0-9a-f]{64}$/);
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
    assert.deepEqual(counts.rows[0], { people: "5", matches: "5", allocations: "2", events: "1", seed_runs: "2" });

    const baseTables = await fullClient.query(`
      SELECT table_schema, table_name
        FROM information_schema.tables
       WHERE table_schema IN ('core','identity','play','venue','messaging','ops')
         AND table_type = 'BASE TABLE'
         AND NOT (table_schema = 'ops' AND table_name IN ('import_runs','import_findings'))
       ORDER BY table_schema, table_name
    `);
    for (const { table_schema: schema, table_name: table } of baseTables.rows) {
      const populated = await fullClient.query(`SELECT count(*)::integer AS count FROM "${schema}"."${table}"`);
      assert.ok(populated.rows[0].count > 0, `${schema}.${table}`);
    }

    const scenarios = await fullClient.query(`
      SELECT
        (SELECT array_agg(DISTINCT completion_type ORDER BY completion_type) FROM play.match_results) AS result_types,
        (SELECT array_agg(DISTINCT status ORDER BY status) FROM ops.idempotency_operations) AS operation_states,
        (SELECT array_agg(DISTINCT status ORDER BY status) FROM ops.jobs) AS job_states,
        (SELECT array_agg(DISTINCT status ORDER BY status) FROM ops.outbox) AS outbox_states,
        (SELECT array_agg(DISTINCT transition ORDER BY transition) FROM ops.audit_transitions) AS audit_states,
        (SELECT array_agg(DISTINCT constraint_type ORDER BY constraint_type) FROM venue.hall_time_constraints) AS constraint_types,
        (SELECT count(*)::integer FROM venue.score_events) AS score_events,
        (SELECT count(*)::integer FROM venue.monitor_commands) AS monitor_commands,
        (SELECT count(*)::integer FROM messaging.comments) AS comments,
        (SELECT count(*)::integer FROM messaging.reactions) AS reactions
    `);
    assert.deepEqual(scenarios.rows[0], {
      result_types: ["regular", "retirement", "walkover"],
      operation_states: ["success", "unknown"],
      job_states: ["leased", "pending", "retrying"],
      outbox_states: ["pending", "unknown"],
      audit_states: ["started", "success", "unknown"],
      constraint_types: ["avoid", "unavailable"],
      score_events: 1,
      monitor_commands: 1,
      comments: 2,
      reactions: 2,
    });
    await assert.rejects(validateFullDevelSeed(fullClient, { version: 1, counts: { "identity.people": 4 } }), (error) => error.code === "SEED_PROJECTION_MISMATCH");
  } finally {
    await fullClient.end();
  }
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 7, output });
  assert.match(verifySchemaSnapshot(cluster.connectionConfig), /CREATE TABLE core\.tenants/);
});

test("Full-Devel-Seed verschiebt fachliche Zeitpunkte deterministisch mit as_of", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-11T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-11T00:00:00.000Z", output: () => {} });
  const client = new Client(cluster.connectionConfig);
  await client.connect();
  try {
    const shifted = await client.query(`
      SELECT starts_at, expires_at,
             (SELECT as_of FROM ops.seed_runs WHERE seed_name='full-devel') AS as_of
        FROM venue.hall_time_slots,
             identity.password_authorizations
       WHERE venue.hall_time_slots.id='0199c800-0000-7000-8000-000000000311'
         AND identity.password_authorizations.id='0199c800-0000-7000-8000-000000000132'
    `);
    assert.equal(shifted.rows[0].starts_at.toISOString(), "2026-11-02T17:00:00.000Z");
    assert.equal(shifted.rows[0].expires_at.toISOString(), "2026-10-12T00:00:00.000Z");
    assert.equal(shifted.rows[0].as_of.toISOString(), "2026-10-11T00:00:00.000Z");
  } finally { await client.end(); }
});

test("technischer Seed bindet den spaeteren Live-Tenant ohne eigenes Schema", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({
    connectionConfig: cluster.connectionConfig,
    asOf: "2026-10-12T00:00:00.000Z",
    tenantCode: "askoe-piberbach",
    tenantName: "ASKOE Piberbach Tennis",
    output: () => {},
  });
  const client = new Client(cluster.connectionConfig); await client.connect();
  assert.deepEqual((await client.query("SELECT tenant_code,display_name FROM core.tenants")).rows, [{ tenant_code: "askoe-piberbach", display_name: "ASKOE Piberbach Tennis" }]);
  await client.end();
});

test("zwei Full-Devel-Neuaufbauten erzeugen dieselbe kanonische Projektion", { timeout: 30_000 }, async (t) => {
  const checksums = [];
  for (let index = 0; index < 2; index += 1) {
    const cluster = startPostgresTestCluster();
    t.after(() => cluster.stop());
    await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
    await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-10T00:00:00.000Z", output: () => {} });
    const result = await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-10T00:00:00.000Z", output: () => {} });
    checksums.push(result.projectionChecksum);
    cluster.stop();
  }
  assert.match(checksums[0], /^[0-9a-f]{64}$/);
  assert.equal(checksums[0], checksums[1]);
});

test("Bootstrap trennt Owner, Migration und Laufzeitrollen mit minimalen Grants", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  const prefix = "epiber_test";
  const database = "epiber_role_test";
  const passwords = Object.fromEntries(
    ["migrator", "app", "worker", "monitor", "backup", "refresh", "app_readonly"].map((suffix) => [suffix, `test-${suffix}-password`]),
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

  await applyExistingDatabaseGrants({
    adminConnectionConfig: cluster.connectionConfig,
    prefix,
    database,
    readOnly: true,
    output: () => {},
  });
  const checks = await verifyBootstrap({ adminConnectionConfig: cluster.connectionConfig, prefix, database, passwords });
  assert.ok(Object.values(checks).every(Boolean));
  const readOnlyPassword = passwords.app_readonly;
  const readOnly = new Client({ ...cluster.connectionConfig, database, user: prepared.names.app_readonly, password: readOnlyPassword });
  await readOnly.connect();
  assert.equal((await readOnly.query("SELECT count(*) FROM identity.people")).rows[0].count, "0");
  await assert.rejects(readOnly.query("INSERT INTO identity.people(tenant_id,contract_id,last_name) VALUES ('0199c800-0000-7000-8000-000000000001','readonly-test','Blocked')"), (error) => error.code === "42501");
  await readOnly.end();
});

test("persoenliche Devel-Rollen lesen alle Tabellen und nur Admin besitzt DML", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  const prefix = "personal_access", database = "personal_access_test";
  const passwords = Object.fromEntries(
    ["migrator", "app", "worker", "monitor", "backup", "refresh"].map((suffix) => [suffix, `access-${suffix}`]),
  );
  const prepared = await applyBootstrap({ adminConnectionConfig: cluster.connectionConfig, prefix, database, passwords, output: () => {} });
  const ownerConnection = { ...cluster.connectionConfig, database, user: prepared.names.migrator, password: passwords.migrator, options: `-c role=${prepared.names.owner}` };
  await runMigrations({ connectionConfig: ownerConnection, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: ownerConnection, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await applyExistingDatabaseGrants({ adminConnectionConfig: cluster.connectionConfig, prefix, database, readOnly: false, output: () => {} });

  const readerRole = "personal_reader", adminRole = "personal_admin";
  const setup = new Client({ ...cluster.connectionConfig, database }); await setup.connect();
  await setup.query(`CREATE ROLE ${readerRole} LOGIN PASSWORD 'reader-pass' CREATEDB CREATEROLE`);
  await setup.query(`CREATE ROLE ${adminRole} LOGIN PASSWORD 'admin-pass' CREATEDB CREATEROLE`);
  await setup.end();
  const options = { adminConnectionConfig: cluster.connectionConfig, database, ownerRole: prepared.names.owner, readerRole, adminRole };
  const applied = await applyPersonalAccess({ ...options, output: () => {} });
  assert.ok(applied.tableCount > 0);

  const future = new Client({ ...cluster.connectionConfig, database }); await future.connect();
  await future.query(`SET ROLE ${prepared.names.owner}`);
  await future.query("CREATE TABLE play.personal_access_future(id bigserial PRIMARY KEY, value text)");
  await future.query("RESET ROLE");
  await future.end();
  const verified = await verifyPersonalAccess(options);
  assert.ok(Object.entries(verified).every(([name, value]) => name.endsWith("Count") || value === true));

  const reader = new Client({ ...cluster.connectionConfig, database, user: readerRole, password: "reader-pass" }); await reader.connect();
  assert.equal((await reader.query("SELECT count(*) FROM identity.credentials")).rowCount, 1);
  assert.equal((await reader.query("SELECT count(*) FROM ops.audit_security_context")).rowCount, 1);
  assert.equal((await reader.query("SELECT count(*) FROM play.personal_access_future")).rowCount, 1);
  await assert.rejects(reader.query("UPDATE core.tenants SET display_name=display_name"), (error) => error.code === "42501");
  await reader.end();

  const admin = new Client({ ...cluster.connectionConfig, database, user: adminRole, password: "admin-pass" }); await admin.connect();
  await admin.query("BEGIN");
  assert.equal((await admin.query("UPDATE core.tenants SET display_name=display_name")).rowCount, 1);
  await admin.query("ROLLBACK");
  await assert.rejects(admin.query("CREATE TABLE play.personal_access_forbidden(id integer)"), (error) => error.code === "42501");
  await assert.rejects(admin.query("TRUNCATE play.personal_access_future"), (error) => error.code === "42501");
  await admin.end();
});
