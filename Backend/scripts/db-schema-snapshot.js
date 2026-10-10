#!/usr/bin/env node
"use strict";

const { createConnectionConfig } = require("../db/connectionConfig");
const { verifySchemaSnapshot, writeSchemaSnapshot } = require("../db/schemaSnapshot");

async function main() {
  const [command] = process.argv.slice(2);
  if (!['write', 'verify'].includes(command) || process.argv.length !== 3) {
    throw Object.assign(new Error("Usage: node scripts/db-schema-snapshot.js write|verify"), { code: "SCHEMA_SNAPSHOT_ARGUMENT_INVALID" });
  }
  const connectionConfig = createConnectionConfig();
  const startedAt = Date.now();
  console.log(JSON.stringify({ event: "db_schema_snapshot_started", command }));
  if (command === "write") writeSchemaSnapshot(connectionConfig);
  else verifySchemaSnapshot(connectionConfig);
  console.log(JSON.stringify({ event: "db_schema_snapshot_completed", command, result: "success", durationMs: Date.now() - startedAt }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "db_schema_snapshot_completed", result: "failed", errorCode: error.code || "SCHEMA_SNAPSHOT_FAILED" }));
    process.exitCode = 1;
  });
}
