"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { inspectSheetCsv } = require("./sheetInspector");
const { inspectSqliteSchemas } = require("./sourceInspector");
const { verifySourcePackage } = require("./sourcePackage");
const { transformSheets } = require("./sheetTransformer");
const { transformSqlite } = require("./sqliteTransformer");
const { ImportTransformError, RULE_VERSION, TENANT_ID, canonicalJson, sha256, stableUuid } = require("./transformCommon");

const EXCEPTION_MANIFEST = "exception-manifest.json";

const TABLES = {
  people: "identity.people", person_contacts: "identity.person_contacts", person_addresses: "identity.person_addresses",
  person_external_identifiers: "identity.person_external_identifiers", memberships: "identity.memberships", user_accounts: "identity.user_accounts",
  credentials: "identity.credentials", tenant_role_assignments: "identity.tenant_role_assignments", notification_preferences: "messaging.notification_preferences",
  competition_types: "play.competition_types", competition_type_versions: "play.competition_type_versions", match_formats: "play.match_formats",
  match_format_versions: "play.match_format_versions", competitions: "play.competitions", competition_gender_eligibility: "play.competition_gender_eligibility",
  competition_entries: "play.competition_entries", ranking_entries: "play.ranking_entries", matches: "play.matches", match_sides: "play.match_sides",
  match_participants: "play.match_participants", match_results: "play.match_results", match_result_sets: "play.match_result_sets",
  match_result_history: "play.match_result_history", sites: "venue.sites", courts: "venue.courts", score_sources: "venue.score_sources",
  court_live_state: "venue.court_live_state", score_events: "venue.score_events", monitor_devices: "venue.monitor_devices",
  navigation_presets: "venue.navigation_presets", frontend_logging_settings: "identity.frontend_logging_settings",
  idempotency_operations: "ops.idempotency_operations", events: "messaging.events", event_participants: "messaging.event_participants",
  event_recipients: "messaging.event_recipients", receipts: "messaging.receipts", deliveries: "messaging.deliveries", comments: "messaging.comments",
  reactions: "messaging.reactions", user_revisions: "messaging.user_revisions", audit_operations: "ops.audit_operations",
  audit_security_context: "ops.audit_security_context", audit_transitions: "ops.audit_transitions",
};

const INSERT_ORDER = Object.keys(TABLES);
const BYTE_COLUMNS = new Set(["token_hash", "request_hash", "source_sha256"]);
const JSON_COLUMNS = new Set(["response_projection", "template_parameters", "before_projection", "after_projection"]);

function readMetadata(root, filename) {
  const full = path.join(root, "metadata", filename);
  try {
    const value = JSON.parse(fs.readFileSync(full, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error("Quellmetadaten sind ungueltig"), { code: "SOURCE_METADATA_INVALID", source: filename });
  }
}

function inspectSource(root) {
  const verified = verifySourcePackage(root);
  const sheetMetadata = readMetadata(root, "sheets.json"), sqliteMetadata = readMetadata(root, "sqlite.json");
  return {
    ...verified,
    sheets: inspectSheetCsv(root),
    sqlite: inspectSqliteSchemas(root),
    metadata: { sheets: Object.keys(sheetMetadata).length, sqlite: Object.keys(sqliteMetadata).length },
  };
}

function planSignature(tables) {
  return Object.fromEntries(Object.keys(tables).sort().map((name) => [name, {
    count: tables[name].length,
    rows: tables[name].map((row) => sha256(row)).sort(),
  }]));
}

const UNIQUE_PROJECTIONS = {
  people: [["id"], ["tenant_id", "contract_id"]],
  person_contacts: [["id"], ["person_id", "contact_type"]],
  person_external_identifiers: [["id"], ["tenant_id", "provider", "external_value"]],
  memberships: [["id"], ["section_id", "person_id"]],
  user_accounts: [["id"], ["person_id"], ["tenant_id", "login"]], credentials: [["id"], ["account_id", "credential_type"]],
  tenant_role_assignments: [["id"], ["tenant_id", "person_id", "role_code"]], notification_preferences: [["person_id", "channel"]],
  competition_types: [["id"], ["tenant_id", "contract_id"]], competition_type_versions: [["id"], ["competition_type_id", "version_no"]],
  match_formats: [["id"], ["tenant_id", "contract_id"]], match_format_versions: [["id"], ["match_format_id", "version_no"]],
  competitions: [["id"], ["section_id", "contract_id"]], competition_entries: [["id"], ["competition_id", "contract_id"], ["competition_id", "person_id"]],
  ranking_entries: [["id"], ["competition_id", "person_id"], ["competition_id", "contract_id"], ["competition_id", "rank"]],
  matches: [["id"], ["competition_id", "contract_id"]], match_sides: [["id"], ["match_id", "side_no"]],
  match_participants: [["id"], ["side_id", "position_no"], ["match_id", "person_id"]], match_results: [["id"], ["match_id", "version_no"]],
  match_result_sets: [["result_id", "set_no"]], match_result_history: [["id"], ["operation_id"]],
  sites: [["id"], ["section_id", "site_code"]], courts: [["id"], ["site_id", "court_code"]], score_sources: [["id"], ["source_type", "source_key"]],
  score_events: [["id"], ["event_id"], ["court_id", "court_sequence"]], monitor_devices: [["id"], ["tenant_id", "contract_id"], ["token_hash"]],
  navigation_presets: [["id"], ["tenant_id", "profile_code", "label"]], idempotency_operations: [["id"], ["tenant_id", "operation_id"]],
  events: [["id"], ["tenant_id", "contract_id"], ["tenant_id", "source_operation_id", "event_type"]],
  event_participants: [["event_id", "participant_role", "contract_id_snapshot"]], event_recipients: [["id"], ["event_id", "person_id"]],
  receipts: [["recipient_id"]], deliveries: [["id"], ["recipient_id", "channel"], ["channel", "idempotency_key"]], comments: [["id"]],
  reactions: [["id"], ["event_id", "person_id", "reaction_key"], ["comment_id", "person_id", "reaction_key"]], user_revisions: [["person_id"]],
  audit_operations: [["id"], ["tenant_id", "operation_id"]], audit_security_context: [["audit_operation_id"]], audit_transitions: [["id"], ["audit_operation_id", "transition"]],
};

function validatePlanUniqueness(tables) {
  for (const [table, projections] of Object.entries(UNIQUE_PROJECTIONS)) for (const columns of projections) {
    const seen = new Set();
    for (const row of tables[table] || []) {
      const values = columns.map((column) => row[column]);
      if (values.some((value) => value === null || value === undefined)) continue;
      const key = canonicalJson(values);
      if (seen.has(key)) throw new ImportTransformError("TARGET_UNIQUE_CONFLICT", `transform:${table}`, columns.join("+"));
      seen.add(key);
    }
  }
}

function transformSource(root) {
  const inspection = inspectSource(root);
  try {
    const sheets = transformSheets(root);
    for (const row of sheets.tables.match_result_history) if (!row.changed_at) row.changed_at = inspection.manifest.exportStartedAt;
    const sqlite = transformSqlite(root, sheets.refs, inspection.manifest);
    const tables = { ...sheets.tables, ...sqlite.tables };
    validatePlanUniqueness(tables);
    const findings = [...sheets.findings, ...sqlite.findings].sort((a, b) => `${a.severity}:${a.code}:${a.source}`.localeCompare(`${b.severity}:${b.code}:${b.source}`));
    const signature = planSignature(tables), transformedSha256 = sha256(signature);
    return {
      inspection, plan: { tables, signature, transformedSha256 }, findings,
      sourceCounts: { sheets: sheets.counts, sqlite: inspection.sqlite },
      status: findings.some((item) => item.severity === "blocker") ? "blocked" : "ready",
    };
  } catch (error) {
    if (!(error instanceof ImportTransformError)) throw error;
    return {
      inspection, plan: null, sourceCounts: { sheets: inspection.sheets, sqlite: inspection.sqlite }, status: "blocked",
      findings: [{ code: error.code, source: error.source, projection: error.projection, severity: "blocker", count: 1, ruleVersion: RULE_VERSION }],
    };
  }
}

function approveWarnings(root, transformed) {
  const warnings = transformed.findings.filter((item) => item.severity === "warning");
  const filename = path.join(root, EXCEPTION_MANIFEST);
  if (!warnings.length) {
    if (fs.existsSync(filename)) throw Object.assign(new Error("Ausnahmemanifest ist ohne Warnungen unzulaessig"), { code: "IMPORT_EXCEPTION_MANIFEST_UNEXPECTED" });
    return { rules: [], sha256: null };
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(filename, "utf8")); } catch { throw Object.assign(new Error("Ausnahmemanifest fehlt oder ist ungueltig"), { code: "IMPORT_WARNINGS_UNAPPROVED" }); }
  const exact = ["approvedAt", "approvedBy", "exportRunId", "manifestVersion", "rules", "sourceManifestSha256"];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(exact)
      || manifest.manifestVersion !== 1 || manifest.exportRunId !== transformed.inspection.manifest.exportRunId
      || manifest.sourceManifestSha256 !== transformed.inspection.manifestSha256
      || !/^[A-Za-z0-9_.:@-]{1,128}$/.test(manifest.approvedBy || "")
      || Number.isNaN(Date.parse(manifest.approvedAt)) || new Date(manifest.approvedAt).toISOString() !== manifest.approvedAt
      || !Array.isArray(manifest.rules)) {
    throw Object.assign(new Error("Ausnahmemanifest weicht vom Vertrag ab"), { code: "IMPORT_EXCEPTION_MANIFEST_INVALID" });
  }
  const expectedRuleKeys = ["code", "handling", "projection", "reasonCode", "source", "validation"];
  const approved = new Set();
  for (const rule of manifest.rules) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule) || JSON.stringify(Object.keys(rule).sort()) !== JSON.stringify(expectedRuleKeys)
        || !/^[A-Z][A-Z0-9_]{2,63}$/.test(rule.code || "") || !["discard", "archive_only", "transform"].includes(rule.handling)
        || !/^[A-Z][A-Z0-9_]{2,63}$/.test(rule.reasonCode || "") || !/^[a-z][a-z0-9_.:-]{2,127}$/.test(rule.validation || "")) {
      throw Object.assign(new Error("Ausnahmeregel ist ungueltig"), { code: "IMPORT_EXCEPTION_RULE_INVALID" });
    }
    const key = `${rule.code}\0${rule.source}\0${rule.projection}`;
    if (approved.has(key)) throw Object.assign(new Error("Ausnahmeregel ist doppelt"), { code: "IMPORT_EXCEPTION_RULE_DUPLICATE" });
    approved.add(key);
  }
  const required = new Set(warnings.map((item) => `${item.code}\0${item.source}\0${item.projection}`));
  if (approved.size !== required.size || [...required].some((key) => !approved.has(key))) throw Object.assign(new Error("Warnungen sind nicht vollstaendig freigegeben"), { code: "IMPORT_WARNINGS_UNAPPROVED" });
  return { rules: manifest.rules, sha256: sha256(fs.readFileSync(filename)) };
}

function sqlIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("SQL_IDENTIFIER_INVALID");
  return `"${value}"`;
}

async function insertRows(client, tableName, rows, { omit = [] } = {}) {
  let count = 0;
  for (const original of rows) {
    const row = Object.fromEntries(Object.entries(original).filter(([key]) => !omit.includes(key)));
    const columns = Object.keys(row), values = columns.map((column) => {
      const value = row[column];
      if (value === null || value === undefined) return null;
      if (BYTE_COLUMNS.has(column)) return Buffer.from(value, "hex");
      if (JSON_COLUMNS.has(column)) return JSON.stringify(value);
      return value;
    });
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    await client.query(`INSERT INTO ${tableName} (${columns.map(sqlIdentifier).join(", ")}) VALUES (${placeholders})`, values);
    count++;
  }
  return count;
}

async function ensureFreshTarget(client) {
  const roots = ["identity.people", "play.competition_types", "play.match_formats", "play.competitions", "venue.sites", "messaging.events", "ops.audit_operations", "ops.idempotency_operations"];
  for (const table of roots) {
    const result = await client.query(`SELECT count(*)::integer AS count FROM ${table}`);
    if (result.rows[0].count !== 0) throw Object.assign(new Error("Importziel ist nicht leer"), { code: "IMPORT_TARGET_NOT_EMPTY", table });
  }
  const seed = await client.query("SELECT count(*)::integer AS count FROM ops.seed_runs WHERE seed_name='technical-minimal' AND result='success'");
  if (seed.rows[0].count !== 1) throw Object.assign(new Error("Technischer Seed fehlt"), { code: "IMPORT_SEED_MISSING" });
}

async function validateInserted(client, plan, { repairSequence = false } = {}) {
  const counts = {}, projection = {};
  for (const [name, table] of Object.entries(TABLES)) {
    const result = await client.query(`SELECT to_jsonb(target_row) AS value FROM ${table} target_row`);
    counts[name] = result.rowCount;
    if (counts[name] !== plan.tables[name].length) throw Object.assign(new Error("Zielanzahl weicht ab"), { code: "IMPORT_COUNT_MISMATCH", table: name });
    projection[name] = result.rows.map(({ value }) => value).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  }
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  const sequence = await client.query("SELECT COALESCE(max(contract_id::bigint), 0)::text AS maximum FROM identity.people");
  if (repairSequence) await client.query("SELECT setval('identity.person_contract_id_seq', GREATEST(1, $1::bigint), $1::bigint > 0)", [sequence.rows[0].maximum]);
  else {
    const state = await client.query("SELECT last_value::text, is_called FROM identity.person_contract_id_seq");
    if (BigInt(state.rows[0].last_value) < BigInt(sequence.rows[0].maximum) || Number(sequence.rows[0].maximum) > 0 && !state.rows[0].is_called) {
      throw Object.assign(new Error("Personensequenz weicht ab"), { code: "IMPORT_SEQUENCE_MISMATCH" });
    }
  }
  return { counts, targetSha256: sha256(projection) };
}

async function validateExisting(client, transformed, approval) {
  const existing = await client.query("SELECT transformed_sha256, exception_manifest_sha256, target_sha256, target_counts, result FROM ops.import_runs WHERE tenant_id=$1 AND export_run_id=$2", [TENANT_ID, transformed.inspection.manifest.exportRunId]);
  if (!existing.rowCount) return null;
  const row = existing.rows[0];
  const storedException = row.exception_manifest_sha256?.toString("hex") || null;
  if (row.result !== "success" || row.transformed_sha256.toString("hex") !== transformed.plan.transformedSha256 || storedException !== approval.sha256) throw Object.assign(new Error("Vorhandener Importlauf weicht ab"), { code: "IMPORT_REPLAY_CONFLICT" });
  return { repeated: true, counts: row.target_counts, targetSha256: row.target_sha256.toString("hex") };
}

async function applyImport({ root, connectionConfig, output = () => {}, failAfterTable = null }) {
  output(JSON.stringify({ event: "db_import_started", command: "apply" }));
  const transformed = transformSource(root);
  if (transformed.status !== "ready" || !transformed.plan) {
    output(JSON.stringify({ event: "db_import_completed", command: "apply", result: "rejected", errorCode: "IMPORT_BLOCKED", findingCount: transformed.findings.length }));
    throw Object.assign(new Error("Import ist durch Befunde blockiert"), { code: "IMPORT_BLOCKED", findings: transformed.findings, completionLogged: true });
  }
  let approval;
  try { approval = approveWarnings(root, transformed); } catch (error) {
    output(JSON.stringify({ event: "db_import_completed", command: "apply", result: "rejected", errorCode: error.code, findingCount: transformed.findings.length }));
    throw Object.assign(error, { findings: transformed.findings, completionLogged: true });
  }
  const client = new Client(connectionConfig);
  await client.connect();
  try {
    const replay = await validateExisting(client, transformed, approval);
    if (replay) {
      const current = await validateInserted(client, transformed.plan);
      if (current.targetSha256 !== replay.targetSha256) throw Object.assign(new Error("Wiederholungsziel weicht ab"), { code: "IMPORT_TARGET_FINGERPRINT_MISMATCH" });
      output(JSON.stringify({ event: "db_import_completed", command: "apply", result: "success", repeated: true, targetSha256: replay.targetSha256 }));
      return { ...replay, transformedSha256: transformed.plan.transformedSha256 };
    }
    await ensureFreshTarget(client);
    await client.query("BEGIN");
    try {
      const runId = stableUuid("import-run", transformed.inspection.manifest.exportRunId);
      await client.query(`INSERT INTO ops.import_runs
        (id, tenant_id, source_instance, export_run_id, source_manifest_sha256, format_version, rule_version, transformed_sha256, exception_manifest_sha256, source_counts, started_at, result)
        VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,clock_timestamp(),'running')`, [runId, TENANT_ID, "legacy-epiber", transformed.inspection.manifest.exportRunId, Buffer.from(transformed.inspection.manifestSha256, "hex"), RULE_VERSION, Buffer.from(transformed.plan.transformedSha256, "hex"), approval.sha256 ? Buffer.from(approval.sha256, "hex") : null, JSON.stringify(transformed.sourceCounts)]);
      for (const item of transformed.findings) await client.query(`INSERT INTO ops.import_findings(import_run_id, finding_code, source_projection, severity, count) VALUES ($1,$2,$3,$4,$5)`, [runId, item.code, item.projection, item.severity, item.count]);
      const inserted = {};
      for (const name of INSERT_ORDER) {
        inserted[name] = await insertRows(client, TABLES[name], transformed.plan.tables[name], name === "matches" ? { omit: ["current_result_id"] } : undefined);
        if (failAfterTable === name) throw Object.assign(new Error("Absichtlicher Importabbruch"), { code: "IMPORT_TEST_ABORT" });
      }
      for (const match of transformed.plan.tables.matches.filter((row) => row.current_result_id)) await client.query("UPDATE play.matches SET current_result_id=$1 WHERE id=$2", [match.current_result_id, match.id]);
      const validated = await validateInserted(client, transformed.plan, { repairSequence: true });
      await client.query(`UPDATE ops.import_runs SET completed_at=clock_timestamp(), validated_at=clock_timestamp(), result='success', target_sha256=$2, target_counts=$3 WHERE id=$1`, [runId, Buffer.from(validated.targetSha256, "hex"), JSON.stringify(validated.counts)]);
      try { await client.query("COMMIT"); } catch (error) {
        throw Object.assign(error, { code: "IMPORT_COMMIT_UNKNOWN", outcome: "unknown" });
      }
      output(JSON.stringify({ event: "db_import_completed", command: "apply", result: "success", repeated: false, transformedSha256: transformed.plan.transformedSha256, targetSha256: validated.targetSha256, counts: validated.counts }));
      return { repeated: false, transformedSha256: transformed.plan.transformedSha256, ...validated };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } catch (error) {
    if (!error.completionLogged) output(JSON.stringify({ event: "db_import_completed", command: "apply", result: error.outcome || "failed", errorCode: error.code || "DB_IMPORT_FAILED" }));
    throw error;
  } finally { await client.end(); }
}

async function validateImport({ root, connectionConfig, output = () => {} }) {
  output(JSON.stringify({ event: "db_import_started", command: "validate" }));
  const transformed = transformSource(root);
  if (!transformed.plan || transformed.status !== "ready") throw Object.assign(new Error("Import ist blockiert"), { code: "IMPORT_BLOCKED" });
  const approval = approveWarnings(root, transformed);
  const client = new Client(connectionConfig);
  await client.connect();
  try {
    const existing = await validateExisting(client, transformed, approval);
    if (!existing) throw Object.assign(new Error("Importlauf fehlt"), { code: "IMPORT_RUN_MISSING" });
    const result = await validateInserted(client, transformed.plan);
    if (result.targetSha256 !== existing.targetSha256) throw Object.assign(new Error("Zielpruefsumme weicht ab"), { code: "IMPORT_TARGET_FINGERPRINT_MISMATCH" });
    output(JSON.stringify({ event: "db_import_completed", command: "validate", result: "success", targetSha256: result.targetSha256 }));
    return result;
  } catch (error) {
    output(JSON.stringify({ event: "db_import_completed", command: "validate", result: "failed", errorCode: error.code || "DB_IMPORT_VALIDATE_FAILED" }));
    throw error;
  } finally { await client.end(); }
}

function summarizeTransform(transformed, command) {
  return {
    command, status: transformed.status, exportRunId: transformed.inspection.manifest.exportRunId,
    manifestSha256: transformed.inspection.manifestSha256,
    transformedSha256: transformed.plan?.transformedSha256 || null,
    counts: transformed.plan ? Object.fromEntries(Object.entries(transformed.plan.tables).map(([name, rows]) => [name, rows.length])) : null,
    findings: transformed.findings,
  };
}

module.exports = { TABLES, applyImport, approveWarnings, inspectSource, summarizeTransform, transformSource, validateImport };
