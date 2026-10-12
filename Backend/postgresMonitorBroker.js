"use strict";

const crypto = require("crypto");
const { AppError } = require("./errors.js");
const { requestHash } = require("./postgresCompetitionService.js");
const { canonicalizeMonitorPath, idValue, operationId, requireObject, stringValue } = require("./validators.js");

class PostgresMonitorBroker {
  static async create({ venue, ops, dataStore, log = () => {} }) {
    const broker = new PostgresMonitorBroker({ venue, ops, dataStore, log });
    for (const monitor of await venue.listMonitors()) broker.monitors.set(monitor.monitorId, monitor);
    return broker;
  }

  constructor({ venue, ops, dataStore, log }) {
    this.venue = venue;
    this.ops = ops;
    this.dataStore = dataStore;
    this.log = log;
    this.monitors = new Map();
    this.connections = new Map();
    this.commandStatus = new Map();
    this.send = null;
    this.publish = null;
    this.close = null;
  }

  setTransport({ send, publish, close }) { this.send = send; this.publish = publish; this.close = close; }
  target(monitorId) {
    const monitor = this.monitors.get(monitorId);
    return monitor ? { monitorId, path: monitor.targetPath || "/index.html", commandId: monitor.targetCommandId || null, issuedAt: monitor.targetIssuedAt || null, revision: Number(monitor.revision) } : { monitorId, path: "/index.html", commandId: null, issuedAt: null, revision: 0 };
  }
  listMonitors() {
    return [...this.monitors.values()].map((monitor) => ({
      ...monitor, online: this.connections.has(monitor.monitorId), target: this.target(monitor.monitorId), status: this.commandStatus.get(monitor.monitorId) || null,
    })).sort((left, right) => left.label.localeCompare(right.label, "de") || left.monitorId.localeCompare(right.monitorId));
  }
  publishMonitorList() { this.publish?.("monitors", { monitors: this.listMonitors(), at: Date.now() }); }
  async refresh() {
    const rows = await this.venue.listMonitors();
    this.monitors = new Map(rows.map((monitor) => [monitor.monitorId, monitor]));
    this.publishMonitorList();
  }
  publishStatus(monitorId, status) {
    const value = { monitorId, ...status, at: status.at || Date.now() };
    if (status.kind === "navigate") this.commandStatus.set(monitorId, value);
    this.publish?.(`monitor-status:${monitorId}`, value);
  }

  mapError(error) {
    if (error.code === "MONITOR_NOT_FOUND") return new AppError("MONITOR_NOT_FOUND", "Monitor wurde nicht gefunden", 404);
    if (error.code === "IDEMPOTENCY_CONFLICT") return new AppError("IDEMPOTENCY_CONFLICT", "Operation-ID wurde mit anderen Daten verwendet", 409);
    if (error.code === "STALE_COMMAND") return new AppError("STALE_COMMAND", "Kommando ist nicht mehr aktuell", 409);
    return error;
  }

  async execute(principal, opId, command, payload, callback) {
    try {
      return await this.venue.database.withTransaction(command, async (transaction) => {
        const operation = await this.ops.beginIdempotencyOn(transaction, { operationId: opId, actorPersonId: principal.type === "user" ? principal.id : null, command, requestHash: requestHash(payload) });
        if (operation.repeated) {
          if (operation.status === "success") return { ...operation.response, repeated: true };
          throw new AppError(operation.status === "unknown" ? "WRITE_OUTCOME_UNKNOWN" : "OPERATION_IN_PROGRESS", "Ausgang der Monitoroperation ist unklar", operation.status === "unknown" ? 503 : 409);
        }
        const { response, publicResponse = response } = await callback(transaction);
        await this.ops.queueInvalidation(transaction, { operationId: opId, projection: "venue", eventId: response.monitorId || response.monitor?.monitorId || opId });
        await this.ops.completeIdempotency(transaction, { operationId: opId, command, status: "success", response });
        return { ...publicResponse, repeated: false };
      }, { isolation: "serializable", retries: 2 });
    } catch (error) { throw this.mapError(error); }
  }

  async provision(principal, rawParams) {
    const params = requireObject(rawParams), opId = operationId(params.operationId);
    const label = stringValue(params.label, "label", { max: 100 });
    const monitorId = crypto.randomUUID();
    const result = await this.execute(principal, opId, "monitor.provision", { label }, async (transaction) => {
      const monitor = await this.venue.provisionMonitorOn(transaction, label, monitorId);
      const { token, ...safe } = monitor;
      return { response: { success: true, monitor: safe }, publicResponse: { success: true, monitor } };
    });
    if (result.repeated) return { ...result, tokenUnavailable: true };
    this.monitors.set(result.monitor.monitorId, { ...result.monitor, revision: "1", targetPath: "/index.html", targetCommandId: null, targetIssuedAt: null, revokedAt: null });
    this.publishMonitorList();
    return result;
  }

  async rotate(principal, rawParams) {
    const params = requireObject(rawParams), monitorId = idValue(params.monitorId, "monitorId"), opId = operationId(params.operationId);
    const result = await this.execute(principal, opId, "monitor.rotate", { monitorId }, async (transaction) => {
      const monitor = await this.venue.rotateMonitorTokenOn(transaction, monitorId);
      const { token, ...safe } = monitor;
      return { response: { success: true, monitor: safe }, publicResponse: { success: true, monitor } };
    });
    if (result.repeated) return { ...result, tokenUnavailable: true };
    this.disconnect(monitorId, 4003, "Geraetetoken rotiert");
    const current = this.monitors.get(monitorId);
    this.monitors.set(monitorId, { ...current, updatedAt: result.monitor.updatedAt, revokedAt: null });
    this.publishMonitorList();
    return result;
  }

  async revoke(principal, rawParams) {
    const params = requireObject(rawParams), monitorId = idValue(params.monitorId, "monitorId"), opId = operationId(params.operationId);
    const result = await this.execute(principal, opId, "monitor.revoke", { monitorId }, async (transaction) => {
      const monitor = await this.venue.revokeMonitorOn(transaction, monitorId);
      return { response: { success: true, monitor } };
    });
    if (!result.repeated) {
      this.disconnect(monitorId, 4003, "Geraet widerrufen");
      this.monitors.set(monitorId, { ...this.monitors.get(monitorId), ...result.monitor });
      this.publishMonitorList();
    }
    return result;
  }

  register(info) {
    const monitorId = info.principal.id;
    this.disconnect(monitorId, 4009, "Neue Monitorverbindung");
    const connection = { info, streamId: crypto.randomUUID(), nextSequence: 1, scrollQueue: [], scrollInFlight: null, appliedScrollIds: new Map(), navigationTimer: null, scrollTimer: null };
    this.connections.set(monitorId, connection);
    this.publishStatus(monitorId, { kind: "presence", status: "online" });
    this.publishMonitorList();
    const target = this.target(monitorId);
    if (target.commandId) this.sendNavigation(connection, target, true);
  }

  unregister(info) {
    const id = info.principal?.type === "device" ? info.principal.id : null, connection = id ? this.connections.get(id) : null;
    if (!connection || connection.info !== info) return;
    this.failPending(connection);
    this.connections.delete(id);
    this.publishStatus(id, { kind: "presence", status: "offline" });
    this.publishMonitorList();
  }

  disconnect(monitorId, code, reason) {
    const connection = this.connections.get(monitorId);
    if (!connection) return;
    this.failPending(connection); this.connections.delete(monitorId);
    this.publishStatus(monitorId, { kind: "presence", status: "offline" });
    this.close?.(connection.info, code, reason);
  }

  failPending(connection) {
    if (connection.navigationTimer) clearTimeout(connection.navigationTimer);
    if (connection.scrollTimer) clearTimeout(connection.scrollTimer);
    for (const command of [...connection.scrollQueue, ...(connection.scrollInFlight ? [connection.scrollInFlight] : [])]) {
      this.publishStatus(command.monitorId, { kind: "scroll", commandId: command.commandId, status: "failed", errorCode: "MONITOR_OFFLINE" });
      this.venue.updateMonitorCommand(command.monitorId, command.commandId, "failed", "MONITOR_OFFLINE").catch(() => {});
    }
    connection.scrollQueue.length = 0; connection.scrollInFlight = null;
  }

  sendNavigation(connection, target, resync) {
    const sent = this.send?.(connection.info, { type: "event", topic: "monitor-command", data: { kind: "navigate", ...target, targetRevision: target.revision, loadDeadlineMs: 20000, resync } }) === true;
    if (!sent) return false;
    this.venue.updateMonitorCommand(target.monitorId, target.commandId, "sent").catch(() => {});
    connection.navigationTimer = setTimeout(() => {
      if (this.target(target.monitorId).commandId !== target.commandId) return;
      this.publishStatus(target.monitorId, { kind: "navigate", commandId: target.commandId, status: "failed", path: target.path, errorCode: "ACK_TIMEOUT" });
      this.venue.updateMonitorCommand(target.monitorId, target.commandId, "failed", "ACK_TIMEOUT").catch(() => {});
    }, 20000);
    connection.navigationTimer.unref?.();
    return true;
  }

  async navigate(principal, rawParams) {
    const params = requireObject(rawParams), monitorId = idValue(params.monitorId, "monitorId"), opId = operationId(params.operationId);
    const path = canonicalizeMonitorPath(params.path, this.dataStore), commandId = crypto.randomUUID();
    const result = await this.execute(principal, opId, "monitor.navigate", { monitorId, path }, async (transaction) => {
      const target = await this.venue.createNavigationCommand(transaction, { monitorId, commandId, operationId: opId, path });
      return { response: { success: true, ...target } };
    });
    if (result.repeated) return { ...result, delivery: "known" };
    const monitor = this.monitors.get(monitorId);
    this.monitors.set(monitorId, { ...monitor, revision: result.revision, targetPath: result.path, targetCommandId: result.commandId, targetIssuedAt: result.issuedAt });
    const delivered = this.connections.has(monitorId) ? this.sendNavigation(this.connections.get(monitorId), this.target(monitorId), false) : false;
    const delivery = delivered ? "sent" : "offline";
    this.publishStatus(monitorId, { kind: "navigate", commandId: result.commandId, status: delivery, path });
    this.publishMonitorList();
    return { ...result, delivery };
  }

  async scroll(principal, rawParams) {
    const params = requireObject(rawParams), monitorId = idValue(params.monitorId, "monitorId"), opId = operationId(params.operationId);
    const direction = stringValue(params.direction, "direction", { max: 4 });
    if (!new Set(["up", "down"]).has(direction)) throw new AppError("VALIDATION_ERROR", "direction muss up oder down sein");
    const connection = this.connections.get(monitorId);
    if (!connection) throw new AppError("MONITOR_OFFLINE", "Monitor ist offline", 409);
    const commandId = crypto.randomUUID(), seq = connection.nextSequence++, expiresAt = Date.now() + 30000;
    const result = await this.execute(principal, opId, "monitor.scroll", { monitorId, direction }, async (transaction) => {
      const stored = await this.venue.createScrollCommand(transaction, { monitorId, commandId, operationId: opId, streamId: connection.streamId, sequence: seq, deltaY: direction === "up" ? -300 : 300, expiresAt });
      return { response: { success: true, commandId: stored.commandId, seq: stored.sequence, expiresAt: stored.expiresAt } };
    });
    if (result.repeated) return { ...result, delivery: "known" };
    const command = { kind: "scroll", monitorId, commandId: result.commandId, streamId: connection.streamId, seq: result.seq, deltaY: direction === "up" ? -300 : 300, expiresAt: result.expiresAt };
    connection.scrollQueue.push(command); this.sendNextScroll(connection);
    return result;
  }

  sendNextScroll(connection) {
    if (connection.scrollInFlight) return;
    const command = connection.scrollQueue.shift(); if (!command) return;
    connection.scrollInFlight = command;
    if (this.send?.(connection.info, { type: "event", topic: "monitor-command", data: command }) !== true) {
      connection.scrollInFlight = null; this.disconnect(command.monitorId, 1011, "Monitortransport fehlgeschlagen"); return;
    }
    this.venue.updateMonitorCommand(command.monitorId, command.commandId, "sent").catch(() => {});
    connection.scrollTimer = setTimeout(() => {
      connection.scrollInFlight = null;
      connection.appliedScrollIds.set(command.commandId, { status: "failed", errorCode: "ACK_TIMEOUT" });
      this.venue.updateMonitorCommand(command.monitorId, command.commandId, "failed", "ACK_TIMEOUT").catch(() => {});
      this.sendNextScroll(connection);
    }, Math.max(1, command.expiresAt - Date.now()));
    connection.scrollTimer.unref?.();
  }

  async acknowledge(principal, rawParams) {
    const params = requireObject(rawParams), monitorId = principal.id, commandId = idValue(params.commandId, "commandId");
    const connection = this.connections.get(monitorId);
    if (!connection) throw new AppError("MONITOR_OFFLINE", "Monitorverbindung ist nicht aktiv", 409);
    if (params.kind === "scroll") {
      const command = connection.scrollInFlight;
      if (!command || command.commandId !== commandId) {
        if (connection.appliedScrollIds.has(commandId)) return { success: true, duplicate: true };
        throw new AppError("STALE_COMMAND", "Scrollkommando ist nicht mehr aktuell", 409);
      }
      if (!new Set(["applied", "failed"]).has(params.status)) throw new AppError("ACK_INVALID", "Scrollstatus ist ungueltig");
      if (connection.scrollTimer) clearTimeout(connection.scrollTimer);
      const errorCode = params.status === "failed" ? stringValue(params.errorCode || "SCROLL_FAILED", "errorCode", { max: 64, pattern: /^[A-Z0-9_]+$/ }) : null;
      await this.venue.updateMonitorCommand(monitorId, commandId, params.status, errorCode);
      connection.appliedScrollIds.set(commandId, { status: params.status, errorCode }); connection.scrollInFlight = null;
      this.sendNextScroll(connection); return { success: true };
    }
    if (params.kind !== "navigate" || !new Set(["received", "loading", "loaded", "failed"]).has(params.status)) throw new AppError("ACK_INVALID", "Navigationsstatus ist ungueltig");
    const target = this.target(monitorId);
    if (target.commandId !== commandId) throw new AppError("STALE_COMMAND", "Navigationskommando ist nicht mehr aktuell", 409);
    const errorCode = params.status === "failed" ? stringValue(params.errorCode || "LOAD_FAILED", "errorCode", { max: 64, pattern: /^[A-Z0-9_]+$/ }) : null;
    await this.venue.updateMonitorCommand(monitorId, commandId, params.status, errorCode);
    if (new Set(["loaded", "failed"]).has(params.status) && connection.navigationTimer) clearTimeout(connection.navigationTimer);
    this.publishStatus(monitorId, { kind: "navigate", commandId, status: params.status, path: target.path, errorCode });
    return { success: true };
  }

  status() { return { online: [...this.connections.keys()], commandStatus: Object.fromEntries(this.commandStatus) }; }
  shutdown() { for (const id of [...this.connections.keys()]) this.disconnect(id, 1012, "Service restart"); }
}

module.exports = { PostgresMonitorBroker };
