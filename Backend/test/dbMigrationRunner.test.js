"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  MigrationError,
  checksum,
  createPlan,
  loadMigrations,
  validateJournal,
} = require("../db/migrationRunner");
const { createConnectionConfig } = require("../db/connectionConfig");
const { parseArguments } = require("../scripts/db-migrate");

test("Migrationen werden lueckenlos geladen und mit SHA-256 gebunden", () => {
  const migrations = loadMigrations();
  assert.equal(migrations[0].filename, "000001_bootstrap.sql");
  assert.equal(migrations[0].id, 1);
  assert.equal(migrations[0].checksum, checksum(migrations[0].sql));
  assert.match(migrations[0].checksum, /^[0-9a-f]{64}$/);
});

test("Luecken im Migrationsnummernkreis werden abgelehnt", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-migrations-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "000001_first.sql"), "SELECT 1;\n");
  fs.writeFileSync(path.join(directory, "000003_third.sql"), "SELECT 3;\n");
  assert.throws(() => loadMigrations(directory), (error) => error instanceof MigrationError && error.code === "MIGRATION_SEQUENCE_INVALID");
});

test("Journalabweichungen und unbekannte Migrationen werden abgelehnt", () => {
  const migrations = loadMigrations();
  assert.throws(() => validateJournal(migrations, [{
    migration_id: 1,
    name: migrations[0].name,
    checksum: "0".repeat(64),
    result: "success",
  }]), (error) => error.code === "MIGRATION_CHECKSUM_MISMATCH");
  assert.throws(() => validateJournal(migrations, [{
    migration_id: 999,
    name: "unknown",
    checksum: "0".repeat(64),
    result: "success",
  }]), (error) => error.code === "MIGRATION_UNKNOWN");
});

test("Plan nimmt fehlgeschlagene Migration erneut auf", () => {
  const migrations = loadMigrations();
  const plan = createPlan(migrations, [{
    migration_id: 1,
    name: migrations[0].name,
    checksum: migrations[0].checksum,
    result: "failed",
  }], 1);
  assert.deepEqual(plan.map(({ id }) => id), [1]);
});

test("Verbindungskonfiguration liest geschuetzte Passwortdatei", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-credential-"));
  const filename = path.join(directory, "password");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(filename, "secret-value\n", { mode: 0o600 });
  const config = createConnectionConfig({
    PGHOST: "/socket",
    PGPORT: "5434",
    PGDATABASE: "testdb",
    PGUSER: "tester",
    EPIBER_DB_PASSWORD_FILE: filename,
  });
  assert.deepEqual(config, {
    host: "/socket",
    port: 5434,
    database: "testdb",
    user: "tester",
    application_name: "epiber-db-tool",
    ssl: false,
    password: "secret-value",
  });
});

test("Verbindungskonfiguration lehnt eine allgemein lesbare Passwortdatei ab", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-credential-"));
  const filename = path.join(directory, "password");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(filename, "secret-value\n", { mode: 0o600 });
  fs.chmodSync(filename, 0o644);
  assert.throws(() => createConnectionConfig({
    PGUSER: "tester",
    EPIBER_DB_PASSWORD_FILE: filename,
  }), /DB_PASSWORD_FILE_INSECURE/);
});

test("Verbindungskonfiguration akzeptiert systemd-Credentials read-only fuer die private Gruppe", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-systemd-credential-"));
  const filename = path.join(directory, "password");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(filename, "secret-value\n", { mode: 0o440 });
  assert.equal(createConnectionConfig({ PGUSER: "tester", EPIBER_DB_PASSWORD_FILE: filename }).password, "secret-value");
  fs.chmodSync(filename, 0o460);
  assert.throws(() => createConnectionConfig({ PGUSER: "tester", EPIBER_DB_PASSWORD_FILE: filename }), /DB_PASSWORD_FILE_INSECURE/);
});

test("CLI verlangt explizite Zielgeneration fuer schreibenden Lauf", () => {
  assert.deepEqual(parseArguments(["plan", "--target-generation", "1"]), { command: "plan", targetGeneration: 1 });
  assert.throws(() => parseArguments(["up"]), (error) => error.code === "TARGET_GENERATION_REQUIRED");
  assert.throws(() => parseArguments(["verify", "--unknown"]), (error) => error.code === "ARGUMENT_INVALID");
});
