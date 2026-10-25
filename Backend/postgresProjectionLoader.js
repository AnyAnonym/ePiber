"use strict";

const { AppError } = require("./errors.js");
const metrics = require("./metrics.js");

class PostgresProjectionLoader {
  constructor({ projectionService, dataStore, log = () => {} }) {
    this.projectionService = projectionService;
    this.dataStore = dataStore;
    this.log = log;
    this.active = null;
    this.lastCompletedAt = 0;
    this.lastErrorCode = null;
    this.lastAttemptAt = 0;
    this.lastFailureAt = 0;
    this.requestedGeneration = 0;
    this.pendingReason = null;
    this.stopping = false;
  }

  refresh(reason = "startup") {
    if (this.stopping) return Promise.reject(new AppError("SHUTTING_DOWN", "Server wird beendet", 503));
    this.requestedGeneration++;
    this.pendingReason = reason;
    if (this.active) return this.active;
    this.lastAttemptAt = Date.now();
    // Defer work until active is assigned, including synchronously failing loaders.
    this.active = Promise.resolve().then(async () => {
      try {
        let result;
        let generation;
        do {
          generation = this.requestedGeneration;
          result = await this.load(this.pendingReason);
        } while (generation !== this.requestedGeneration);
        return result;
      } finally {
        this.active = null;
      }
    });
    return this.active;
  }

  async load(reason) {
    const startedAt = Date.now();
    this.lastAttemptAt = startedAt;
    try {
      const tables = await this.projectionService.load();
      const results = this.dataStore.setAllAuthoritative(tables, { source: `postgres-${reason}` });
      if (!results) throw Object.assign(new Error("POSTGRES_PROJECTION_APPLY_FAILED"), { code: "POSTGRES_PROJECTION_APPLY_FAILED" });
      this.lastCompletedAt = Date.now();
      this.lastErrorCode = null;
      const changed = results.filter((entry) => entry.changed).map((entry) => entry.table);
      // DataStore listeners publish the atomic snapshot; do not publish it twice.
      metrics.recordProjectionRefresh({ reason, result: "success", durationMs: Date.now() - startedAt });
      this.log("info", "postgres_projection_refresh_completed", { reason, result: "success", tableCount: results.length, changedTableCount: changed.length, durationMs: Date.now() - startedAt });
      return { success: true, tableCount: results.length, changedTables: changed, refreshedAt: this.lastCompletedAt };
    } catch (error) {
      this.lastErrorCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error.code || "")) ? error.code : "POSTGRES_PROJECTION_REFRESH_FAILED";
      this.lastFailureAt = Date.now();
      metrics.recordProjectionRefresh({ reason, result: "failed", durationMs: Date.now() - startedAt });
      this.log("error", "postgres_projection_refresh_completed", { reason, result: "failed", errorCode: this.lastErrorCode, durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  initialLoad() { return this.refresh("startup"); }
  stop() { this.stopping = true; return this.active || Promise.resolve(); }
  getStatus() {
    return {
      backend: "postgres", running: false, active: Boolean(this.active),
      lastCompletedAt: this.lastCompletedAt, lastErrorCode: this.lastErrorCode,
      lastAttemptAt: this.lastAttemptAt || null,
      lastSuccessfulRefreshAt: this.lastCompletedAt || null,
      dataAgeMs: this.lastCompletedAt ? Math.max(0, Date.now() - this.lastCompletedAt) : null,
      inProgress: this.active ? { startedAt: this.lastAttemptAt || null } : null,
      lastControlledFailure: this.lastErrorCode ? {
        at: this.lastFailureAt, code: this.lastErrorCode,
        message: "Die PostgreSQL-Projektionen konnten nicht neu geladen werden. Der letzte gültige Stand bleibt erhalten.",
        supportId: null,
      } : null,
    };
  }
}

module.exports = { PostgresProjectionLoader };
