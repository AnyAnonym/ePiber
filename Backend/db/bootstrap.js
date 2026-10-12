"use strict";

const { Client } = require("pg");
const { readSecret } = require("./connectionConfig");

const LOGIN_ROLE_SUFFIXES = ["migrator", "app", "worker", "monitor", "backup", "refresh"];
const BOOTSTRAP_LOCK = 0x45504253;

function identifier(value, label) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(String(value))) {
    throw Object.assign(new Error(`${label} ist ungueltig`), { code: "DB_BOOTSTRAP_IDENTIFIER_INVALID" });
  }
  return `"${value}"`;
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function roleNames(prefix) {
  identifier(prefix, "Rollenpraefix");
  return Object.fromEntries(["owner", ...LOGIN_ROLE_SUFFIXES].map((suffix) => [suffix, `${prefix}_${suffix}`]));
}

function createBootstrapConfig(env = process.env) {
  const prefix = env.EPIBER_DB_ROLE_PREFIX || "epiber_devel";
  const database = env.EPIBER_DB_NAME || "epiber_devel";
  identifier(prefix, "Rollenpraefix");
  identifier(database, "Datenbankname");
  const credentialsDirectory = env.CREDENTIALS_DIRECTORY;
  const passwords = {};
  for (const suffix of LOGIN_ROLE_SUFFIXES) {
    const key = `EPIBER_DB_${suffix.toUpperCase()}_PASSWORD_FILE`;
    const filename = env[key] || (credentialsDirectory ? `${credentialsDirectory}/postgres-${suffix}-password` : null);
    if (!filename) throw Object.assign(new Error(`Credentialdatei fuer ${suffix} fehlt`), { code: "DB_BOOTSTRAP_CREDENTIAL_REQUIRED" });
    passwords[suffix] = readSecret(filename);
  }
  return { prefix, database, passwords };
}

async function ensureRole(client, name, { login, password }) {
  const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
  const quoted = identifier(name, "Rollenname");
  if (!existing.rowCount) {
    await client.query(`CREATE ROLE ${quoted} ${login ? "LOGIN" : "NOLOGIN"} NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS${login ? ` PASSWORD ${literal(password)}` : ""}`);
  } else {
    await client.query(`ALTER ROLE ${quoted} ${login ? "LOGIN" : "NOLOGIN"} NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS${login ? ` PASSWORD ${literal(password)}` : ""}`);
  }
}

async function applicationSchemasExist(client) {
  const result = await client.query("SELECT to_regnamespace('core') IS NOT NULL AS present");
  return result.rows[0].present;
}

async function grantSchemaPrivileges(client, names) {
  const owner = identifier(names.owner, "Ownerrolle");
  const app = identifier(names.app, "Approlle");
  const worker = identifier(names.worker, "Workerrolle");
  const monitor = identifier(names.monitor, "Monitoringrolle");
  const refresh = identifier(names.refresh, "Refreshrolle");

  await client.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
  await client.query(`GRANT USAGE ON SCHEMA core, identity, play, venue, messaging, ops TO ${app}, ${worker}, ${refresh}`);
  await client.query(`GRANT USAGE ON SCHEMA ops TO ${monitor}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, identity, play, venue, messaging TO ${app}, ${refresh}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core, identity, play, venue, messaging TO ${app}, ${refresh}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA core, identity, play, venue, messaging TO ${worker}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE ON ops.idempotency_operations, ops.jobs, ops.outbox, ops.audit_operations, ops.audit_transitions TO ${app}`);
  await client.query(`GRANT INSERT, UPDATE ON ops.audit_security_context TO ${app}`);
  await client.query(`GRANT SELECT ON ops.schema_migrations, ops.seed_runs, ops.import_runs TO ${app}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE ON ops.jobs, ops.outbox TO ${worker}`);
  await client.query(`GRANT SELECT ON ops.schema_migrations, ops.seed_runs, ops.import_runs TO ${worker}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE ON messaging.deliveries TO ${worker}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ops.import_runs, ops.import_findings, ops.seed_runs TO ${refresh}`);
  await client.query(`GRANT SELECT ON ops.schema_migrations, ops.seed_runs TO ${monitor}`);

  for (const schema of ["core", "identity", "play", "venue", "messaging"]) {
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}, ${refresh}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${worker}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT USAGE, SELECT ON SEQUENCES TO ${app}, ${refresh}`);
  }
}

async function applyBootstrap({ adminConnectionConfig, prefix, database, passwords, output = console.log }) {
  const names = roleNames(prefix);
  identifier(database, "Datenbankname");
  const admin = new Client(adminConnectionConfig);
  await admin.connect();
  output(JSON.stringify({ event: "db_bootstrap_started", database, prefix }));
  try {
    await admin.query("SELECT pg_advisory_lock($1)", [BOOTSTRAP_LOCK]);
    try {
      await ensureRole(admin, names.owner, { login: false });
      for (const suffix of LOGIN_ROLE_SUFFIXES) await ensureRole(admin, names[suffix], { login: true, password: passwords[suffix] });
      await admin.query(`GRANT ${identifier(names.owner, "Ownerrolle")} TO ${identifier(names.migrator, "Migratorrolle")}`);
      await admin.query(`GRANT pg_monitor TO ${identifier(names.monitor, "Monitoringrolle")}`);
      const existingDatabase = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
      if (!existingDatabase.rowCount) {
        await admin.query(`CREATE DATABASE ${identifier(database, "Datenbankname")} OWNER ${identifier(names.owner, "Ownerrolle")} TEMPLATE template0 ENCODING 'UTF8'`);
      }
    } finally {
      await admin.query("SELECT pg_advisory_unlock($1)", [BOOTSTRAP_LOCK]);
    }
  } finally {
    await admin.end();
  }

  const target = new Client({ ...adminConnectionConfig, database });
  await target.connect();
  let grantsApplied = false;
  try {
    await target.query("REVOKE CONNECT ON DATABASE " + identifier(database, "Datenbankname") + " FROM PUBLIC");
    await target.query(`GRANT CONNECT ON DATABASE ${identifier(database, "Datenbankname")} TO ${LOGIN_ROLE_SUFFIXES.map((suffix) => identifier(names[suffix], "Rollenname")).join(", ")}`);
    if (await applicationSchemasExist(target)) {
      await grantSchemaPrivileges(target, names);
      grantsApplied = true;
    }
  } finally {
    await target.end();
  }
  output(JSON.stringify({ event: "db_bootstrap_completed", database, result: "success", grantsApplied }));
  return { names, grantsApplied };
}

async function verifyBootstrap({ adminConnectionConfig, prefix, database }) {
  const names = roleNames(prefix);
  const client = new Client({ ...adminConnectionConfig, database });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        has_database_privilege($1, current_database(), 'CONNECT') AS app_connect,
        has_schema_privilege($1, 'identity', 'USAGE') AS app_identity_usage,
        has_table_privilege($1, 'identity.people', 'SELECT,INSERT,UPDATE,DELETE') AS app_people_write,
        has_table_privilege($1, 'ops.schema_migrations', 'SELECT')
          AND has_table_privilege($1, 'ops.seed_runs', 'SELECT')
          AND has_table_privilege($1, 'ops.import_runs', 'SELECT') AS app_runtime_metadata_read,
        NOT has_table_privilege($1, 'ops.schema_migrations', 'UPDATE') AS app_no_migration_write,
        NOT has_table_privilege($1, 'ops.audit_security_context', 'SELECT') AS app_no_security_context_read,
        has_table_privilege($2, 'ops.jobs', 'SELECT,INSERT,UPDATE') AS worker_jobs,
        has_table_privilege($2, 'ops.schema_migrations', 'SELECT')
          AND has_table_privilege($2, 'ops.seed_runs', 'SELECT')
          AND has_table_privilege($2, 'ops.import_runs', 'SELECT') AS worker_runtime_metadata_read,
        NOT has_table_privilege($2, 'identity.people', 'UPDATE') AS worker_no_people_write,
        has_table_privilege($3, 'ops.schema_migrations', 'SELECT') AS monitor_migrations,
        NOT has_table_privilege($3, 'identity.people', 'SELECT') AS monitor_no_people,
        pg_has_role($4, $5, 'SET') AS migrator_can_set_owner
    `, [names.app, names.worker, names.monitor, names.migrator, names.owner]);
    const checks = result.rows[0];
    if (Object.values(checks).some((value) => value !== true)) {
      throw Object.assign(new Error("Rollen- oder Grantverifikation fehlgeschlagen"), { code: "DB_BOOTSTRAP_VERIFY_FAILED", checks });
    }
    return checks;
  } finally {
    await client.end();
  }
}

module.exports = { applyBootstrap, createBootstrapConfig, roleNames, verifyBootstrap };
