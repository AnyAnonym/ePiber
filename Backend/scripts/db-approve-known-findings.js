#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { writeKnownFindingApproval } = require("../db/import/knownFindingApproval");

function main() {
  const [directory] = process.argv.slice(2);
  if (!directory || process.argv.length !== 3) throw Object.assign(new Error("Usage: db-approve-known-findings.js <source-package>"), { code: "APPROVAL_ARGUMENT_INVALID" });
  const result = writeKnownFindingApproval(path.resolve(directory));
  console.log(JSON.stringify({ event: "known_import_findings_approved", result: "success", ...result }));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ event: "known_import_findings_approved", result: "failed", errorCode: error.code || "IMPORT_APPROVAL_FAILED", ...(error.warningCodes ? { warningCodes: error.warningCodes } : {}) }));
    process.exitCode = 1;
  }
}

module.exports = { main };
