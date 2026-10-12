#!/usr/bin/env node
"use strict";

const { createConnectionConfig } = require("../db/connectionConfig");
const { runOpsSmoke } = require("../db/opsSmoke");

function cleanupConfig(env = process.env) {
  if (!env.EPIBER_DB_SMOKE_CLEANUP_USER || !env.EPIBER_DB_SMOKE_CLEANUP_PASSWORD_FILE || !env.EPIBER_DB_SMOKE_CLEANUP_ROLE) {
    throw Object.assign(new Error("Cleanup-Credential fehlt"), { code: "OPS_SMOKE_CLEANUP_CREDENTIAL_REQUIRED" });
  }
  return createConnectionConfig({
    ...env,
    PGUSER: env.EPIBER_DB_SMOKE_CLEANUP_USER,
    EPIBER_DB_PASSWORD_FILE: env.EPIBER_DB_SMOKE_CLEANUP_PASSWORD_FILE,
    EPIBER_DB_ROLE: env.EPIBER_DB_SMOKE_CLEANUP_ROLE,
    PGAPPNAME: "epiber-ops-smoke-cleanup",
  });
}

async function main() {
  if (process.argv.length !== 2) throw Object.assign(new Error("Usage: db-ops-smoke.js"), { code: "ARGUMENT_INVALID" });
  await runOpsSmoke({
    appConnectionConfig: createConnectionConfig({ ...process.env, PGAPPNAME: "epiber-ops-smoke" }),
    cleanupConnectionConfig: cleanupConfig(),
    tenantCode: String(process.env.EPIBER_TENANT_CODE || ""),
    output: console.log,
  });
}

if (require.main === module) main().catch((error) => {
  if (!error.completionLogged) console.error(JSON.stringify({ event: "db_ops_smoke_completed", result: "failed", errorCode: error.code || "OPS_SMOKE_FAILED" }));
  process.exitCode = 1;
});

module.exports = { cleanupConfig };
