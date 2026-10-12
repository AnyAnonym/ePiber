#!/usr/bin/env node
"use strict";

const { createConnectionConfig } = require("../db/connectionConfig");
const { applyBootstrap, createBootstrapConfig, verifyBootstrap } = require("../db/bootstrap");

async function main() {
  const [command] = process.argv.slice(2);
  if (!['apply', 'verify'].includes(command) || process.argv.length !== 3) {
    throw Object.assign(new Error("Usage: node scripts/db-bootstrap.js apply|verify"), { code: "DB_BOOTSTRAP_ARGUMENT_INVALID" });
  }
  const bootstrap = createBootstrapConfig();
  const adminEnvironment = { ...process.env };
  if (!adminEnvironment.EPIBER_DB_PASSWORD_FILE) delete adminEnvironment.CREDENTIALS_DIRECTORY;
  const adminConnectionConfig = createConnectionConfig(adminEnvironment);
  if (command === "apply") await applyBootstrap({ adminConnectionConfig, ...bootstrap });
  else {
    await verifyBootstrap({ adminConnectionConfig, ...bootstrap });
    console.log(JSON.stringify({ event: "db_bootstrap_verified", database: bootstrap.database, result: "success" }));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "db_bootstrap_completed", result: "failed", errorCode: error.code || "DB_BOOTSTRAP_FAILED" }));
    process.exitCode = 1;
  });
}
