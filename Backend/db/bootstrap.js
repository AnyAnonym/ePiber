"use strict";

const { Client } = require("pg");
const { readSecret } = require("./connectionConfig");

const LOGIN_ROLE_SUFFIXES = ["migrator", "app", "worker", "monitor", "backup", "refresh"];
const OPTIONAL_LOGIN_ROLE_SUFFIXES = ["app_readonly"];
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
  return Object.fromEntries(["owner", ...LOGIN_ROLE_SUFFIXES, ...OPTIONAL_LOGIN_ROLE_SUFFIXES].map((suffix) => [suffix, `${prefix}_${suffix}`]));
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
  const readOnlyFile = env.EPIBER_DB_APP_READONLY_PASSWORD_FILE
    || (env.EPIBER_DB_ENABLE_READONLY === "true" && credentialsDirectory ? `${credentialsDirectory}/postgres-app-readonly-password` : null);
  if (readOnlyFile) passwords.app_readonly = readSecret(readOnlyFile);
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

async function grantSchemaPrivileges(client, names, { readOnly = false } = {}) {
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
  await client.query(`GRANT UPDATE ON ALL SEQUENCES IN SCHEMA core, identity, play, venue, messaging TO ${refresh}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA core, identity, play, venue, messaging TO ${worker}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE ON ops.idempotency_operations, ops.jobs, ops.outbox, ops.audit_operations, ops.audit_transitions TO ${app}`);
  await client.query(`GRANT INSERT, UPDATE ON ops.audit_security_context TO ${app}`);
  await client.query(`GRANT SELECT ON ops.schema_migrations, ops.seed_runs, ops.import_runs TO ${app}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ops.jobs, ops.outbox TO ${worker}`);
  await client.query(`GRANT SELECT, UPDATE, DELETE ON ops.idempotency_operations TO ${worker}`);
  await client.query(`GRANT SELECT, UPDATE, DELETE ON ops.audit_operations TO ${worker}`);
  await client.query(`GRANT SELECT, UPDATE, DELETE ON identity.login_rate_limits, identity.sessions, identity.tenant_role_assignments, identity.credentials TO ${worker}`);
  await client.query(`GRANT SELECT, UPDATE, DELETE ON messaging.event_recipients TO ${worker}`);
  await client.query(`GRANT SELECT, UPDATE, DELETE ON venue.monitor_commands, venue.hall_time_allocations TO ${worker}`);
  await client.query(`GRANT INSERT ON venue.hall_time_history, venue.hall_time_history_items TO ${worker}`);
  await client.query(`GRANT UPDATE ON venue.hall_time_grids TO ${worker}`);
  await client.query(`GRANT SELECT ON ops.schema_migrations, ops.seed_runs, ops.import_runs TO ${worker}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE ON messaging.deliveries TO ${worker}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ops.import_runs, ops.import_findings, ops.seed_runs TO ${refresh}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ops.idempotency_operations, ops.audit_operations, ops.audit_security_context, ops.audit_transitions TO ${refresh}`);
  await client.query(`GRANT SELECT ON ops.jobs, ops.outbox TO ${refresh}`);
  await client.query(`GRANT SELECT ON ops.schema_migrations, ops.seed_runs TO ${monitor}`);

  if (readOnly) {
    const appReadonly = identifier(names.app_readonly, "Read-only-Approlle");
    await client.query(`GRANT USAGE ON SCHEMA core, identity, play, venue, messaging, ops TO ${appReadonly}`);
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA core, play, venue, messaging TO ${appReadonly}`);
    await client.query(`GRANT SELECT ON identity.people, identity.person_contacts, identity.person_addresses,
      identity.person_external_identifiers, identity.memberships, identity.user_accounts, identity.sessions,
      identity.tenant_role_assignments, identity.user_favorites,
      identity.user_start_pages, identity.user_preference_states, identity.frontend_logging_settings,
      identity.frontend_logging_targets TO ${appReadonly}`);
    await client.query(`GRANT SELECT (account_id, consumed_at, revoked_at, expires_at) ON identity.password_authorizations TO ${appReadonly}`);
    await client.query(`GRANT SELECT ON ops.schema_migrations, ops.seed_runs, ops.import_runs TO ${appReadonly}`);
  }

  for (const schema of ["core", "identity", "play", "venue", "messaging"]) {
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}, ${refresh}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${worker}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT USAGE, SELECT ON SEQUENCES TO ${app}, ${refresh}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT UPDATE ON SEQUENCES TO ${refresh}`);
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
      for (const suffix of Object.keys(passwords)) {
        if (![...LOGIN_ROLE_SUFFIXES, ...OPTIONAL_LOGIN_ROLE_SUFFIXES].includes(suffix)) throw Object.assign(new Error("Unbekannte Bootstraprolle"), { code: "DB_BOOTSTRAP_ROLE_INVALID" });
        await ensureRole(admin, names[suffix], { login: true, password: passwords[suffix] });
      }
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
    await target.query(`GRANT CONNECT ON DATABASE ${identifier(database, "Datenbankname")} TO ${Object.keys(passwords).map((suffix) => identifier(names[suffix], "Rollenname")).join(", ")}`);
    if (await applicationSchemasExist(target)) {
      await grantSchemaPrivileges(target, names, { readOnly: Boolean(passwords.app_readonly) });
      grantsApplied = true;
    }
  } finally {
    await target.end();
  }
  output(JSON.stringify({ event: "db_bootstrap_completed", database, result: "success", grantsApplied }));
  return { names, grantsApplied };
}

async function applyExistingDatabaseGrants({ adminConnectionConfig, prefix, database, readOnly = true, output = console.log }) {
  const names = roleNames(prefix);
  identifier(database, "Datenbankname");
  const suffixes = [...LOGIN_ROLE_SUFFIXES, ...(readOnly ? OPTIONAL_LOGIN_ROLE_SUFFIXES : [])];
  const client = new Client({ ...adminConnectionConfig, database });
  output(JSON.stringify({ event: "db_grants_started", database, prefix }));
  await client.connect();
  try {
    const existing = await client.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])", [suffixes.map((suffix) => names[suffix])]);
    if (existing.rowCount !== suffixes.length) throw Object.assign(new Error("Bestehende Laufzeitrollen fehlen"), { code: "DB_GRANTS_ROLE_MISSING" });
    await client.query(`REVOKE CONNECT ON DATABASE ${identifier(database, "Datenbankname")} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${identifier(database, "Datenbankname")} TO ${suffixes.map((suffix) => identifier(names[suffix], "Rollenname")).join(", ")}`);
    await grantSchemaPrivileges(client, names, { readOnly });
    output(JSON.stringify({ event: "db_grants_completed", database, result: "success" }));
    return { names };
  } catch (error) {
    output(JSON.stringify({ event: "db_grants_completed", database, result: "failed", errorCode: error.code || "DB_GRANTS_FAILED" }));
    throw Object.assign(error, { completionLogged: true });
  } finally { await client.end(); }
}

async function verifyBootstrap({ adminConnectionConfig, prefix, database, passwords = {} }) {
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
        has_table_privilege($2, 'identity.sessions', 'SELECT,UPDATE,DELETE')
          AND has_table_privilege($2, 'ops.idempotency_operations', 'SELECT,UPDATE,DELETE')
          AND has_table_privilege($2, 'ops.audit_operations', 'SELECT,UPDATE,DELETE')
          AND has_table_privilege($2, 'messaging.event_recipients', 'SELECT,UPDATE,DELETE')
          AND has_table_privilege($2, 'venue.hall_time_allocations', 'SELECT,UPDATE,DELETE')
          AND has_table_privilege($2, 'venue.hall_time_history', 'INSERT')
          AND has_table_privilege($2, 'venue.hall_time_grids', 'UPDATE') AS worker_maintenance_write,
        has_table_privilege($2, 'ops.schema_migrations', 'SELECT')
          AND has_table_privilege($2, 'ops.seed_runs', 'SELECT')
          AND has_table_privilege($2, 'ops.import_runs', 'SELECT') AS worker_runtime_metadata_read,
        NOT has_table_privilege($2, 'identity.people', 'UPDATE') AS worker_no_people_write,
        has_table_privilege($3, 'ops.schema_migrations', 'SELECT') AS monitor_migrations,
        NOT has_table_privilege($3, 'identity.people', 'SELECT') AS monitor_no_people,
        pg_has_role($4, $5, 'SET') AS migrator_can_set_owner,
        has_table_privilege($6, 'ops.idempotency_operations', 'SELECT,INSERT,UPDATE,DELETE')
          AND has_table_privilege($6, 'ops.audit_operations', 'SELECT,INSERT,UPDATE,DELETE')
          AND has_table_privilege($6, 'ops.audit_security_context', 'SELECT,INSERT,UPDATE,DELETE')
          AND has_table_privilege($6, 'ops.audit_transitions', 'SELECT,INSERT,UPDATE,DELETE') AS refresh_import_ops_write,
        has_table_privilege($6, 'ops.jobs', 'SELECT')
          AND has_table_privilege($6, 'ops.outbox', 'SELECT') AS refresh_effect_state_read,
        has_sequence_privilege($6, 'identity.person_contract_id_seq', 'USAGE,SELECT,UPDATE') AS refresh_person_sequence_repair
    `, [names.app, names.worker, names.monitor, names.migrator, names.owner, names.refresh]);
    const checks = result.rows[0];
    if (Object.values(checks).some((value) => value !== true)) {
      throw Object.assign(new Error("Rollen- oder Grantverifikation fehlgeschlagen"), { code: "DB_BOOTSTRAP_VERIFY_FAILED", checks });
    }
    if (passwords.app_readonly) {
      const readOnly = await client.query(`
        SELECT has_database_privilege($1, current_database(), 'CONNECT') AS connect,
               has_table_privilege($1, 'identity.people', 'SELECT') AS people_read,
               has_table_privilege($1, 'play.matches', 'SELECT') AS matches_read,
               has_table_privilege($1, 'ops.import_runs', 'SELECT') AS import_read,
               NOT (has_table_privilege($1, 'identity.people', 'INSERT') OR has_table_privilege($1, 'identity.people', 'UPDATE') OR has_table_privilege($1, 'identity.people', 'DELETE')) AS no_people_write,
               NOT (has_table_privilege($1, 'identity.sessions', 'INSERT') OR has_table_privilege($1, 'identity.sessions', 'UPDATE') OR has_table_privilege($1, 'identity.sessions', 'DELETE')) AS no_session_write,
               NOT (has_table_privilege($1, 'ops.audit_operations', 'INSERT') OR has_table_privilege($1, 'ops.audit_operations', 'UPDATE') OR has_table_privilege($1, 'ops.audit_operations', 'DELETE')) AS no_audit_write,
               NOT (has_table_privilege($1, 'ops.idempotency_operations', 'INSERT') OR has_table_privilege($1, 'ops.idempotency_operations', 'UPDATE') OR has_table_privilege($1, 'ops.idempotency_operations', 'DELETE')) AS no_idempotency_write,
               NOT (has_table_privilege($1, 'ops.jobs', 'INSERT') OR has_table_privilege($1, 'ops.jobs', 'UPDATE') OR has_table_privilege($1, 'ops.jobs', 'DELETE')) AS no_job_write,
               NOT (has_table_privilege($1, 'ops.outbox', 'INSERT') OR has_table_privilege($1, 'ops.outbox', 'UPDATE') OR has_table_privilege($1, 'ops.outbox', 'DELETE')) AS no_outbox_write
      `, [names.app_readonly]);
      if (Object.values(readOnly.rows[0]).some((value) => value !== true)) throw Object.assign(new Error("Read-only-Rollenverifikation fehlgeschlagen"), { code: "DB_BOOTSTRAP_VERIFY_FAILED", checks: readOnly.rows[0] });
      Object.assign(checks, Object.fromEntries(Object.entries(readOnly.rows[0]).map(([key, value]) => [`readonly_${key}`, value])));
    }
    return checks;
  } finally {
    await client.end();
  }
}

module.exports = { applyBootstrap, applyExistingDatabaseGrants, createBootstrapConfig, roleNames, verifyBootstrap };
