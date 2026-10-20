"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("pg");
const { applyPajRefresh } = require("../db/import/pajRefresh");
const { applyExistingDatabaseGrants, roleNames } = require("../db/bootstrap");
const { rotateAllPajPasswords, AUDIT_ACTION } = require("../db/pajPasswordRotation");
const { runMigrations } = require("../db/migrationRunner");
const { applyTechnicalSeed } = require("../db/seedRunner");
const { createRuntimeRepositories } = require("../db/createRuntimeRepositories");
const { PostgresAuthService } = require("../postgresAuthService");
const { AUDIT_CONTRACTS } = require("../postgresRuntimeContracts");
const { createImportTestPackage } = require("./importTestPackage");
const { startPostgresTestCluster } = require("./postgresTestCluster");

test("PAJ-Passwortrotationswerkzeug uebergibt nur den geschuetzten Hash ueber stdin", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "../../Project/server-configs/bin/epiber-paj-password-rotate-all"), "utf8");
  assert.match(script, /ROTIEREN/);
  assert.match(script, /EPIBER_DB_ROLE=epiber_devel_refresh/);
  assert.match(script, /db-paj-password-rotate\.js" < "\$\{temporary\}"/);
  assert.doesNotMatch(script, /node[^\n]*\$\{password\}/);
  assert.ok(script.indexOf("db-paj-password-rotate.js") < script.indexOf('install -m 0400 -o root -g root "${temporary}" "${target}"'));
});

test("PAJ-Passwortrotation ersetzt alle Credentials atomar, widerruft Sitzungen und schreibt kontrolliertes Audit", { timeout: 60_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-13T00:00:00.000Z", output: () => {} });
  const oldHash = "a".repeat(64), newHash = "b".repeat(64), rejectedHash = "c".repeat(64);
  const root = createImportTestPackage(t, { pajRefresh: true, refreshPasswordHash: oldHash, allRoles: true });
  await applyPajRefresh({ root, connectionConfig: cluster.connectionConfig, output: () => {} });

  const prefix = "rotation_test", names = roleNames(prefix);
  const roleSetup = new Client(cluster.connectionConfig); await roleSetup.connect();
  for (const role of [names.owner, names.migrator, names.app, names.worker, names.monitor, names.backup, names.refresh]) {
    await roleSetup.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  }
  await roleSetup.end();
  await applyExistingDatabaseGrants({ adminConnectionConfig: cluster.connectionConfig, prefix, database: "postgres", readOnly: false, output: () => {} });
  const restrictedConnection = { ...cluster.connectionConfig, options: `-c role=${names.refresh}` };
  const runtime = createRuntimeRepositories({ connectionConfig: restrictedConnection, expectedTenantCode: "devel-epiber", auditContracts: AUDIT_CONTRACTS });
  t.after(() => runtime.close());
  const repositories = await runtime.connect();
  const auth = new PostgresAuthService({ repository: repositories.identity, rateLimitSecret: Buffer.alloc(32, 3), sessionTtlMs: 60_000, sessionRefreshIntervalMs: 30_000, sessionMaxPerUser: 2 });
  await auth.login({ login: "ada", passwordHash: oldHash, ip: "127.0.0.1" });

  const setup = new Client(cluster.connectionConfig); await setup.connect();
  await setup.query(`
    INSERT INTO identity.password_authorizations(account_id,issued_by_person_id,issued_at,expires_at)
    SELECT account.id,account.person_id,statement_timestamp(),statement_timestamp()+interval '24 hours'
      FROM identity.user_accounts account WHERE account.login='ada'
  `);
  await setup.query("INSERT INTO identity.login_rate_limits(key_hash,key_type,window_started_at,attempt_count,expires_at) VALUES ($1,'ip',clock_timestamp(),1,clock_timestamp()+interval '1 hour')", [Buffer.alloc(32, 1)]);
  const before = await setup.query("SELECT id::text,auth_revision::text FROM identity.user_accounts WHERE login IS NOT NULL ORDER BY id");
  await setup.end();

  const result = await rotateAllPajPasswords({ repositories, clientHash: newHash, operationId: "0199f000-0000-7000-8000-000000000001" });
  assert.deepEqual(result, { accountCount: 5, credentialCount: 5, sessionsRevoked: 1, authorizationsRevoked: 1, loginLimitsCleared: 1 });

  const database = new Client(cluster.connectionConfig); await database.connect();
  const credentials = await database.query("SELECT secret_hash FROM identity.credentials WHERE active ORDER BY account_id");
  const security = await database.query(`SELECT
    (SELECT count(*)::integer FROM identity.sessions WHERE revoked_at IS NULL) AS sessions,
    (SELECT count(*)::integer FROM identity.password_authorizations WHERE revoked_at IS NULL AND consumed_at IS NULL) AS authorizations,
    (SELECT count(*)::integer FROM identity.login_rate_limits) AS limits,
    (SELECT count(*)::integer FROM identity.credentials WHERE NOT active AND secret_hash IS NOT NULL) AS exposed_history`);
  const revisions = await database.query("SELECT id::text,auth_revision::text FROM identity.user_accounts WHERE login IS NOT NULL ORDER BY id");
  const audit = await database.query("SELECT status,before_projection AS before,after_projection AS after FROM ops.audit_operations WHERE action=$1 ORDER BY started_at", [AUDIT_ACTION]);
  assert.equal(credentials.rowCount, 5);
  for (const row of credentials.rows) {
    assert.equal((await auth.verifyCredential(newHash, row.secret_hash)).valid, true);
    assert.equal((await auth.verifyCredential(oldHash, row.secret_hash)).valid, false);
  }
  assert.deepEqual(security.rows[0], { sessions: 0, authorizations: 0, limits: 0, exposed_history: 0 });
  assert.deepEqual(revisions.rows.map((row, index) => Number(row.auth_revision) - Number(before.rows[index].auth_revision)), [1, 1, 1, 1, 1]);
  assert.deepEqual(audit.rows, [{
    status: "success",
    before: { scope: "all_accounts" },
    after: { accountCount: 5, credentialCount: 5, sessionsRevoked: 1, authorizationsRevoked: 1, loginLimitsCleared: 1 },
  }]);

  const hashesBeforeAbort = credentials.rows.map(({ secret_hash: hash }) => hash);
  await assert.rejects(
    rotateAllPajPasswords({ repositories, clientHash: rejectedHash, operationId: "0199f000-0000-7000-8000-000000000002", failAfterCredentialUpdate: true }),
    (error) => error.code === "PAJ_PASSWORD_ROTATION_TEST_ABORT",
  );
  const afterAbort = await database.query("SELECT secret_hash FROM identity.credentials WHERE active ORDER BY account_id");
  const failedAudit = await database.query("SELECT status,after_projection,error_code FROM ops.audit_operations operation JOIN ops.audit_transitions transition ON transition.audit_operation_id=operation.id AND transition.transition='failed' WHERE operation.action=$1 ORDER BY operation.started_at DESC LIMIT 1", [AUDIT_ACTION]);
  await database.end();
  assert.deepEqual(afterAbort.rows.map(({ secret_hash: hash }) => hash), hashesBeforeAbort);
  assert.deepEqual(failedAudit.rows, [{ status: "failed", after_projection: null, error_code: "PAJ_PASSWORD_ROTATION_TEST_ABORT" }]);
});
