"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { runMigrations } = require("../db/migrationRunner");
const { applyTechnicalSeed } = require("../db/seedRunner");
const { startPostgresTestCluster } = require("./postgresTestCluster");

test("PostgreSQL erzwingt zentrale Identity-, Ranking- und Jobinvarianten", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-10T00:00:00.000Z", output: () => {} });
  const client = new Client(cluster.connectionConfig);
  await client.connect();
  t.after(() => client.end());

  const tenant = "0199c800-0000-7000-8000-000000000001";
  const section = "0199c800-0000-7000-8000-000000000002";
  const personOne = "0199c800-0000-7000-8000-000000000011";
  const personTwo = "0199c800-0000-7000-8000-000000000012";
  await client.query(`
    INSERT INTO identity.people(id, tenant_id, contract_id, first_name, last_name)
    VALUES ($1, $3, '1', 'Ada', 'Test'), ($2, $3, '2', 'Berta', 'Test')
  `, [personOne, personTwo, tenant]);
  await client.query("INSERT INTO identity.memberships(section_id, person_id, classification) VALUES ($1, $2, 'player')", [section, personOne]);
  await assert.rejects(
    client.query("INSERT INTO identity.memberships(section_id, person_id, classification) VALUES ($1, $2, 'player A')", [section, personOne]),
    (error) => error.code === "23505",
  );
  const account = await client.query("INSERT INTO identity.user_accounts(tenant_id, person_id, login) VALUES ($1, $2, 'player1') RETURNING id", [tenant, personOne]);
  await assert.rejects(
    client.query("INSERT INTO identity.user_accounts(tenant_id, person_id, login) VALUES ($1, $2, 'player1')", [tenant, personTwo]),
    (error) => error.code === "23505",
  );
  await client.query(`
    INSERT INTO identity.user_favorites(account_id, position, target_type, overlay_key, revision)
    VALUES ($1, 1, 'overlay', 'profile-messages', 1)
  `, [account.rows[0].id]);

  const competitionType = "0199c800-0000-7000-8000-000000000021";
  const competitionTypeVersion = "0199c800-0000-7000-8000-000000000022";
  const competition = "0199c800-0000-7000-8000-000000000023";
  await client.query("INSERT INTO play.competition_types(id, tenant_id, contract_id, name) VALUES ($1, $2, '2', 'Rangliste')", [competitionType, tenant]);
  await client.query("INSERT INTO play.competition_type_versions(id, competition_type_id, version_no, entry_list_available, round_robin) VALUES ($1, $2, 1, true, false)", [competitionTypeVersion, competitionType]);
  await client.query("INSERT INTO play.competitions(id, section_id, contract_id, competition_type_version_id, name) VALUES ($1, $2, '2', $3, 'Rangliste')", [competition, section, competitionTypeVersion]);
  await client.query(`
    INSERT INTO identity.user_favorites(account_id, position, target_type, competition_id, round_robin_layout, revision)
    VALUES ($1, 2, 'round_robin', $2, 4, 1)
  `, [account.rows[0].id, competition]);
  await assert.rejects(client.query(`
    INSERT INTO identity.user_favorites(account_id, position, target_type, page_key, overlay_key, revision)
    VALUES ($1, 3, 'overlay', 'index', 'profile', 1)
  `, [account.rows[0].id]), (error) => error.code === "23514");
  await client.query("INSERT INTO play.ranking_entries(competition_id, person_id, status, rank) VALUES ($1, $2, 'active', 1)", [competition, personOne]);
  await assert.rejects(
    client.query("INSERT INTO play.ranking_entries(competition_id, person_id, status, rank) VALUES ($1, $2, 'active', 1)", [competition, personTwo]),
    (error) => error.code === "23505",
  );

  await assert.rejects(client.query(`
    INSERT INTO ops.jobs(tenant_id, job_type, payload_version, payload, idempotency_key, status, available_at)
    VALUES ($1, 'test', 1, '{}', 'invalid-lease', 'leased', clock_timestamp())
  `, [tenant]), (error) => error.code === "23514");
});
