"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { applyImport } = require("../db/import/importRunner");
const { runShadowRead } = require("../db/import/shadowRead");
const { runMigrations } = require("../db/migrationRunner");
const { applyTechnicalSeed } = require("../db/seedRunner");
const { createImportTestPackage } = require("./importTestPackage");
const { startPostgresTestCluster } = require("./postgresTestCluster");

async function importedTarget(t) {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-10T00:00:00.000Z", output: () => {} });
  const root = createImportTestPackage(t, { withLegacyState: true });
  await applyImport({ root, connectionConfig: cluster.connectionConfig });
  return { cluster, root };
}

test("Shadow-Read bindet alle kontrollierten Domaenen an Counts und Hashes", { timeout: 60_000 }, async (t) => {
  const { cluster, root } = await importedTarget(t);
  const report = await runShadowRead({ root, connectionConfig: cluster.connectionConfig });
  assert.equal(report.status, "match");
  assert.deepEqual(report.domains.map(({ name, match }) => [name, match]), [
    ["identity", true], ["play", true], ["venue", true], ["messaging", true], ["preferences", true], ["operations", true],
  ]);
  assert.deepEqual(report.unresolved, { idempotency: 0, jobs: 0, outbox: 0, audit: 0 });
  assert.match(report.shadowSha256, /^[0-9a-f]{64}$/);
});

test("Shadow-Read blockiert kontrollierte Projektionsdrift ohne Fachdaten auszugeben", { timeout: 60_000 }, async (t) => {
  const { cluster, root } = await importedTarget(t);
  const client = new Client(cluster.connectionConfig);
  await client.connect();
  await client.query("UPDATE play.matches SET is_ignored=NOT is_ignored");
  await client.end();
  const output = [];
  await assert.rejects(runShadowRead({ root, connectionConfig: cluster.connectionConfig, output: (line) => output.push(line) }), (error) => error.code === "SHADOW_READ_MISMATCH");
  assert.equal(output.some((line) => line.includes("Spieler")), false);
  assert.equal(JSON.parse(output.at(-1)).domains.find(({ name }) => name === "play").match, false);
});
