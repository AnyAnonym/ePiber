#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { createConnectionConfig } = require("../db/connectionConfig");
const { applyImport, inspectSource, summarizeTransform, transformSource, validateImport } = require("../db/import/importRunner");

function parseArguments(argv) {
  const [command, directory, ...rest] = argv;
  if (!["inspect", "dry-run", "apply", "validate"].includes(command) || !directory || rest.length) {
    throw Object.assign(new Error("Usage: db-import.js inspect|dry-run|apply|validate <source-package>"), { code: "IMPORT_ARGUMENT_INVALID" });
  }
  return { command, root: path.resolve(directory) };
}

async function main() {
  const { command, root } = parseArguments(process.argv.slice(2));
  if (command === "apply") return applyImport({ root, connectionConfig: createConnectionConfig(), output: console.log });
  if (command === "validate") return validateImport({ root, connectionConfig: createConnectionConfig(), output: console.log });
  console.log(JSON.stringify({ event: "db_import_started", command }));
  const result = command === "inspect"
    ? (() => { const inspection = inspectSource(root); return { command, status: "ready", exportRunId: inspection.manifest.exportRunId, manifestSha256: inspection.manifestSha256, sheets: inspection.sheets, sqlite: inspection.sqlite }; })()
    : summarizeTransform(transformSource(root), command);
  console.log(JSON.stringify({ event: "db_import_completed", command, result: result.status === "blocked" ? "blocked" : "success", ...result }));
  if (result.status === "blocked") process.exitCode = 2;
  return result;
}

if (require.main === module) main().catch((error) => {
  if (!error.completionLogged) console.error(JSON.stringify({ event: "db_import_completed", result: error.outcome || "failed", errorCode: error.code || "DB_IMPORT_FAILED" }));
  process.exitCode = 1;
});

module.exports = { main, parseArguments };
