#!/usr/bin/env node
"use strict";

const { createConnectionConfig } = require("../db/connectionConfig");
const { applyFullDevelSeed, applyTechnicalSeed } = require("../db/seedRunner");

function parseArguments(argv) {
  if (argv.length !== 3 || !["technical-minimal", "full-devel"].includes(argv[0]) || argv[1] !== "--as-of") {
    throw Object.assign(new Error("Usage: node scripts/db-seed.js technical-minimal|full-devel --as-of <ISO-Zeitpunkt>"), { code: "SEED_ARGUMENT_INVALID" });
  }
  return { seed: argv[0], asOf: argv[2] };
}

async function main() {
  const { seed, asOf } = parseArguments(process.argv.slice(2));
  const apply = seed === "technical-minimal" ? applyTechnicalSeed : applyFullDevelSeed;
  await apply({ connectionConfig: createConnectionConfig(), asOf });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "db_seed_cli_failed", result: "failed", errorCode: error.code || "DB_SEED_FAILED" }));
    process.exitCode = 1;
  });
}

module.exports = { parseArguments };
