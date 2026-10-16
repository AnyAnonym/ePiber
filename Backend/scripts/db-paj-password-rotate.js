#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { createConnectionConfig } = require("../db/connectionConfig");
const { createRuntimeRepositories } = require("../db/createRuntimeRepositories");
const { rotateAllPajPasswords } = require("../db/pajPasswordRotation");
const { AUDIT_CONTRACTS } = require("../postgresRuntimeContracts");

async function main() {
  if (process.argv.length !== 2) throw Object.assign(new Error("Usage: db-paj-password-rotate.js"), { code: "PAJ_PASSWORD_ROTATION_ARGUMENT_INVALID" });
  const connectionConfig = createConnectionConfig(process.env);
  if (connectionConfig.database !== "epiber_devel") throw Object.assign(new Error("Nur epiber_devel ist zulaessig"), { code: "PAJ_PASSWORD_ROTATION_DATABASE_INVALID" });
  const input = fs.readFileSync(0, "utf8");
  if (input.length > 66 || !/^[0-9a-f]{64}\n?$/.test(input)) throw Object.assign(new Error("Credentialeingabe ist ungueltig"), { code: "PAJ_PASSWORD_HASH_INVALID" });
  const log = (level, event, fields) => console.log(JSON.stringify({ event, level, ...fields }));
  const runtime = createRuntimeRepositories({
    connectionConfig,
    expectedTenantCode: "devel-epiber",
    sourceInstance: "devel-password-rotation",
    auditContracts: AUDIT_CONTRACTS,
    log,
  });
  console.log(JSON.stringify({ event: "paj_password_rotation_started" }));
  try {
    const repositories = await runtime.connect();
    const result = await rotateAllPajPasswords({ repositories, clientHash: input.trim() });
    console.log(JSON.stringify({ event: "paj_password_rotation_completed", result: "success", ...result }));
  } finally { await runtime.close(); }
}

if (require.main === module) {
  main().catch((error) => {
    const rejected = new Set([
      "PAJ_PASSWORD_ROTATION_ARGUMENT_INVALID", "PAJ_PASSWORD_ROTATION_DATABASE_INVALID",
      "PAJ_PASSWORD_HASH_INVALID", "PAJ_PASSWORD_ROTATION_NO_ACCOUNTS",
      "PAJ_PASSWORD_ROTATION_CREDENTIAL_STATE_INVALID",
    ]);
    const result = error.code === "DB_COMMIT_OUTCOME_UNKNOWN" ? "unknown" : rejected.has(error.code) ? "rejected" : "failed";
    console.error(JSON.stringify({ event: "paj_password_rotation_completed", result, errorCode: error.code || "PAJ_PASSWORD_ROTATION_FAILED" }));
    process.exitCode = 1;
  });
}
