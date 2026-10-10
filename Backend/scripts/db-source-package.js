#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { verifySourcePackage, writeSourceManifest } = require("../db/import/sourcePackage");

function parseArguments(argv) {
  const [command, directory, ...rest] = argv;
  if (!['write-manifest', 'verify'].includes(command) || !directory) throw Object.assign(new Error("Usage: db-source-package.js verify <dir> | write-manifest <dir> <run-id> <start-iso> <end-iso>"), { code: "SOURCE_PACKAGE_ARGUMENT_INVALID" });
  if (command === "verify" && rest.length) throw Object.assign(new Error("Zu viele Argumente"), { code: "SOURCE_PACKAGE_ARGUMENT_INVALID" });
  if (command === "write-manifest" && rest.length !== 3) throw Object.assign(new Error("Manifestargumente fehlen"), { code: "SOURCE_PACKAGE_ARGUMENT_INVALID" });
  return { command, directory: path.resolve(directory), rest };
}

function main() {
  const { command, directory, rest } = parseArguments(process.argv.slice(2));
  console.log(JSON.stringify({ event: "source_package_started", command }));
  const result = command === "verify"
    ? verifySourcePackage(directory)
    : { manifest: writeSourceManifest(directory, { exportRunId: rest[0], exportStartedAt: rest[1], exportCompletedAt: rest[2] }) };
  console.log(JSON.stringify({
    event: "source_package_completed",
    command,
    result: "success",
    exportRunId: result.manifest.exportRunId,
    fileCount: result.manifest.files.length,
    ...(result.manifestSha256 ? { manifestSha256: result.manifestSha256 } : {}),
  }));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ event: "source_package_completed", result: "failed", errorCode: error.code || "SOURCE_PACKAGE_FAILED" }));
    process.exitCode = 1;
  }
}

module.exports = { parseArguments };
