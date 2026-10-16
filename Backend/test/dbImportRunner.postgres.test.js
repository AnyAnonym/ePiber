"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { applyImport, validateImport } = require("../db/import/importRunner");
const { runMigrations } = require("../db/migrationRunner");
const { applyTechnicalSeed } = require("../db/seedRunner");
const { createImportTestPackage } = require("./importTestPackage");
const { startPostgresTestCluster } = require("./postgresTestCluster");

async function target(t) {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-10T00:00:00.000Z", output: () => {} });
  return cluster;
}

test("Gesamtimport ist atomar, validierbar und ohne Dubletten wiederholbar", { timeout: 60_000 }, async (t) => {
  const root = createImportTestPackage(t), cluster = await target(t);
  await assert.rejects(applyImport({ root, connectionConfig: cluster.connectionConfig, failAfterTable: "competitions" }), (error) => error.code === "IMPORT_TEST_ABORT");
  const client = new Client(cluster.connectionConfig);
  await client.connect();
  assert.equal(Number((await client.query("SELECT count(*) FROM identity.people")).rows[0].count), 0);
  assert.equal(Number((await client.query("SELECT count(*) FROM ops.import_runs")).rows[0].count), 0);
  await client.end();

  const applied = await applyImport({ root, connectionConfig: cluster.connectionConfig });
  assert.equal(applied.repeated, false);
  assert.equal(applied.counts.people, 2);
  assert.equal(applied.counts.matches, 1);
  assert.equal(applied.counts.score_events, 1);
  assert.equal(applied.counts.events, 1);
  assert.equal(applied.counts.audit_operations, 1);
  const replay = await applyImport({ root, connectionConfig: cluster.connectionConfig });
  assert.equal(replay.repeated, true);
  const validated = await validateImport({ root, connectionConfig: cluster.connectionConfig });
  assert.equal(validated.targetSha256, applied.targetSha256);

  const changed = new Client(cluster.connectionConfig);
  await changed.connect();
  await changed.query("UPDATE play.matches SET note='unerwartete Drift'");
  await changed.end();
  await assert.rejects(validateImport({ root, connectionConfig: cluster.connectionConfig }), (error) => error.code === "IMPORT_TARGET_FINGERPRINT_MISMATCH");
});

test("Gesamtimport uebernimmt revisionierte Court-, Hallenzeit-, Praeferenz- und Rangprovenienz relational", { timeout: 60_000 }, async (t) => {
  const root = createImportTestPackage(t, { withLegacyState: true }), cluster = await target(t);
  const applied = await applyImport({ root, connectionConfig: cluster.connectionConfig });
  assert.equal(applied.counts.court_assignments, 1);
  assert.equal(applied.counts.court_assignment_participants, 2);
  assert.equal(applied.counts.hall_time_grids, 1);
  assert.equal(applied.counts.hall_time_allocations, 1);
  assert.equal(applied.counts.hall_time_history, 1);
  assert.equal(applied.counts.user_favorites, 2);
  assert.equal(applied.counts.user_start_pages, 1);
  assert.equal(applied.counts.match_ranking_effects, 1);
  const validated = await validateImport({ root, connectionConfig: cluster.connectionConfig });
  assert.equal(validated.targetSha256, applied.targetSha256);
});
