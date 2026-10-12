"use strict";

class PostgresProjectionLoader {
  constructor({ projectionService, dataStore, publish = () => {}, log = () => {} }) {
    this.projectionService = projectionService;
    this.dataStore = dataStore;
    this.publish = publish;
    this.log = log;
    this.active = null;
    this.lastCompletedAt = 0;
    this.lastErrorCode = null;
  }

  async refresh(reason = "startup") {
    if (this.active) return this.active;
    const startedAt = Date.now();
    this.active = (async () => {
      try {
        const tables = await this.projectionService.load();
        const results = this.dataStore.setAllAuthoritative(tables, { source: `postgres-${reason}` });
        if (!results) throw Object.assign(new Error("POSTGRES_PROJECTION_APPLY_FAILED"), { code: "POSTGRES_PROJECTION_APPLY_FAILED" });
        this.lastCompletedAt = Date.now();
        this.lastErrorCode = null;
        const changed = results.filter((entry) => entry.changed).map((entry) => entry.table);
        for (const table of changed) this.publish(table === "matches1" ? "matches" : table, { table, ...this.dataStore.getMeta(table) });
        this.log("info", "postgres_projection_refresh_completed", { reason, result: "success", tableCount: results.length, changedTableCount: changed.length, durationMs: Date.now() - startedAt });
        return { success: true, tableCount: results.length, changedTables: changed, refreshedAt: this.lastCompletedAt };
      } catch (error) {
        this.lastErrorCode = error.code || "POSTGRES_PROJECTION_REFRESH_FAILED";
        this.log("error", "postgres_projection_refresh_completed", { reason, result: "failed", errorCode: this.lastErrorCode, durationMs: Date.now() - startedAt });
        throw error;
      } finally {
        this.active = null;
      }
    })();
    return this.active;
  }

  initialLoad() { return this.refresh("startup"); }
  start() {}
  stop() { return this.active || Promise.resolve(); }
  getStatus() {
    return { running: false, active: Boolean(this.active), lastCompletedAt: this.lastCompletedAt, lastErrorCode: this.lastErrorCode };
  }
}

module.exports = { PostgresProjectionLoader };
