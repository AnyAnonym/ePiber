"use strict";

const { Client } = require("pg");
const { TABLES, approveWarnings, transformSource } = require("./importRunner");
const { canonicalJson, sha256 } = require("./transformCommon");

const DOMAIN_TABLES = Object.freeze({
  identity: ["people", "person_contacts", "person_addresses", "person_external_identifiers", "memberships", "user_accounts", "credentials", "tenant_role_assignments"],
  play: ["competition_types", "competition_type_versions", "match_formats", "match_format_versions", "competitions", "competition_gender_eligibility", "competition_entries", "ranking_entries", "matches", "match_sides", "match_participants", "match_results", "match_result_sets", "match_result_history", "ranking_changes", "ranking_change_items", "match_ranking_effects"],
  venue: ["sites", "courts", "score_sources", "court_assignments", "court_assignment_participants", "court_live_state", "score_events", "hall_time_grids", "hall_time_grid_participants", "hall_time_slots", "hall_time_allocations", "hall_time_constraints", "hall_time_history", "hall_time_history_items", "monitor_devices"],
  messaging: ["notification_preferences", "events", "event_participants", "event_recipients", "receipts", "deliveries", "comments", "reactions", "user_revisions", "history_revision"],
  preferences: ["user_favorites", "user_start_pages", "user_preference_states", "navigation_presets", "frontend_logging_settings"],
  operations: ["idempotency_operations", "audit_operations", "audit_transitions"],
});

const PRIVATE_COLUMN = /(?:address|attempted_login|before_projection|birth|contact_value|detail|email|first_name|free_text|hash|last_name|login|name_snapshot|note|payload|phone|projection|request_hash|secret|sha256|source_ip|summary|text|token)/i;

function controlledValue(value) {
  if (value === undefined) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const milliseconds = Date.parse(value);
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString();
  }
  return value;
}

function controlledRow(row, columns = null) {
  return Object.fromEntries(Object.entries(row)
    .filter(([column]) => (!columns || columns.has(column)) && !PRIVATE_COLUMN.test(column))
    .map(([column, value]) => [column, controlledValue(value)]));
}

function tableSignature(rows, columns = null) {
  const projected = rows.map((row) => controlledRow(row, columns)).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const columnNames = [...new Set(projected.flatMap((row) => Object.keys(row)))].sort();
  const columnHashes = Object.fromEntries(columnNames.map((name) => [name, sha256(projected
    .map((row) => [row.id ?? null, row[name] ?? null])
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))))]));
  return { count: projected.length, sha256: sha256(projected), columnHashes };
}

function sourceColumns(tables) {
  return Object.fromEntries(Object.keys(TABLES).map((name) => [name, new Set((tables[name] || []).flatMap((row) => Object.keys(row)))]));
}

function domainSignatures(tables, columns = null) {
  return Object.fromEntries(Object.entries(DOMAIN_TABLES).map(([domain, names]) => {
    const signature = Object.fromEntries(names.map((name) => [name, tableSignature(tables[name] || [], columns?.[name] || null)]));
    return [domain, {
      count: Object.values(signature).reduce((sum, item) => sum + item.count, 0),
      sha256: sha256(signature),
      tables: signature,
    }];
  }));
}

async function readTargetTables(client) {
  const tables = {};
  for (const [name, table] of Object.entries(TABLES)) {
    const result = await client.query(`SELECT to_jsonb(target_row) AS value FROM ${table} target_row`);
    tables[name] = result.rows.map(({ value }) => value);
  }
  return tables;
}

async function unresolvedOperations(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM ops.idempotency_operations WHERE status IN ('started','unknown')) AS idempotency,
      (SELECT count(*)::integer FROM ops.jobs WHERE status IN ('pending','leased','retrying','unknown')) AS jobs,
      (SELECT count(*)::integer FROM ops.outbox WHERE status IN ('pending','leased','retrying','unknown')) AS outbox,
      (SELECT count(*)::integer FROM ops.audit_operations WHERE status='started') AS audit
  `);
  return result.rows[0];
}

async function runShadowRead({ root, connectionConfig, output = () => {} }) {
  output(JSON.stringify({ event: "db_shadow_read_started" }));
  const transformed = transformSource(root);
  if (transformed.status !== "ready" || !transformed.plan) {
    const error = Object.assign(new Error("Shadow-Read-Quelle ist blockiert"), { code: "SHADOW_READ_SOURCE_BLOCKED" });
    output(JSON.stringify({ event: "db_shadow_read_completed", result: "rejected", errorCode: error.code }));
    throw error;
  }
  approveWarnings(root, transformed);
  const client = new Client(connectionConfig);
  await client.connect();
  try {
    const imported = await client.query("SELECT result FROM ops.import_runs WHERE export_run_id=$1", [transformed.inspection.manifest.exportRunId]);
    if (imported.rowCount !== 1 || imported.rows[0].result !== "success") throw Object.assign(new Error("Erfolgreicher Importlauf fehlt"), { code: "SHADOW_READ_IMPORT_MISSING" });
    const columns = sourceColumns(transformed.plan.tables);
    const source = domainSignatures(transformed.plan.tables, columns);
    const target = domainSignatures(await readTargetTables(client), columns);
    const domains = Object.keys(DOMAIN_TABLES).map((name) => {
      const tables = DOMAIN_TABLES[name].map((table) => ({
        name: table,
        sourceCount: source[name].tables[table].count,
        targetCount: target[name].tables[table].count,
        sourceSha256: source[name].tables[table].sha256,
        targetSha256: target[name].tables[table].sha256,
        match: source[name].tables[table].count === target[name].tables[table].count && source[name].tables[table].sha256 === target[name].tables[table].sha256,
        mismatchedColumns: [...new Set([...Object.keys(source[name].tables[table].columnHashes), ...Object.keys(target[name].tables[table].columnHashes)])]
          .filter((column) => source[name].tables[table].columnHashes[column] !== target[name].tables[table].columnHashes[column])
          .sort(),
      }));
      return {
        name,
        sourceCount: source[name].count,
        targetCount: target[name].count,
        sourceSha256: source[name].sha256,
        targetSha256: target[name].sha256,
        match: tables.every((table) => table.match),
        mismatches: tables.filter((table) => !table.match),
      };
    });
    const unresolved = await unresolvedOperations(client);
    const status = domains.every((domain) => domain.match) && Object.values(unresolved).every((count) => Number(count) === 0) ? "match" : "blocked";
    const report = {
      reportVersion: 1,
      exportRunId: transformed.inspection.manifest.exportRunId,
      manifestSha256: transformed.inspection.manifestSha256,
      status,
      domains,
      unresolved,
      shadowSha256: sha256({ domains, unresolved }),
    };
    output(JSON.stringify({ event: "db_shadow_read_completed", result: status === "match" ? "success" : "failed", ...report }));
    if (status !== "match") {
      const mismatchDomains = domains.filter((domain) => !domain.match).flatMap((domain) => domain.mismatches.map((table) => `${domain.name}.${table.name}`));
      const unresolvedKinds = Object.entries(unresolved).filter(([, count]) => Number(count) > 0).map(([name]) => name);
      throw Object.assign(new Error(`Shadow-Read weicht ab: ${[...mismatchDomains, ...unresolvedKinds].join(",")}`), { code: "SHADOW_READ_MISMATCH", report, completionLogged: true });
    }
    return report;
  } catch (error) {
    if (!error.completionLogged) output(JSON.stringify({ event: "db_shadow_read_completed", result: "failed", errorCode: error.code || "SHADOW_READ_FAILED" }));
    throw error;
  } finally {
    await client.end();
  }
}

module.exports = { DOMAIN_TABLES, controlledRow, domainSignatures, runShadowRead, sourceColumns, tableSignature };
