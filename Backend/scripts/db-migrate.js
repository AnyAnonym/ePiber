#!/usr/bin/env node
"use strict";

const { createConnectionConfig } = require("../db/connectionConfig");
const { MigrationError, runMigrations } = require("../db/migrationRunner");

function usage() {
  console.error("Usage: node scripts/db-migrate.js status|plan|verify|up [--target-generation <n>]");
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!["status", "plan", "verify", "up"].includes(command)) throw new MigrationError("COMMAND_INVALID", "Befehl fehlt oder ist ungueltig");
  let targetGeneration;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== "--target-generation" || index + 1 >= rest.length) {
      throw new MigrationError("ARGUMENT_INVALID", `Ungueltiges Argument ${rest[index]}`);
    }
    targetGeneration = Number.parseInt(rest[index + 1], 10);
    index += 1;
  }
  if (command === "up" && targetGeneration === undefined) {
    throw new MigrationError("TARGET_GENERATION_REQUIRED", "up verlangt --target-generation");
  }
  return { command, targetGeneration };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await runMigrations({ connectionConfig: createConnectionConfig(), ...options });
}

if (require.main === module) {
  main().catch((error) => {
    usage();
    console.error(JSON.stringify({
      event: "db_migration_cli_failed",
      result: "failed",
      errorCode: error.code || "DB_MIGRATION_FAILED",
    }));
    process.exitCode = 1;
  });
}

module.exports = { parseArguments };
