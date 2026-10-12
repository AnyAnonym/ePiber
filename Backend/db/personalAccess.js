"use strict";

const { Client } = require("pg");

const APPLICATION_SCHEMAS = Object.freeze(["core", "identity", "play", "venue", "messaging", "ops"]);

function identifier(value, label) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(String(value))) {
    throw Object.assign(new Error(`${label} ist ungueltig`), { code: "DB_PERSONAL_ACCESS_IDENTIFIER_INVALID" });
  }
  return `"${value}"`;
}

function createPersonalAccessConfig(env = process.env) {
  const database = env.EPIBER_DB_NAME || env.PGDATABASE || "epiber_devel";
  const ownerRole = env.EPIBER_DB_OWNER_ROLE || "epiber_devel_owner";
  const readerRole = env.EPIBER_DB_PERSONAL_READER_ROLE || "paj_devel_ro";
  const adminRole = env.EPIBER_DB_PERSONAL_ADMIN_ROLE || "paj_devel_admin";
  for (const [label, value] of Object.entries({ database, ownerRole, readerRole, adminRole })) identifier(value, label);
  if (new Set([ownerRole, readerRole, adminRole]).size !== 3) {
    throw Object.assign(new Error("Persoenliche Rollen muessen getrennt sein"), { code: "DB_PERSONAL_ACCESS_ROLE_CONFLICT" });
  }
  return { database, ownerRole, readerRole, adminRole };
}

async function assertLoginRole(client, role) {
  const result = await client.query("SELECT rolcanlogin FROM pg_roles WHERE rolname=$1", [role]);
  if (result.rowCount !== 1 || result.rows[0].rolcanlogin !== true) {
    throw Object.assign(new Error("Persoenliche Loginrolle fehlt"), { code: "DB_PERSONAL_ACCESS_ROLE_MISSING" });
  }
}

async function applyPersonalAccess({ adminConnectionConfig, database, ownerRole, readerRole, adminRole, output = console.log }) {
  const config = createPersonalAccessConfig({
    PGDATABASE: database,
    EPIBER_DB_OWNER_ROLE: ownerRole,
    EPIBER_DB_PERSONAL_READER_ROLE: readerRole,
    EPIBER_DB_PERSONAL_ADMIN_ROLE: adminRole,
  });
  output(JSON.stringify({ event: "db_personal_access_started", database: config.database, readerRole: config.readerRole, adminRole: config.adminRole }));
  const client = new Client({ ...adminConnectionConfig, database: config.database });
  await client.connect();
  try {
    await assertLoginRole(client, config.readerRole);
    await assertLoginRole(client, config.adminRole);
    const owner = identifier(config.ownerRole, "ownerRole");
    const reader = identifier(config.readerRole, "readerRole");
    const admin = identifier(config.adminRole, "adminRole");
    const databaseName = identifier(config.database, "database");
    const schemas = APPLICATION_SCHEMAS.map((schema) => identifier(schema, "schema")).join(", ");

    await client.query("BEGIN");
    try {
      await client.query(`ALTER ROLE ${reader} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await client.query(`ALTER ROLE ${admin} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await client.query(`GRANT CONNECT ON DATABASE ${databaseName} TO ${reader}, ${admin}`);
      await client.query(`GRANT USAGE ON SCHEMA ${schemas} TO ${reader}, ${admin}`);
      await client.query(`REVOKE CREATE ON SCHEMA ${schemas} FROM ${reader}, ${admin}`);

      for (const schemaName of APPLICATION_SCHEMAS) {
        const schema = identifier(schemaName, "schema");
        await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${reader}, ${admin}`);
        await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${reader}, ${admin}`);
        await client.query(`GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${admin}`);
        await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${reader}, ${admin}`);
        await client.query(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${reader}, ${admin}`);
        await client.query(`GRANT USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${admin}`);

        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} REVOKE ALL ON TABLES FROM ${reader}, ${admin}`);
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${reader}, ${admin}`);
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT INSERT, UPDATE, DELETE ON TABLES TO ${admin}`);
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} REVOKE ALL ON SEQUENCES FROM ${reader}, ${admin}`);
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT SELECT ON SEQUENCES TO ${reader}, ${admin}`);
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT USAGE, UPDATE ON SEQUENCES TO ${admin}`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const checks = await verifyPersonalAccess({ adminConnectionConfig, ...config });
    output(JSON.stringify({ event: "db_personal_access_completed", database: config.database, readerRole: config.readerRole, adminRole: config.adminRole, result: "success", tableCount: checks.tableCount, sequenceCount: checks.sequenceCount }));
    return checks;
  } catch (error) {
    output(JSON.stringify({ event: "db_personal_access_completed", database: config.database, readerRole: config.readerRole, adminRole: config.adminRole, result: "failed", errorCode: error.code || "DB_PERSONAL_ACCESS_FAILED" }));
    throw Object.assign(error, { completionLogged: true });
  } finally {
    await client.end();
  }
}

async function verifyPersonalAccess({ adminConnectionConfig, database, ownerRole, readerRole, adminRole }) {
  const config = createPersonalAccessConfig({
    PGDATABASE: database,
    EPIBER_DB_OWNER_ROLE: ownerRole,
    EPIBER_DB_PERSONAL_READER_ROLE: readerRole,
    EPIBER_DB_PERSONAL_ADMIN_ROLE: adminRole,
  });
  const client = new Client({ ...adminConnectionConfig, database: config.database });
  await client.connect();
  try {
    const roles = await client.query(`
      SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit
      FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname
    `, [[config.readerRole, config.adminRole]]);
    if (roles.rowCount !== 2 || roles.rows.some((role) => !role.rolcanlogin || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls || role.rolinherit)) {
      throw Object.assign(new Error("Persoenliche Rollenattribute sind ungueltig"), { code: "DB_PERSONAL_ACCESS_VERIFY_FAILED" });
    }
    const memberships = await client.query("SELECT count(*)::integer AS count FROM pg_auth_members WHERE member=ANY(SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))", [[config.readerRole, config.adminRole]]);
    const tables = await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname=ANY($1::text[]) ORDER BY schemaname,tablename", [APPLICATION_SCHEMAS]);
    const sequences = await client.query("SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname=ANY($1::text[]) ORDER BY schemaname,sequencename", [APPLICATION_SCHEMAS]);
    const checks = {
      readerConnect: (await client.query("SELECT has_database_privilege($1,current_database(),'CONNECT') AS value", [config.readerRole])).rows[0].value,
      adminConnect: (await client.query("SELECT has_database_privilege($1,current_database(),'CONNECT') AS value", [config.adminRole])).rows[0].value,
      readerSchemas: (await client.query("SELECT bool_and(has_schema_privilege($1,schema_name,'USAGE') AND NOT has_schema_privilege($1,schema_name,'CREATE')) AS value FROM unnest($2::text[]) schema_name", [config.readerRole, APPLICATION_SCHEMAS])).rows[0].value,
      adminSchemas: (await client.query("SELECT bool_and(has_schema_privilege($1,schema_name,'USAGE') AND NOT has_schema_privilege($1,schema_name,'CREATE')) AS value FROM unnest($2::text[]) schema_name", [config.adminRole, APPLICATION_SCHEMAS])).rows[0].value,
      noMemberships: memberships.rows[0].count === 0,
    };
    const tablePrivileges = await client.query(`
      SELECT
        bool_and(has_table_privilege($1,format('%I.%I',schemaname,tablename),'SELECT')) AS reader_read,
        bool_and(NOT has_table_privilege($1,format('%I.%I',schemaname,tablename),'INSERT')
          AND NOT has_table_privilege($1,format('%I.%I',schemaname,tablename),'UPDATE')
          AND NOT has_table_privilege($1,format('%I.%I',schemaname,tablename),'DELETE')) AS reader_no_write,
        bool_and(has_table_privilege($2,format('%I.%I',schemaname,tablename),'SELECT')
          AND has_table_privilege($2,format('%I.%I',schemaname,tablename),'INSERT')
          AND has_table_privilege($2,format('%I.%I',schemaname,tablename),'UPDATE')
          AND has_table_privilege($2,format('%I.%I',schemaname,tablename),'DELETE')) AS admin_read_write,
        bool_and(NOT has_table_privilege($2,format('%I.%I',schemaname,tablename),'TRUNCATE')
          AND NOT has_table_privilege($2,format('%I.%I',schemaname,tablename),'TRIGGER')) AS admin_no_structural_write
      FROM pg_tables WHERE schemaname=ANY($3::text[])
    `, [config.readerRole, config.adminRole, APPLICATION_SCHEMAS]);
    const sequencePrivileges = await client.query(`
      SELECT
        COALESCE(bool_and(has_sequence_privilege($1,format('%I.%I',schemaname,sequencename),'SELECT')
          AND NOT has_sequence_privilege($1,format('%I.%I',schemaname,sequencename),'USAGE')
          AND NOT has_sequence_privilege($1,format('%I.%I',schemaname,sequencename),'UPDATE')),true) AS reader_sequences,
        COALESCE(bool_and(has_sequence_privilege($2,format('%I.%I',schemaname,sequencename),'SELECT')
          AND has_sequence_privilege($2,format('%I.%I',schemaname,sequencename),'USAGE')
          AND has_sequence_privilege($2,format('%I.%I',schemaname,sequencename),'UPDATE')),true) AS admin_sequences
      FROM pg_sequences WHERE schemaname=ANY($3::text[])
    `, [config.readerRole, config.adminRole, APPLICATION_SCHEMAS]);
    Object.assign(checks, tablePrivileges.rows[0], sequencePrivileges.rows[0], { tableCount: tables.rowCount, sequenceCount: sequences.rowCount });
    if (Object.entries(checks).some(([name, value]) => !name.endsWith("Count") && value !== true)) {
      throw Object.assign(new Error("Persoenliche Zugriffsverifikation fehlgeschlagen"), { code: "DB_PERSONAL_ACCESS_VERIFY_FAILED", checks });
    }
    return checks;
  } finally {
    await client.end();
  }
}

module.exports = { APPLICATION_SCHEMAS, applyPersonalAccess, createPersonalAccessConfig, verifyPersonalAccess };
