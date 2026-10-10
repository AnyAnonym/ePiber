"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MATRIX_FILE = path.join(__dirname, "import", "source-target.json");
const EXCEPTION_SCHEMA_FILE = path.join(__dirname, "import", "exception-manifest.schema.json");

const REQUIRED_TABLES = {
  "state.sqlite": ["app_state", "sessions", "monitor_devices", "operations", "login_failures"],
  "scorelog.sqlite": ["score_log_sequence", "score_log"],
  "audit.sqlite": ["audit_log"],
  "messaging.sqlite": [
    "competition_events", "event_participants", "event_receipts", "event_deliveries",
    "event_ack_operations", "messaging_revisions", "message_bulk_ack_operations",
    "event_comments", "comment_reactions", "event_reactions",
    "event_interaction_operations", "competition_history_revision"
  ]
};

function loadImportContracts() {
  const matrix = JSON.parse(fs.readFileSync(MATRIX_FILE, "utf8"));
  const exceptionSchema = JSON.parse(fs.readFileSync(EXCEPTION_SCHEMA_FILE, "utf8"));
  if (matrix.version !== 1 || matrix.unknownFieldPolicy !== "block") throw new Error("IMPORT_MATRIX_POLICY_INVALID");
  for (const [source, tables] of Object.entries(REQUIRED_TABLES)) {
    if (!matrix.sources[source]) throw new Error(`IMPORT_SOURCE_MISSING:${source}`);
    for (const table of tables) {
      const contract = matrix.sources[source][table];
      if (!contract || !contract.disposition || !contract.fields || !Object.keys(contract.fields).length) throw new Error(`IMPORT_TABLE_MISSING:${source}:${table}`);
      for (const [field, target] of Object.entries(contract.fields)) {
        if (!field || typeof target !== "string" || !target) throw new Error(`IMPORT_FIELD_INVALID:${source}:${table}:${field}`);
      }
    }
  }
  if (exceptionSchema.additionalProperties !== false || exceptionSchema.properties?.rules?.items?.additionalProperties !== false) {
    throw new Error("IMPORT_EXCEPTION_SCHEMA_OPEN");
  }
  return { matrix, exceptionSchema };
}

module.exports = { EXCEPTION_SCHEMA_FILE, MATRIX_FILE, REQUIRED_TABLES, loadImportContracts };
