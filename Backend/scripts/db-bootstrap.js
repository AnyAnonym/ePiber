#!/usr/bin/env node
"use strict";

const { createConnectionConfig } = require("../db/connectionConfig");
const { applyBootstrap, applyExistingDatabaseGrants, createBootstrapConfig, verifyBootstrap } = require("../db/bootstrap");

async function main() {
  const [command] = process.argv.slice(2);
  if (!['apply', 'grants', 'verify'].includes(command) || process.argv.length !== 3) {
    throw Object.assign(new Error("Usage: node scripts/db-bootstrap.js apply|grants|verify"), { code: "DB_BOOTSTRAP_ARGUMENT_INVALID" });
  }
  const adminEnvironment = { ...process.env };
  if (!adminEnvironment.EPIBER_DB_PASSWORD_FILE) delete adminEnvironment.CREDENTIALS_DIRECTORY;
  const adminConnectionConfig = createConnectionConfig(adminEnvironment);
  if (command === "grants") {
    const prefix = process.env.EPIBER_DB_ROLE_PREFIX || "epiber_devel", database = process.env.EPIBER_DB_NAME || "epiber_devel";
    await applyExistingDatabaseGrants({ adminConnectionConfig, prefix, database, readOnly: process.env.EPIBER_DB_ENABLE_READONLY === "true" });
    return;
  }
  const bootstrap = createBootstrapConfig();
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
