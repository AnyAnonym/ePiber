"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const TECHNICAL_SEED = path.join(__dirname, "seeds", "technical-minimal.sql");
const FULL_DEVEL_SEED = path.join(__dirname, "seeds", "full-devel.sql");
const FULL_DEVEL_EXPECTED = path.join(__dirname, "seeds", "full-devel.expected.json");
const FULL_DEVEL_REFERENCE_AS_OF = "2026-10-10T00:00:00.000Z";

const FULL_DEVEL_TIME_COLUMNS = {
  "core.configuration_entries": ["updated_at"],
  "identity.memberships": ["valid_from", "valid_until"],
  "identity.credentials": ["revoked_at"],
  "identity.password_authorizations": ["issued_at", "expires_at", "consumed_at", "revoked_at"],
  "identity.tenant_role_assignments": ["granted_at", "revoked_at"],
  "identity.sessions": ["issued_at", "last_seen_at", "expires_at", "revoked_at"],
  "identity.login_rate_limits": ["window_started_at", "blocked_until", "expires_at"],
  "identity.frontend_logging_targets": ["expires_at"],
  "play.competition_entries": ["entered_at", "withdrawn_at"],
  "play.matches": ["challenged_at", "scheduled_at"],
  "play.match_results": ["play_started_at", "play_ended_at", "first_captured_at", "walkover_at"],
  "play.match_result_history": ["changed_at"],
  "play.ranking_entries": ["withdrawn_at"],
  "play.ranking_changes": ["created_at"],
  "venue.court_assignments": ["assigned_at", "released_at"],
  "venue.court_live_state": ["last_source_at", "updated_at"],
  "venue.score_events": ["source_occurred_at", "accepted_at"],
  "venue.court_state_events": ["occurred_at"],
  "venue.monitor_devices": ["revoked_at", "last_seen_at"],
  "venue.monitor_commands": ["created_at", "acknowledged_at", "expires_at"],
  "venue.hall_time_grid_participants": ["joined_at", "left_at"],
  "venue.hall_time_slots": ["starts_at", "ends_at"],
  "venue.hall_time_allocations": ["queued_at", "assigned_at"],
  "venue.hall_time_constraints": ["created_at"],
  "venue.hall_time_history": ["occurred_at"],
  "venue.hall_time_history_items": ["slot_starts_at_snapshot"],
  "messaging.events": ["created_at"],
  "messaging.event_recipients": ["created_at"],
  "messaging.receipts": ["read_at", "acknowledged_at"],
  "messaging.deliveries": ["updated_at"],
  "messaging.comments": ["created_at", "deleted_at"],
  "messaging.reactions": ["created_at"],
  "ops.idempotency_operations": ["response_expires_at", "started_at", "completed_at", "expires_at"],
  "ops.jobs": ["available_at", "lease_until", "completed_at", "clarified_at"],
  "ops.outbox": ["available_at", "lease_until", "completed_at"],
  "ops.audit_operations": ["started_at", "completed_at", "expires_at"],
  "ops.audit_transitions": ["occurred_at"],
};

const FULL_DEVEL_DATE_COLUMNS = {
  "play.competitions": ["entry_start_date", "entry_deadline_date", "competition_start_date", "competition_end_date"],
};

const FULL_DEVEL_TECHNICAL_TIME_COLUMNS = {
  "core.tenants": ["created_at"],
  "core.sections": ["created_at", "updated_at"],
  "core.projection_revisions": ["updated_at"],
  "identity.people": ["created_at", "updated_at"],
  "identity.person_contacts": ["created_at"],
  "identity.person_addresses": ["created_at"],
  "identity.person_external_identifiers": ["created_at"],
  "identity.memberships": ["created_at"],
  "identity.user_accounts": ["created_at", "updated_at"],
  "identity.credentials": ["created_at"],
  "identity.frontend_logging_settings": ["updated_at"],
  "identity.frontend_logging_targets": ["created_at"],
  "identity.user_start_pages": ["updated_at"],
  "identity.user_preference_states": ["favorites_updated_at", "start_page_updated_at"],
  "messaging.history_revision": ["updated_at"],
  "play.competition_types": ["created_at"],
  "play.competition_type_versions": ["created_at"],
  "play.match_formats": ["created_at"],
  "play.match_format_versions": ["created_at"],
  "play.competitions": ["created_at", "updated_at"],
  "play.matches": ["created_at", "updated_at"],
  "play.match_results": ["created_at"],
  "play.ranking_entries": ["updated_at"],
  "venue.monitor_devices": ["created_at", "updated_at"],
  "messaging.user_revisions": ["updated_at"],
  "messaging.notification_preferences": ["updated_at"],
  "ops.jobs": ["created_at"],
  "ops.outbox": ["created_at"],
};

function seedChecksum(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

async function shiftFullDevelAsOf(client, asOf) {
  for (const [table, columns] of Object.entries(FULL_DEVEL_TECHNICAL_TIME_COLUMNS)) {
    await client.query(`UPDATE ${table} SET ${columns.map((column) => `${column} = $1::timestamptz`).join(", ")}`, [asOf]);
  }
  for (const [table, columns] of Object.entries(FULL_DEVEL_TIME_COLUMNS)) {
    await client.query(`UPDATE ${table} SET ${columns.map((column) => `${column} = CASE WHEN ${column} IS NULL THEN NULL ELSE ${column} + ($1::timestamptz - $2::timestamptz) END`).join(", ")}`, [asOf, FULL_DEVEL_REFERENCE_AS_OF]);
  }
  for (const [table, columns] of Object.entries(FULL_DEVEL_DATE_COLUMNS)) {
    await client.query(`UPDATE ${table} SET ${columns.map((column) => `${column} = CASE WHEN ${column} IS NULL THEN NULL ELSE ${column} + ($1::date - $2::date) END`).join(", ")}`, [asOf, FULL_DEVEL_REFERENCE_AS_OF]);
  }
}

async function validateFullDevelSeed(client, expected) {
  if (expected?.version !== 1 || !expected.counts || typeof expected.counts !== "object" || Array.isArray(expected.counts)) {
    throw Object.assign(new Error("Full-Devel-Erwartungsvertrag ist ungueltig"), { code: "SEED_EXPECTATION_INVALID" });
  }
  const actual = {};
  const projection = {};
  for (const [qualifiedTable, expectedCount] of Object.entries(expected.counts)) {
    if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(qualifiedTable) || !Number.isInteger(expectedCount) || expectedCount < 0) {
      throw Object.assign(new Error("Full-Devel-Erwartungswert ist ungueltig"), { code: "SEED_EXPECTATION_INVALID" });
    }
    const result = await client.query(`SELECT count(*)::integer AS count FROM ${qualifiedTable}`);
    actual[qualifiedTable] = result.rows[0].count;
    if (actual[qualifiedTable] !== expectedCount) {
      throw Object.assign(new Error("Full-Devel-Projektion weicht ab"), { code: "SEED_PROJECTION_MISMATCH", projection: qualifiedTable });
    }
    if (!qualifiedTable.startsWith("ops.import_") && !["ops.schema_migrations", "ops.seed_runs"].includes(qualifiedTable)) {
      const rows = await client.query(`SELECT to_jsonb(seed_row) AS value FROM ${qualifiedTable} seed_row ORDER BY to_jsonb(seed_row)::text`);
      projection[qualifiedTable] = rows.rows.map(({ value }) => value);
    }
  }
  return { counts: actual, checksum: seedChecksum(JSON.stringify(projection)) };
}

async function applyTechnicalSeed({ connectionConfig, asOf, tenantCode = "devel-epiber", tenantName = "ePiber Development", output = console.log }) {
  const parsedAsOf = new Date(asOf);
  if (!asOf || Number.isNaN(parsedAsOf.getTime()) || parsedAsOf.toISOString() !== asOf) {
    throw Object.assign(new Error("Seed as_of muss ein kanonischer ISO-Zeitpunkt sein"), { code: "SEED_AS_OF_INVALID" });
  }
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(tenantCode) || typeof tenantName !== "string" || !tenantName.trim() || tenantName.length > 160) {
    throw Object.assign(new Error("Seed-Tenant ist ungueltig"), { code: "SEED_TENANT_INVALID" });
  }
  const sql = fs.readFileSync(TECHNICAL_SEED, "utf8");
  const checksum = seedChecksum(`${sql}\n${JSON.stringify({ tenantCode, tenantName })}`);
  const client = new Client(connectionConfig);
  await client.connect();
  output(JSON.stringify({ event: "db_seed_started", seed: "technical-minimal", asOf }));
  try {
    const state = await client.query(`
      SELECT (SELECT count(*) FROM core.tenants) AS tenant_count,
             (SELECT count(*) FROM ops.seed_runs WHERE result = 'success') AS successful_seed_count
    `);
    if (Number(state.rows[0].tenant_count) !== 0 || Number(state.rows[0].successful_seed_count) !== 0) {
      throw Object.assign(new Error("Technischer Seed verlangt eine leere Zielbasis"), { code: "SEED_DATABASE_NOT_EMPTY" });
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("UPDATE core.tenants SET tenant_code=$1,display_name=$2 WHERE id='0199c800-0000-7000-8000-000000000001'", [tenantCode, tenantName]);
      await client.query(`
        INSERT INTO ops.seed_runs
          (tenant_id, seed_name, seed_version, as_of, checksum, started_at, completed_at, result)
        VALUES
          ('0199c800-0000-7000-8000-000000000001', 'technical-minimal', '1', $1, $2,
           clock_timestamp(), clock_timestamp(), 'success')
      `, [asOf, checksum]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    output(JSON.stringify({ event: "db_seed_completed", seed: "technical-minimal", result: "success", checksum }));
    return { seed: "technical-minimal", checksum };
  } catch (error) {
    output(JSON.stringify({ event: "db_seed_completed", seed: "technical-minimal", result: "failed", errorCode: error.code || "DB_SEED_FAILED" }));
    throw error;
  } finally {
    await client.end();
  }
}

async function applyFullDevelSeed({ connectionConfig, asOf, output = console.log }) {
  const parsedAsOf = new Date(asOf);
  if (!asOf || Number.isNaN(parsedAsOf.getTime()) || parsedAsOf.toISOString() !== asOf) {
    throw Object.assign(new Error("Seed as_of muss ein kanonischer ISO-Zeitpunkt sein"), { code: "SEED_AS_OF_INVALID" });
  }
  const sql = fs.readFileSync(FULL_DEVEL_SEED, "utf8");
  const expected = JSON.parse(fs.readFileSync(FULL_DEVEL_EXPECTED, "utf8"));
  const checksum = seedChecksum(`${sql}\n${JSON.stringify(expected)}\nfull-devel-as-of:v2`);
  const client = new Client(connectionConfig);
  await client.connect();
  output(JSON.stringify({ event: "db_seed_started", seed: "full-devel", asOf }));
  try {
    const state = await client.query(`
      SELECT count(*) FILTER (WHERE seed_name = 'technical-minimal' AND result = 'success') AS technical_count,
             count(*) FILTER (WHERE seed_name = 'full-devel' AND result = 'success') AS full_count
        FROM ops.seed_runs
    `);
    if (Number(state.rows[0].technical_count) !== 1) throw Object.assign(new Error("Technischer Seed fehlt"), { code: "SEED_DEPENDENCY_MISSING" });
    if (Number(state.rows[0].full_count) !== 0) throw Object.assign(new Error("Full-Devel-Seed ist bereits vorhanden"), { code: "SEED_ALREADY_APPLIED" });
    let validation;
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await shiftFullDevelAsOf(client, asOf);
      await client.query(`
        INSERT INTO ops.seed_runs
          (tenant_id, seed_name, seed_version, as_of, checksum, started_at, completed_at, result)
        VALUES
          ('0199c800-0000-7000-8000-000000000001', 'full-devel', '1', $1, $2,
           clock_timestamp(), clock_timestamp(), 'success')
      `, [asOf, checksum]);
      validation = await validateFullDevelSeed(client, expected);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    output(JSON.stringify({ event: "db_seed_completed", seed: "full-devel", result: "success", checksum, projectionChecksum: validation.checksum }));
    return { seed: "full-devel", checksum, projectionChecksum: validation.checksum };
  } catch (error) {
    output(JSON.stringify({ event: "db_seed_completed", seed: "full-devel", result: "failed", errorCode: error.code || "DB_SEED_FAILED" }));
    throw error;
  } finally {
    await client.end();
  }
}

module.exports = { applyFullDevelSeed, applyTechnicalSeed, seedChecksum, shiftFullDevelAsOf, validateFullDevelSeed, FULL_DEVEL_EXPECTED, FULL_DEVEL_REFERENCE_AS_OF, FULL_DEVEL_SEED, TECHNICAL_SEED };
