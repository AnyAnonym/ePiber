"use strict";

const { Client } = require("pg");

function databaseIdentifier(value, kind) {
  const patterns = {
    active: /^epiber_devel$/,
    candidate: /^epiber_devel_refresh_[a-z0-9_]{8,32}$/,
    previous: /^epiber_devel_previous_[0-9]{14}$/,
  };
  if (!patterns[kind]?.test(String(value))) throw Object.assign(new Error("Refresh-Datenbankname ist ungueltig"), { code: "PAJ_REFRESH_DATABASE_NAME_INVALID" });
  return `"${value}"`;
}

async function databaseNames(client, names) {
  const result = await client.query("SELECT datname FROM pg_database WHERE datname=ANY($1::text[])", [names]);
  return new Set(result.rows.map(({ datname }) => datname));
}

async function terminateDatabaseConnections(client, names) {
  await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=ANY($1::text[]) AND pid<>pg_backend_pid()", [names]);
}

async function rollbackPajRefreshDatabase({ adminConnectionConfig, active = "epiber_devel", candidate, previous, output = () => {} }) {
  const quoted = {
    active: databaseIdentifier(active, "active"), candidate: databaseIdentifier(candidate, "candidate"), previous: databaseIdentifier(previous, "previous"),
  };
  const client = new Client({ ...adminConnectionConfig, database: "postgres" });
  await client.connect();
  output(JSON.stringify({ event: "paj_refresh_database_rollback_started", candidate, previous }));
  try {
    let existing = await databaseNames(client, [active, candidate, previous]);
    await terminateDatabaseConnections(client, [active, candidate, previous]);
    if (existing.has(previous) && existing.has(active) && !existing.has(candidate)) {
      await client.query(`ALTER DATABASE ${quoted.active} RENAME TO ${quoted.candidate}`);
      await client.query(`ALTER DATABASE ${quoted.previous} RENAME TO ${quoted.active}`);
    } else if (existing.has(previous) && !existing.has(active) && existing.has(candidate)) {
      await client.query(`ALTER DATABASE ${quoted.previous} RENAME TO ${quoted.active}`);
    } else if (!(existing.has(active) && existing.has(candidate) && !existing.has(previous))) {
      throw Object.assign(new Error("Refresh-Rollbackzustand ist unklar"), { code: "PAJ_REFRESH_ROLLBACK_STATE_UNKNOWN", databases: [...existing].sort() });
    }
    existing = await databaseNames(client, [active, candidate, previous]);
    if (!existing.has(active) || !existing.has(candidate) || existing.has(previous)) throw Object.assign(new Error("Refresh-Rollback wurde nicht bestaetigt"), { code: "PAJ_REFRESH_ROLLBACK_VERIFY_FAILED" });
    output(JSON.stringify({ event: "paj_refresh_database_rollback_completed", result: "success", candidate }));
    return { rolledBack: true };
  } catch (error) {
    output(JSON.stringify({ event: "paj_refresh_database_rollback_completed", result: "unknown", errorCode: error.code || "PAJ_REFRESH_ROLLBACK_FAILED" }));
    throw Object.assign(error, { completionLogged: true });
  } finally { await client.end(); }
}

async function activatePajRefreshDatabase({ adminConnectionConfig, active = "epiber_devel", candidate, previous, output = () => {}, failAfterFirstRename = false }) {
  const quoted = {
    active: databaseIdentifier(active, "active"), candidate: databaseIdentifier(candidate, "candidate"), previous: databaseIdentifier(previous, "previous"),
  };
  const client = new Client({ ...adminConnectionConfig, database: "postgres" });
  output(JSON.stringify({ event: "paj_refresh_database_activation_started", candidate, previous }));
  await client.connect();
  try {
    const existing = await databaseNames(client, [active, candidate, previous]);
    if (!existing.has(active) || !existing.has(candidate) || existing.has(previous)) throw Object.assign(new Error("Refresh-Aktivierungszustand ist ungueltig"), { code: "PAJ_REFRESH_ACTIVATION_STATE_INVALID" });
    await terminateDatabaseConnections(client, [active, candidate]);
    await client.query(`ALTER DATABASE ${quoted.active} RENAME TO ${quoted.previous}`);
    if (failAfterFirstRename) throw Object.assign(new Error("Absichtlicher Aktivierungsabbruch"), { code: "PAJ_REFRESH_TEST_ABORT" });
    await client.query(`ALTER DATABASE ${quoted.candidate} RENAME TO ${quoted.active}`);
    const activated = await databaseNames(client, [active, candidate, previous]);
    if (!activated.has(active) || activated.has(candidate) || !activated.has(previous)) throw Object.assign(new Error("Refresh-Aktivierung wurde nicht bestaetigt"), { code: "PAJ_REFRESH_ACTIVATION_VERIFY_FAILED" });
    output(JSON.stringify({ event: "paj_refresh_database_activation_completed", result: "success", previous }));
    return { activated: true };
  } catch (error) {
    try {
      await rollbackPajRefreshDatabase({ adminConnectionConfig, active, candidate, previous, output });
    } catch (rollbackError) {
      throw Object.assign(error, { code: "PAJ_REFRESH_ACTIVATION_OUTCOME_UNKNOWN", cause: rollbackError, completionLogged: true });
    }
    output(JSON.stringify({ event: "paj_refresh_database_activation_completed", result: "failed", errorCode: error.code || "PAJ_REFRESH_ACTIVATION_FAILED", rolledBack: true }));
    throw Object.assign(error, { completionLogged: true, rolledBack: true });
  } finally {
    await client.end();
  }
}

module.exports = { activatePajRefreshDatabase, rollbackPajRefreshDatabase };
