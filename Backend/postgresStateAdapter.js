"use strict";

class PostgresStateAdapter {
  constructor({ identity, venue, ops, preferences = null }) {
    this.identity = identity;
    this.venue = venue;
    this.ops = ops;
    this.preferences = preferences;
  }

  getUserFavorites(userId) { return this.identity.userFavorites(userId); }
  getUserStartPage(userId) { return this.identity.userStartPage(userId); }
  setUserFavorites(userId, params) {
    if (!this.preferences) throw Object.assign(new Error("PREFERENCE_SERVICE_NOT_READY"), { code: "PREFERENCE_SERVICE_NOT_READY" });
    return this.preferences.setUserFavorites(userId, params);
  }
  setUserStartPage(userId, params) {
    if (!this.preferences) throw Object.assign(new Error("PREFERENCE_SERVICE_NOT_READY"), { code: "PREFERENCE_SERVICE_NOT_READY" });
    return this.preferences.setUserStartPage(userId, params);
  }
  authenticateMonitor(token) { return this.venue.monitorByToken(token); }
  listMonitors() { return this.venue.listMonitors(); }
  provisionMonitor(label, monitorId) { return this.venue.provisionMonitor(label, monitorId); }
  rotateMonitorToken(monitorId) { return this.venue.rotateMonitorToken(monitorId); }
  revokeMonitor(monitorId) { return this.venue.revokeMonitor(monitorId); }

  getOperationStatus(actorKey, operationId) {
    const match = /^user:(.+)$/.exec(String(actorKey || ""));
    if (!match) return Promise.resolve(null);
    return this.ops.idempotencyStatus(operationId, match[1]);
  }
}

module.exports = { PostgresStateAdapter };
