"use strict";

const { Pool } = require("pg");

const DEFAULT_REQUIRED_DOMAINS = Object.freeze(["core", "identity", "play", "venue", "messaging", "ops"]);
const ISOLATION_LEVELS = Object.freeze({
  read_committed: "READ COMMITTED",
  repeatable_read: "REPEATABLE READ",
  serializable: "SERIALIZABLE",
});
const RETRYABLE_CODES = new Set(["40001", "40P01"]);

class RuntimeDatabaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RuntimeDatabaseError";
    this.code = code;
    this.details = details;
  }
}

function errorCode(error, fallback = "DB_OPERATION_FAILED") {
  return String(error?.code || fallback).slice(0, 100);
}

function runtimeConnectionConfig(connectionConfig, { maxConnections, statementTimeoutMs }) {
  const options = [connectionConfig.options, "-c timezone=UTC", `-c statement_timeout=${statementTimeoutMs}`]
    .filter(Boolean)
    .join(" ");
  return {
    ...connectionConfig,
    options,
    max: maxConnections,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: false,
  };
}

class RuntimeDatabase {
  constructor({
    connectionConfig,
    expectedTenantCode,
    requiredDomains = DEFAULT_REQUIRED_DOMAINS,
    minimumGeneration = 6,
    maximumGeneration = 8,
    maxConnections = 5,
    statementTimeoutMs = 10_000,
    poolFactory = (config) => new Pool(config),
    log = () => {},
  }) {
    if (!connectionConfig || typeof connectionConfig !== "object") throw new RuntimeDatabaseError("DB_CONFIG_REQUIRED", "PostgreSQL-Konfiguration fehlt");
    if (!/^[a-z][a-z0-9-]{2,62}$/.test(String(expectedTenantCode || ""))) throw new RuntimeDatabaseError("DB_TENANT_CODE_INVALID", "Erwarteter Tenantcode ist ungueltig");
    if (!Number.isInteger(minimumGeneration) || !Number.isInteger(maximumGeneration) || minimumGeneration < 1 || maximumGeneration < minimumGeneration) {
      throw new RuntimeDatabaseError("DB_SCHEMA_RANGE_INVALID", "PostgreSQL-Schemabereich ist ungueltig");
    }
    if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 5) throw new RuntimeDatabaseError("DB_POOL_SIZE_INVALID", "PostgreSQL-App-Pool darf hoechstens fuenf Verbindungen verwenden");
    if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 100 || statementTimeoutMs > 120_000) throw new RuntimeDatabaseError("DB_STATEMENT_TIMEOUT_INVALID", "PostgreSQL-Statement-Timeout ist ungueltig");
    const domains = [...new Set(requiredDomains.map(String))].sort();
    if (!domains.length || domains.some((domain) => !/^[a-z][a-z0-9_]{1,31}$/.test(domain))) throw new RuntimeDatabaseError("DB_DOMAIN_SET_INVALID", "PostgreSQL-Pflichtdomaenen sind ungueltig");

    this.connectionConfig = runtimeConnectionConfig(connectionConfig, { maxConnections, statementTimeoutMs });
    this.expectedTenantCode = expectedTenantCode;
    this.requiredDomains = Object.freeze(domains);
    this.minimumGeneration = minimumGeneration;
    this.maximumGeneration = maximumGeneration;
    this.poolFactory = poolFactory;
    this.log = log;
    this.registrations = new Map();
    this.repositories = null;
    this.pool = null;
    this.context = null;
    this.connecting = null;
    this.closing = false;
    this.lastErrorCode = null;
    this.listeners = new Set();
  }

  registerDomain(name, factory) {
    const domain = String(name || "");
    if (!this.requiredDomains.includes(domain)) throw new RuntimeDatabaseError("DB_DOMAIN_UNKNOWN", `Unbekannte PostgreSQL-Domaene ${domain}`);
    if (typeof factory !== "function") throw new RuntimeDatabaseError("DB_DOMAIN_FACTORY_INVALID", `Repository-Factory fuer ${domain} fehlt`);
    if (this.pool || this.connecting) throw new RuntimeDatabaseError("DB_DOMAIN_REGISTRATION_CLOSED", "PostgreSQL-Domaenenregistrierung ist bereits geschlossen");
    if (this.registrations.has(domain)) throw new RuntimeDatabaseError("DB_DOMAIN_DUPLICATE", `PostgreSQL-Domaene ${domain} ist doppelt registriert`);
    this.registrations.set(domain, factory);
    return this;
  }

  assertCompleteRegistration() {
    const missing = this.requiredDomains.filter((domain) => !this.registrations.has(domain));
    if (missing.length) throw new RuntimeDatabaseError("DB_DOMAINS_INCOMPLETE", "PostgreSQL-Pflichtdomaenen sind nicht vollstaendig registriert", { missing });
  }

  async verifyDatabase(pool) {
    const result = await pool.query(`
      SELECT current_setting('TimeZone') AS time_zone,
             COALESCE((SELECT max(migration_id) FROM ops.schema_migrations WHERE result = 'success'), 0)::integer AS generation,
             (SELECT count(*)::integer FROM core.tenants) AS tenant_count,
             (SELECT tenant_code FROM core.tenants LIMIT 1) AS tenant_code,
             (SELECT id::text FROM core.tenants LIMIT 1) AS tenant_id,
             (SELECT count(*)::integer FROM core.sections s JOIN core.tenants t ON t.id=s.tenant_id WHERE t.tenant_code=$1 AND s.section_code='tennis' AND s.active) AS active_tennis_sections,
             EXISTS (SELECT 1 FROM ops.seed_runs WHERE result='success') OR EXISTS (SELECT 1 FROM ops.import_runs WHERE result='success') AS data_released
    `, [this.expectedTenantCode]);
    const row = result.rows[0];
    if (row.time_zone !== "UTC") throw new RuntimeDatabaseError("DB_TIME_ZONE_MISMATCH", "PostgreSQL-Laufzeitverbindung verwendet nicht UTC");
    if (row.generation < this.minimumGeneration || row.generation > this.maximumGeneration) {
      throw new RuntimeDatabaseError("DB_SCHEMA_INCOMPATIBLE", "PostgreSQL-Schemageneration ist nicht kompatibel", { generation: row.generation, minimum: this.minimumGeneration, maximum: this.maximumGeneration });
    }
    if (row.tenant_count !== 1 || row.tenant_code !== this.expectedTenantCode) throw new RuntimeDatabaseError("DB_TENANT_MISMATCH", "PostgreSQL-Tenant stimmt nicht mit der Laufzeitkonfiguration ueberein");
    if (row.active_tennis_sections !== 1) throw new RuntimeDatabaseError("DB_SECTION_MISMATCH", "Aktive Tennis-Sektion fehlt oder ist nicht eindeutig");
    if (!row.data_released) throw new RuntimeDatabaseError("DB_DATA_NOT_RELEASED", "PostgreSQL-Bestand besitzt kein erfolgreiches Seed- oder Importgate");
    return Object.freeze({ tenantId: row.tenant_id, tenantCode: row.tenant_code, generation: row.generation });
  }

  gateway(target = this.pool) {
    return Object.freeze({
      query: (text, values) => target.query(text, values),
      withTransaction: (operation, callback, options) => this.withTransaction(operation, callback, options),
    });
  }

  async connect() {
    if (this.repositories) return this.repositories;
    if (this.connecting) return this.connecting;
    this.assertCompleteRegistration();
    const startedAt = Date.now();
    this.closing = false;
    this.log("info", "postgres_runtime_starting", { requiredDomains: this.requiredDomains.length });
    this.connecting = (async () => {
      const pool = this.poolFactory(this.connectionConfig);
      this.pool = pool;
      pool.on?.("error", (error) => {
        this.lastErrorCode = errorCode(error, "DB_POOL_ERROR");
        this.log("error", "postgres_pool_error", { errorCode: this.lastErrorCode });
      });
      try {
        this.context = await this.verifyDatabase(pool);
        const gateway = this.gateway(pool);
        const repositories = {};
        for (const domain of this.requiredDomains) {
          const repository = await this.registrations.get(domain)({ database: gateway, context: this.context });
          if (!repository || typeof repository !== "object") throw new RuntimeDatabaseError("DB_DOMAIN_INITIALIZATION_FAILED", `PostgreSQL-Domaene ${domain} lieferte kein Repository`);
          if (typeof repository.initialize === "function") await repository.initialize();
          repositories[domain] = repository;
        }
        this.repositories = Object.freeze(repositories);
        this.lastErrorCode = null;
        this.log("info", "postgres_runtime_started", { result: "success", generation: this.context.generation, domains: this.requiredDomains.length, durationMs: Date.now() - startedAt });
        return this.repositories;
      } catch (error) {
        this.lastErrorCode = errorCode(error, "DB_RUNTIME_START_FAILED");
        this.log("error", "postgres_runtime_started", { result: "failed", errorCode: this.lastErrorCode, durationMs: Date.now() - startedAt });
        this.repositories = null;
        this.context = null;
        this.pool = null;
        await pool.end().catch(() => {});
        throw error;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  async withTransaction(operation, callback, { isolation = "read_committed", retries = 0 } = {}) {
    if (!this.pool || !this.repositories || this.closing) throw new RuntimeDatabaseError("DB_RUNTIME_NOT_READY", "PostgreSQL-Laufzeit ist nicht bereit");
    if (!/^[a-z][a-z0-9_.-]{1,126}$/.test(String(operation || ""))) throw new RuntimeDatabaseError("DB_OPERATION_INVALID", "PostgreSQL-Operationsname ist ungueltig");
    const isolationSql = ISOLATION_LEVELS[isolation];
    if (!isolationSql) throw new RuntimeDatabaseError("DB_ISOLATION_INVALID", "PostgreSQL-Isolationsstufe ist ungueltig");
    if (!Number.isInteger(retries) || retries < 0 || retries > 2) throw new RuntimeDatabaseError("DB_RETRY_INVALID", "PostgreSQL-Retryanzahl ist ungueltig");
    for (let attempt = 0; ; attempt += 1) {
      const startedAt = Date.now();
      const client = await this.pool.connect();
      let commitStarted = false;
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolationSql}`);
        const result = await callback(this.gateway(client));
        commitStarted = true;
        await client.query("COMMIT");
        this.log("info", "postgres_transaction_completed", { operation, result: "success", attempt: attempt + 1, durationMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        const code = errorCode(error);
        try { await client.query("ROLLBACK"); } catch {}
        if (RETRYABLE_CODES.has(code) && attempt < retries) {
          this.log("warn", "postgres_transaction_completed", { operation, result: "retry", errorCode: code, attempt: attempt + 1, durationMs: Date.now() - startedAt });
          continue;
        }
        const knownPostgresFailure = /^[0-9A-Z]{5}$/.test(code);
        if (commitStarted && !knownPostgresFailure) {
          const unknown = new RuntimeDatabaseError("DB_COMMIT_OUTCOME_UNKNOWN", "PostgreSQL-Commit-Ausgang ist unklar", { operation });
          this.log("error", "postgres_transaction_completed", { operation, result: "unknown", errorCode: unknown.code, attempt: attempt + 1, durationMs: Date.now() - startedAt });
          throw unknown;
        }
        this.log("warn", "postgres_transaction_completed", { operation, result: "failed", errorCode: code, attempt: attempt + 1, durationMs: Date.now() - startedAt });
        throw error;
      } finally {
        client.release();
      }
    }
  }

  status() {
    return {
      configured: true,
      ready: Boolean(this.repositories && this.context && !this.closing),
      closing: this.closing,
      generation: this.context?.generation || null,
      tenantCode: this.context?.tenantCode || this.expectedTenantCode,
      registeredDomains: [...this.registrations.keys()].sort(),
      requiredDomains: this.requiredDomains,
      lastErrorCode: this.lastErrorCode,
      pool: this.pool ? { total: this.pool.totalCount || 0, idle: this.pool.idleCount || 0, waiting: this.pool.waitingCount || 0 } : null,
      listeners: this.listeners.size,
    };
  }

  async listen(channel, callback) {
    if (!this.pool || !this.repositories || this.closing) throw new RuntimeDatabaseError("DB_RUNTIME_NOT_READY", "PostgreSQL-Laufzeit ist nicht bereit");
    if (!/^[a-z][a-z0-9_]{1,62}$/.test(String(channel || "")) || typeof callback !== "function") throw new RuntimeDatabaseError("DB_LISTENER_INVALID", "PostgreSQL-Listener ist ungueltig");
    const client = await this.pool.connect();
    const registration = { channel, client, closed: false };
    const handler = (message) => {
      if (!registration.closed && message.channel === channel) callback(message.payload || "");
    };
    client.on("notification", handler);
    try {
      await client.query(`LISTEN ${channel}`);
      this.listeners.add(registration);
    } catch (error) {
      client.off("notification", handler);
      client.release();
      throw error;
    }
    return async () => {
      if (registration.closed) return;
      registration.closed = true;
      this.listeners.delete(registration);
      client.off("notification", handler);
      try { await client.query(`UNLISTEN ${channel}`); } finally { client.release(); }
    };
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    const startedAt = Date.now();
    const repositories = this.repositories;
    this.repositories = null;
    try {
      for (const registration of [...this.listeners]) {
        registration.closed = true;
        this.listeners.delete(registration);
        registration.client.removeAllListeners("notification");
        try { await registration.client.query(`UNLISTEN ${registration.channel}`); } finally { registration.client.release(); }
      }
      if (repositories) {
        for (const domain of [...this.requiredDomains].reverse()) await repositories[domain]?.close?.();
      }
      await this.pool?.end?.();
      this.log("info", "postgres_runtime_stopped", { result: "success", durationMs: Date.now() - startedAt });
    } catch (error) {
      this.lastErrorCode = errorCode(error, "DB_RUNTIME_STOP_FAILED");
      this.log("error", "postgres_runtime_stopped", { result: "failed", errorCode: this.lastErrorCode, durationMs: Date.now() - startedAt });
      throw error;
    } finally {
      this.pool = null;
      this.context = null;
    }
  }
}

module.exports = { DEFAULT_REQUIRED_DOMAINS, RuntimeDatabase, RuntimeDatabaseError, runtimeConnectionConfig };
