#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { createConnectionConfig } = require("../db/connectionConfig");
const { applyPajRefresh, inspectPajRefresh, validatePajRefresh } = require("../db/import/pajRefresh");

async function main() {
  const [command, directory, ...rest] = process.argv.slice(2);
  if (!new Set(["inspect", "dry-run", "apply", "validate"]).has(command) || !directory || rest.length) {
    throw Object.assign(new Error("Usage: db-paj-refresh.js inspect|dry-run|apply|validate <source-package>"), { code: "PAJ_REFRESH_ARGUMENT_INVALID" });
  }
  const root = path.resolve(directory);
  if (command === "apply") return applyPajRefresh({ root, connectionConfig: createConnectionConfig(), output: console.log });
  if (command === "validate") return validatePajRefresh({ root, connectionConfig: createConnectionConfig(), output: console.log });
  console.log(JSON.stringify({ event: "paj_refresh_import_started", command }));
  const result = inspectPajRefresh(root, command);
  console.log(JSON.stringify({ event: "paj_refresh_import_completed", command, result: "success", ...result }));
  return result;
}

if (require.main === module) main().catch((error) => {
  if (!error.completionLogged) console.error(JSON.stringify({ event: "paj_refresh_import_completed", result: "failed", errorCode: error.code || "PAJ_REFRESH_FAILED" }));
  process.exitCode = 1;
});

module.exports = { main };
