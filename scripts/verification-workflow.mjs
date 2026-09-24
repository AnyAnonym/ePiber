#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  changedPaths,
  verificationStatus,
  verifyRequired,
} from "./verification-state.mjs";

function fail(message) {
  throw new Error(message);
}

function rootDirectory() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (result.status !== 0) fail((result.stderr || "Kein Git-Repository").trim());
  return result.stdout.trim();
}

const [command, ...args] = process.argv.slice(2);
let suite = "auto";
let json = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--suite") {
    suite = args[index + 1];
    if (!suite || suite.startsWith("--")) fail("--suite benoetigt einen Wert");
    index += 1;
  } else if (args[index] === "--json") json = true;
  else fail(`Unbekanntes Argument: ${args[index]}`);
}

try {
  const root = rootDirectory();
  let status;
  if (command === "verify") status = verifyRequired(root, suite);
  else if (command === "status") status = verificationStatus(root, changedPaths(root));
  else fail("Aktion fehlt oder ist unbekannt. Erlaubt: verify, status");

  if (json) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  else {
    process.stdout.write(`Prueffingerprint: ${status.fingerprint}\n`);
    process.stdout.write(`Erforderlich: ${status.required.join(", ") || "keine"}\n`);
    process.stdout.write(`Nachgewiesen: ${status.completed.join(", ") || "keine"}\n`);
    process.stdout.write(`Status: ${status.missing.length ? `fehlt (${status.missing.join(", ")})` : "vollstaendig"}\n`);
  }
} catch (error) {
  process.stderr.write(`FEHLER: ${error.message}\n`);
  process.exitCode = 1;
}
