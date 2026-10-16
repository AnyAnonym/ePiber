"use strict";

const fs = require("fs");

function readSecret(filename) {
  const stat = fs.statSync(filename);
  if (!stat.isFile() || (stat.mode & 0o037) !== 0) throw new Error("DB_PASSWORD_FILE_INSECURE");
  const value = fs.readFileSync(filename, "utf8").trim();
  if (!value) throw new Error("DB_PASSWORD_FILE_EMPTY");
  return value;
}

function createConnectionConfig(env = process.env) {
  const config = {
    host: env.PGHOST || "/run/postgresql/devel",
    port: Number.parseInt(env.PGPORT || "5433", 10),
    database: env.PGDATABASE || "epiber_devel",
    user: env.PGUSER,
    application_name: env.PGAPPNAME || "epiber-db-tool",
    ssl: false,
  };

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("DB_PORT_INVALID");
  }
  if (!config.user) throw new Error("DB_USER_REQUIRED");

  if (env.EPIBER_DB_ROLE) {
    if (!/^[a-z][a-z0-9_]{2,62}$/.test(env.EPIBER_DB_ROLE)) throw new Error("DB_ROLE_INVALID");
    config.options = `-c role=${env.EPIBER_DB_ROLE}`;
  }

  const passwordFile = env.EPIBER_DB_PASSWORD_FILE
    || (env.CREDENTIALS_DIRECTORY ? `${env.CREDENTIALS_DIRECTORY}/postgres-password` : null);
  if (passwordFile) config.password = readSecret(passwordFile);

  return config;
}

module.exports = { createConnectionConfig, readSecret };
