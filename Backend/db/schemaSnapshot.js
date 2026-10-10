"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCHEMAS = ["core", "identity", "play", "venue", "messaging", "ops", "finance"];
const SNAPSHOT_FILE = path.join(__dirname, "schema.sql");

function escapePgPass(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

function canonicalizeSnapshot(value) {
  return value
    .replace(/^-- Dumped from database version .*\n-- Dumped by pg_dump version .*\n/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

function generateSchemaSnapshot(connectionConfig) {
  const credentialDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-pgpass-"));
  const passfile = path.join(credentialDirectory, "pgpass");
  try {
    if (connectionConfig.password) {
      fs.writeFileSync(passfile, `*:*:*:*:${escapePgPass(connectionConfig.password)}\n`, { mode: 0o600 });
    }
    const args = [
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "--restrict-key=6570696265725f736368656d615f736e617073686f745f76310000000000000000",
      "--host", connectionConfig.host,
      "--port", String(connectionConfig.port),
      "--username", connectionConfig.user,
      "--dbname", connectionConfig.database,
      ...SCHEMAS.flatMap((schema) => ["--schema", schema]),
    ];
    const output = execFileSync("pg_dump", args, {
      encoding: "utf8",
      env: {
        ...process.env,
        PGAPPNAME: "epiber-schema-snapshot",
        ...(connectionConfig.password ? { PGPASSFILE: passfile } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return canonicalizeSnapshot(output);
  } finally {
    fs.rmSync(credentialDirectory, { recursive: true, force: true });
  }
}

function writeSchemaSnapshot(connectionConfig, filename = SNAPSHOT_FILE) {
  const snapshot = generateSchemaSnapshot(connectionConfig);
  fs.writeFileSync(filename, snapshot, { mode: 0o644 });
  return snapshot;
}

function verifySchemaSnapshot(connectionConfig, filename = SNAPSHOT_FILE) {
  const expected = fs.readFileSync(filename, "utf8");
  const actual = generateSchemaSnapshot(connectionConfig);
  if (actual !== expected) {
    throw Object.assign(new Error("Kanonischer Schema-Snapshot weicht ab"), { code: "SCHEMA_SNAPSHOT_DRIFT" });
  }
  return actual;
}

module.exports = {
  SNAPSHOT_FILE,
  canonicalizeSnapshot,
  generateSchemaSnapshot,
  verifySchemaSnapshot,
  writeSchemaSnapshot,
};
