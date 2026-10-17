#!/usr/bin/env node
"use strict";

const { createConnectionConfig } = require("../db/connectionConfig");
const { createRuntimeRepositories } = require("../db/createRuntimeRepositories");
const { repairNavigation } = require("../db/repairNavigation");

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const parameters = args.filter((value) => value !== "--apply");
  if (parameters.length !== 4 || parameters[0] !== "--profile" || parameters[2] !== "--order"
    || args.filter((value) => value === "--apply").length > 1) throw Object.assign(new Error("ARGUMENT_INVALID"), { code: "ARGUMENT_INVALID" });
  if (process.env.PGDATABASE !== "epiber_devel") throw Object.assign(new Error("DEVEL_DATABASE_REQUIRED"), { code: "DEVEL_DATABASE_REQUIRED" });
  const log = (level, event, fields) => console.log(JSON.stringify({ level, event, ...fields }));
  const runtime = createRuntimeRepositories({ connectionConfig: createConnectionConfig(), expectedTenantCode: "devel-epiber", log });
  try {
    const { venue } = await runtime.connect();
    await repairNavigation({ venue, profile: parameters[1], order: parameters[3].split(","), apply, log });
  } finally {
    await runtime.close();
  }
}

if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({ event: "navigation_repair_cli_failed", result: "failed", errorCode: error.code || "NAVIGATION_REPAIR_FAILED" }));
  process.exitCode = 1;
});
