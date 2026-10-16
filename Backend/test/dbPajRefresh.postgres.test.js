"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { runMigrations } = require("../db/migrationRunner");
const { applyPajRefresh, inspectPajRefresh, validatePajRefresh } = require("../db/import/pajRefresh");
const { activatePajRefreshDatabase, rollbackPajRefreshDatabase } = require("../db/import/pajRefreshSwap");
const { transformSource } = require("../db/import/importRunner");
const { applyTechnicalSeed } = require("../db/seedRunner");
const { PostgresAuthService } = require("../postgresAuthService");
const { createRuntimeRepositories } = require("../db/createRuntimeRepositories");
const { createImportTestPackage } = require("./importTestPackage");
const { startPostgresTestCluster } = require("./postgresTestCluster");

test("PAJ-Refresh importiert exakten Fachbestand mit gemeinsamem Testcredential und ohne Zugangsstate", { timeout: 60_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-10T00:00:00.000Z", output: () => {} });
  const clientHash = "f".repeat(64), root = createImportTestPackage(t, { pajRefresh: true, refreshPasswordHash: clientHash, allRoles: true });
  const inspection = inspectPajRefresh(root);
  assert.equal(inspection.profile, "paj-refresh-v1");
  assert.equal(inspection.credentialCount, 5);
  assert.equal(inspection.counts.frontend_logging_settings, 1);
  const output = [];
  const result = await applyPajRefresh({ root, connectionConfig: cluster.connectionConfig, output: (line) => output.push(JSON.parse(line)) });
  assert.equal(result.checks.accounts, 5);
  assert.equal(result.checks.credentials, 5);
  assert.equal(result.checks.sessions, 0);
  assert.equal(result.checks.active_monitors, 0);
  assert.equal(result.checks.active_score_sources, 0);
  assert.equal(result.checks.active_courts, 0);
  assert.equal(result.checks.active_court_state, 0);
  assert.equal(result.checks.active_deliveries, 0);
  await validatePajRefresh({ root, connectionConfig: cluster.connectionConfig, output: () => {} });
  assert.equal(output.at(-1).event, "paj_refresh_import_completed");
  assert.equal(output.at(-1).result, "success");

  const database = new Client(cluster.connectionConfig); await database.connect();
  const credentials = await database.query("SELECT secret_hash FROM identity.credentials ORDER BY account_id");
  const monitor = await database.query("SELECT revoked_at IS NOT NULL AS revoked FROM venue.monitor_devices");
  const court = await database.query("SELECT court.active,source.active AS source_active,state.active AS state_active,state.awaiting_baseline FROM venue.courts court JOIN venue.score_sources source ON source.court_id=court.id JOIN venue.court_live_state state ON state.court_id=court.id ORDER BY court.court_code");
  const logging = await database.query("SELECT enabled,minimum_level,info_sample_rate::text,debug_sample_rate::text FROM identity.frontend_logging_settings");
  await database.end();
  assert.deepEqual(monitor.rows, [{ revoked: true }]);
  assert.ok(court.rows.length > 0);
  assert.ok(court.rows.every((row) => !row.active && !row.source_active && !row.state_active && !row.awaiting_baseline));
  assert.deepEqual(logging.rows, [{ enabled: false, minimum_level: "error", info_sample_rate: "0.0000", debug_sample_rate: "0.0000" }]);
  const auth = new PostgresAuthService({ repository: {}, rateLimitSecret: Buffer.alloc(32, 1), sessionTtlMs: 1, sessionRefreshIntervalMs: 1, sessionMaxPerUser: 1 });
  for (const { secret_hash: stored } of credentials.rows) {
    assert.equal((await auth.verifyCredential(clientHash, stored)).valid, true);
    assert.equal((await auth.verifyCredential("a".repeat(64), stored)).valid, false);
  }
  assert.notEqual(credentials.rows[0].secret_hash, credentials.rows[1].secret_hash);

  const runtime = createRuntimeRepositories({ connectionConfig: cluster.connectionConfig, expectedTenantCode: "devel-epiber" });
  t.after(() => runtime.close());
  const repositories = await runtime.connect();
  const login = new PostgresAuthService({ repository: repositories.identity, rateLimitSecret: Buffer.alloc(32, 2), sessionTtlMs: 60_000, sessionRefreshIntervalMs: 30_000, sessionMaxPerUser: 2 });
  const admin = await login.login({ login: "ada", passwordHash: clientHash, ip: "127.0.0.1" });
  const playerB = await login.login({ login: "berta", passwordHash: clientHash, ip: "127.0.0.2" });
  const player = await login.login({ login: "player", passwordHash: clientHash, ip: "127.0.0.4" });
  const playerA = await login.login({ login: "player.a", passwordHash: clientHash, ip: "127.0.0.5" });
  const operator = await login.login({ login: "operator", passwordHash: clientHash, ip: "127.0.0.6" });
  assert.ok(admin.user.roles.includes("admin"));
  assert.ok(playerB.user.roles.includes("player B"));
  assert.ok(player.user.roles.includes("player"));
  assert.ok(playerA.user.roles.includes("player A"));
  assert.ok(operator.user.roles.includes("operator"));
  await assert.rejects(login.login({ login: "ada", passwordHash: "a".repeat(64), ip: "127.0.0.3" }), (error) => error.code === "LOGIN_FAILED");
});

test("PAJ-Refresh-CLI lehnt ein normales Migrationspaket ohne Bereinigungsprofil ab", (t) => {
  const root = createImportTestPackage(t);
  assert.throws(() => inspectPajRefresh(root), (error) => error.code === "PAJ_REFRESH_METADATA_INVALID");
});

test("PAJ-Refresh behaelt historische Meldungs- und Auditdaten ausserhalb regulaerer Import-Retention", (t) => {
  const regular = transformSource(createImportTestPackage(t, { oldHistorical: true }));
  const refresh = transformSource(createImportTestPackage(t, { pajRefresh: true, oldHistorical: true }));
  assert.equal(regular.plan.tables.receipts.length, 0);
  assert.equal(regular.plan.tables.deliveries.length, 0);
  assert.equal(regular.plan.tables.audit_operations.length, 0);
  assert.equal(refresh.plan.tables.receipts.length, 1);
  assert.equal(refresh.plan.tables.deliveries.length, 1);
  assert.equal(refresh.plan.tables.audit_operations.length, 1);
});

test("PAJ-Refresh behandelt Teilnehmer des produktiven Messaging-Schemas ohne inbox_visible als sichtbar", (t) => {
  const transformed = transformSource(createImportTestPackage(t, { pajRefresh: true, legacyMessagingWithoutVisibility: true }));
  assert.equal(transformed.status, "ready");
  assert.equal(transformed.plan.tables.event_recipients.length, 1);
  assert.equal(transformed.plan.tables.receipts.length, 1);
});

test("PAJ-Refresh-Datenbanktausch rollt einen Abbruch zwischen beiden Umbenennungen zurueck", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  const candidate = "epiber_devel_refresh_12345678", previous = "epiber_devel_previous_20261013120000";
  const admin = new Client({ ...cluster.connectionConfig, database: "postgres" });
  await admin.connect();
  await admin.query("CREATE DATABASE epiber_devel");
  await admin.query(`CREATE DATABASE ${candidate}`);
  await admin.end();
  const names = async () => {
    const client = new Client({ ...cluster.connectionConfig, database: "postgres" }); await client.connect();
    const result = await client.query("SELECT datname FROM pg_database WHERE datname=ANY($1::text[]) ORDER BY datname", [["epiber_devel", candidate, previous]]);
    await client.end(); return result.rows.map(({ datname }) => datname);
  };
  await assert.rejects(
    activatePajRefreshDatabase({ adminConnectionConfig: cluster.connectionConfig, candidate, previous, failAfterFirstRename: true }),
    (error) => error.code === "PAJ_REFRESH_TEST_ABORT" && error.rolledBack === true,
  );
  assert.deepEqual(await names(), ["epiber_devel", candidate]);
  await activatePajRefreshDatabase({ adminConnectionConfig: cluster.connectionConfig, candidate, previous });
  assert.deepEqual(await names(), ["epiber_devel", previous]);
  await rollbackPajRefreshDatabase({ adminConnectionConfig: cluster.connectionConfig, candidate, previous });
  assert.deepEqual(await names(), ["epiber_devel", candidate]);
});
