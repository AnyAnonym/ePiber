#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { analyzeRealSource } = require("../db/import/realAnalysis");

function main() {
  const [directory] = process.argv.slice(2);
  if (!directory || process.argv.length !== 3) throw Object.assign(new Error("Usage: db-analyze-source.js <source-package>"), { code: "ANALYSIS_ARGUMENT_INVALID" });
  console.log(JSON.stringify({ event: "real_source_analysis_started" }));
  const result = analyzeRealSource(path.resolve(directory));
  console.log(JSON.stringify({ event: "real_source_analysis_completed", result: result.status === "blocked" ? "blocked" : "success", ...result }));
  if (result.status === "blocked") process.exitCode = 2;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ event: "real_source_analysis_completed", result: "failed", errorCode: error.code || "REAL_SOURCE_ANALYSIS_FAILED" }));
    process.exitCode = 1;
  }
}

module.exports = { main };
