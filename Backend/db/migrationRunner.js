"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Client } = require("pg");

const MIGRATION_PATTERN = /^(\d{6})_([a-z0-9][a-z0-9_-]*)\.sql$/;
const DEFAULT_MIGRATIONS_DIRECTORY = path.join(__dirname, "migrations");
const LOCK_KEY = 0x45504942;

class MigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    this.details = details;
  }
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function loadMigrations(directory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const migrations = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = MIGRATION_PATTERN.exec(entry.name);
      if (!match) return null;
      const sql = fs.readFileSync(path.join(directory, entry.name), "utf8");
      return {
        id: Number.parseInt(match[1], 10),
        sequence: match[1],
        name: match[2],
        filename: entry.name,
        sql,
        checksum: checksum(sql),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.id - right.id);

  if (!migrations.length) throw new MigrationError("MIGRATIONS_EMPTY", "Keine SQL-Migrationen gefunden");
  migrations.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.id !== expected) {
      throw new MigrationError("MIGRATION_SEQUENCE_INVALID", `Erwartete Migration ${String(expected).padStart(6, "0")}`, {
        filename: migration.filename,
      });
    }
  });
  return migrations;
}

function getBuildIdentity(backendRoot = path.resolve(__dirname, "..")) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(backendRoot, "package.json"), "utf8"));
  let gitCommit = "unknown";
  try {
    gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: backendRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Packaged artifacts may intentionally not contain .git.
  }
  return { appVersion: packageJson.version, gitCommit };
}

function emit(event, fields = {}, output = console.log) {
  output(JSON.stringify({ event, ...fields }));
}

async function journalExists(client) {
  const result = await client.query("SELECT to_regclass('ops.schema_migrations') AS relation");
  return Boolean(result.rows[0]?.relation);
}

async function assertEmptyApplicationSchemas(client) {
  const result = await client.query(`
    SELECT nspname
      FROM pg_namespace
     WHERE nspname IN ('core', 'identity', 'play', 'venue', 'messaging', 'ops', 'finance')
     ORDER BY nspname
  `);
  if (result.rowCount) {
    throw new MigrationError("DATABASE_NOT_EMPTY", "Anwendungsschemas ohne Migrationsjournal gefunden", {
      schemas: result.rows.map(({ nspname }) => nspname),
    });
  }
}

async function readJournal(client) {
  if (!await journalExists(client)) return [];
  const result = await client.query(`
    SELECT migration_id, name, checksum, result
      FROM ops.schema_migrations
     ORDER BY migration_id
  `);
  return result.rows;
}

function validateJournal(migrations, rows) {
  const known = new Map(migrations.map((migration) => [migration.id, migration]));
  for (const row of rows) {
    const migration = known.get(Number(row.migration_id));
    if (!migration) {
      throw new MigrationError("MIGRATION_UNKNOWN", `Unbekannte angewendete Migration ${row.migration_id}`);
    }
    if (row.name !== migration.name || row.checksum !== migration.checksum) {
      throw new MigrationError("MIGRATION_CHECKSUM_MISMATCH", `Migration ${migration.sequence} wurde veraendert`, {
        filename: migration.filename,
      });
    }
    if (row.result !== "success" && row.result !== "failed") {
      throw new MigrationError("MIGRATION_STATE_INVALID", `Migration ${migration.sequence} besitzt Status ${row.result}`);
    }
  }
}

function createPlan(migrations, rows, targetGeneration) {
  validateJournal(migrations, rows);
  const target = targetGeneration ?? migrations.at(-1).id;
  if (!Number.isInteger(target) || target < 0 || target > migrations.at(-1).id) {
    throw new MigrationError("TARGET_GENERATION_INVALID", `Ungueltige Zielgeneration ${target}`);
  }
  const applied = new Map(rows.map((row) => [Number(row.migration_id), row]));
  return migrations.filter((migration) => migration.id <= target && applied.get(migration.id)?.result !== "success");
}

async function applyBootstrap(client, migration, build) {
  const startedAt = Date.now();
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query(`
      INSERT INTO ops.schema_migrations
        (migration_id, name, checksum, git_commit, app_version, started_at, completed_at, duration_ms, result)
      VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), clock_timestamp(), $7, 'success')
    `, [migration.id, migration.name, migration.checksum, build.gitCommit, build.appVersion, startedAt, Date.now() - startedAt]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return Date.now() - startedAt;
}

async function applyMigration(client, migration, build) {
  const startedAt = Date.now();
  await client.query(`
    INSERT INTO ops.schema_migrations
      (migration_id, name, checksum, git_commit, app_version, started_at, result)
    VALUES ($1, $2, $3, $4, $5, clock_timestamp(), 'running')
    ON CONFLICT (migration_id) DO UPDATE
      SET name = EXCLUDED.name,
          checksum = EXCLUDED.checksum,
          git_commit = EXCLUDED.git_commit,
          app_version = EXCLUDED.app_version,
          started_at = EXCLUDED.started_at,
          completed_at = NULL,
          duration_ms = NULL,
          result = 'running'
      WHERE ops.schema_migrations.result = 'failed'
  `, [migration.id, migration.name, migration.checksum, build.gitCommit, build.appVersion]);

  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query(`
      UPDATE ops.schema_migrations
         SET completed_at = clock_timestamp(), duration_ms = $2, result = 'success'
       WHERE migration_id = $1
    `, [migration.id, Date.now() - startedAt]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await client.query(`
      UPDATE ops.schema_migrations
         SET completed_at = clock_timestamp(), duration_ms = $2, result = 'failed'
       WHERE migration_id = $1
    `, [migration.id, Date.now() - startedAt]);
    throw error;
  }
  return Date.now() - startedAt;
}

async function runMigrations({ connectionConfig, command, targetGeneration, migrationsDirectory, output = console.log }) {
  const migrations = loadMigrations(migrationsDirectory);
  const build = getBuildIdentity();
  const client = new Client(connectionConfig);
  await client.connect();
  emit("db_migration_started", { command, targetGeneration: targetGeneration ?? null }, output);
  try {
    if (command === "status" || command === "plan" || command === "verify") {
      const rows = await readJournal(client);
      if (rows.length) validateJournal(migrations, rows);
      const pending = createPlan(migrations, rows, targetGeneration);
      if (command === "verify" && pending.length) {
        throw new MigrationError("MIGRATIONS_PENDING", `${pending.length} Migrationen fehlen`);
      }
      const result = {
        generation: rows.filter((row) => row.result === "success").at(-1)?.migration_id || 0,
        pending: pending.map(({ id, filename, checksum: value }) => ({ id, filename, checksum: value })),
      };
      emit("db_migration_completed", { command, result: "success", ...result }, output);
      return result;
    }
    if (command !== "up") throw new MigrationError("COMMAND_INVALID", `Unbekannter Befehl ${command}`);

    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      let rows = await readJournal(client);
      if (!rows.length && !await journalExists(client)) await assertEmptyApplicationSchemas(client);
      const plan = createPlan(migrations, rows, targetGeneration);
      for (const migration of plan) {
        emit("db_migration_step_started", { migrationId: migration.id, name: migration.name }, output);
        const durationMs = migration.id === 1 && !await journalExists(client)
          ? await applyBootstrap(client, migration, build)
          : await applyMigration(client, migration, build);
        emit("db_migration_step_completed", {
          migrationId: migration.id,
          name: migration.name,
          durationMs,
          result: "success",
        }, output);
      }
      rows = await readJournal(client);
      validateJournal(migrations, rows);
      emit("db_migration_completed", {
        command,
        result: "success",
        generation: rows.filter((row) => row.result === "success").at(-1)?.migration_id || 0,
      }, output);
      return rows;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } catch (error) {
    emit("db_migration_completed", {
      command,
      result: "failed",
      errorCode: error.code || "DB_MIGRATION_FAILED",
    }, output);
    throw error;
  } finally {
    await client.end();
  }
}

module.exports = {
  MigrationError,
  checksum,
  createPlan,
  getBuildIdentity,
  loadMigrations,
  runMigrations,
  validateJournal,
};
