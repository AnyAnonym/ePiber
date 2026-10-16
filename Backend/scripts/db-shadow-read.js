#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { createConnectionConfig } = require("../db/connectionConfig");
const { runShadowRead } = require("../db/import/shadowRead");

async function main() {
  const [root] = process.argv.slice(2);
  if (!root || process.argv.length !== 3) throw Object.assign(new Error("Usage: db-shadow-read.js <source-package>"), { code: "ARGUMENT_INVALID" });
  await runShadowRead({ root: path.resolve(root), connectionConfig: createConnectionConfig(), output: console.log });
}

if (require.main === module) main().catch((error) => {
  if (!error.completionLogged) console.error(JSON.stringify({ event: "db_shadow_read_completed", result: "failed", errorCode: error.code || "SHADOW_READ_FAILED" }));
  process.exitCode = 1;
});
