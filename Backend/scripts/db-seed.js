#!/usr/bin/env node
"use strict";

const { createConnectionConfig } = require("../db/connectionConfig");
const { applyTechnicalSeed } = require("../db/seedRunner");

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--as-of") {
    throw Object.assign(new Error("Usage: node scripts/db-seed.js --as-of <ISO-Zeitpunkt>"), { code: "SEED_ARGUMENT_INVALID" });
  }
  return { asOf: argv[1] };
}

async function main() {
  await applyTechnicalSeed({ connectionConfig: createConnectionConfig(), ...parseArguments(process.argv.slice(2)) });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "db_seed_cli_failed", result: "failed", errorCode: error.code || "DB_SEED_FAILED" }));
    process.exitCode = 1;
  });
}

module.exports = { parseArguments };
