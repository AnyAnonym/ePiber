#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { exportLegacySource } = require("../db/export/legacyExporter");
const { readSecret } = require("../db/connectionConfig");
const { PROFILE: PAJ_REFRESH_PROFILE } = require("../db/export/pajRefreshProfile");

function parseEnv(filename) {
  const values = {};
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw Object.assign(new Error("Usage: db-export.js --output DIR --run-id ID --source-env FILE --credentials FILE [--profile migration-v1|paj-refresh-v1 --test-password-hash-file FILE]"), { code: "EXPORT_ARGUMENT_INVALID" });
    options[key.slice(2)] = value;
  }
  for (const key of ["output", "run-id", "source-env", "credentials"]) if (!options[key]) throw Object.assign(new Error(`${key} fehlt`), { code: "EXPORT_ARGUMENT_INVALID" });
  const allowed = new Set(["output", "run-id", "source-env", "credentials", "profile", "test-password-hash-file"]);
  if (Object.keys(options).some((key) => !allowed.has(key))) throw Object.assign(new Error("Unbekannte Exportoption"), { code: "EXPORT_ARGUMENT_INVALID" });
  const profile = options.profile || "migration-v1";
  if (!new Set(["migration-v1", PAJ_REFRESH_PROFILE]).has(profile) || profile === PAJ_REFRESH_PROFILE && !options["test-password-hash-file"]) throw Object.assign(new Error("Exportprofil ist unvollstaendig"), { code: "EXPORT_ARGUMENT_INVALID" });
  return {
    output: path.resolve(options.output), runId: options["run-id"], sourceEnv: path.resolve(options["source-env"]),
    credentials: path.resolve(options.credentials), profile,
    testPasswordHashFile: options["test-password-hash-file"] ? path.resolve(options["test-password-hash-file"]) : null,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const env = parseEnv(options.sourceEnv);
  console.log(JSON.stringify({ event: "legacy_export_started", exportRunId: options.runId, profile: options.profile, sourceMode: process.env.EPIBER_EXPORT_PRE_SNAPSHOTTED === "1" ? "prepared-snapshots" : "live-sqlite" }));
  try {
    const result = await exportLegacySource({
      root: options.output, exportRunId: options.runId, spreadsheetId: env.SHEET_ID,
      credentialsFile: options.credentials,
      profile: options.profile,
      testPasswordHash: options.testPasswordHashFile ? readSecret(options.testPasswordHashFile) : null,
      preSnapshotted: process.env.EPIBER_EXPORT_PRE_SNAPSHOTTED === "1",
      sqliteFiles: {
        STATE_FILE: process.env.STATE_FILE || env.STATE_FILE || "/var/lib/epiber-paj/state.sqlite",
        MESSAGING_FILE: process.env.MESSAGING_FILE || env.MESSAGING_FILE || "/var/lib/epiber-paj/messaging.sqlite",
        SCORELOG_FILE: process.env.SCORELOG_FILE || env.SCORELOG_FILE || "/var/lib/epiber-paj/scorelog.sqlite",
        AUDITLOG_FILE: process.env.AUDITLOG_FILE || env.AUDITLOG_FILE || "/var/lib/epiber-paj/audit.sqlite",
      },
    });
    console.log(JSON.stringify({ event: "legacy_export_completed", result: "success", ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: "legacy_export_completed", result: "failed", errorCode: error.code || "LEGACY_EXPORT_FAILED" }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { main, parseArguments, parseEnv };
