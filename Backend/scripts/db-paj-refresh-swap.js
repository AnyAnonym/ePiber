#!/usr/bin/env node
"use strict";

const { createConnectionConfig } = require("../db/connectionConfig");
const { activatePajRefreshDatabase, rollbackPajRefreshDatabase } = require("../db/import/pajRefreshSwap");

async function main() {
  const [command, candidate, previous, ...rest] = process.argv.slice(2);
  if (!new Set(["activate", "rollback"]).has(command) || !candidate || !previous || rest.length) {
    throw Object.assign(new Error("Usage: db-paj-refresh-swap.js activate|rollback CANDIDATE PREVIOUS"), { code: "PAJ_REFRESH_SWAP_ARGUMENT_INVALID" });
  }
  const options = { adminConnectionConfig: createConnectionConfig({ ...process.env, PGDATABASE: "postgres", PGAPPNAME: "epiber-paj-refresh-swap" }), candidate, previous, output: console.log };
  if (command === "activate") return activatePajRefreshDatabase(options);
  return rollbackPajRefreshDatabase(options);
}

if (require.main === module) main().catch((error) => {
  if (!error.completionLogged) console.error(JSON.stringify({ event: "paj_refresh_database_swap_completed", result: "failed", errorCode: error.code || "PAJ_REFRESH_DATABASE_SWAP_FAILED" }));
  process.exitCode = 1;
});

module.exports = { main };
