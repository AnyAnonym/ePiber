#!/usr/bin/env node
"use strict";

const { createConnectionConfig } = require("../db/connectionConfig");
const { applyPersonalAccess, createPersonalAccessConfig, verifyPersonalAccess } = require("../db/personalAccess");

async function main() {
  const [command] = process.argv.slice(2);
  if (!new Set(["apply", "verify"]).has(command) || process.argv.length !== 3) {
    throw Object.assign(new Error("Usage: db-personal-access.js apply|verify"), { code: "DB_PERSONAL_ACCESS_ARGUMENT_INVALID" });
  }
  const config = createPersonalAccessConfig();
  const adminConnectionConfig = createConnectionConfig({ ...process.env, PGDATABASE: config.database, PGAPPNAME: "epiber-personal-access" });
  if (command === "apply") await applyPersonalAccess({ adminConnectionConfig, ...config, output: console.log });
  else {
    const result = await verifyPersonalAccess({ adminConnectionConfig, ...config });
    console.log(JSON.stringify({ event: "db_personal_access_verified", database: config.database, readerRole: config.readerRole, adminRole: config.adminRole, result: "success", tableCount: result.tableCount, sequenceCount: result.sequenceCount }));
  }
}

if (require.main === module) main().catch((error) => {
  if (!error.completionLogged) console.error(JSON.stringify({ event: "db_personal_access_completed", result: "failed", errorCode: error.code || "DB_PERSONAL_ACCESS_FAILED" }));
  process.exitCode = 1;
});
