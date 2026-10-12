"use strict";

const { auditActionCode } = require("./postgresRuntimeContracts.js");

const PRIVATE_PROJECTION_FIELDS = new Set([
  "address", "birthDate", "city", "country", "email", "externalId", "firstName", "gender", "lastName", "login", "phone", "postalCode",
]);

function projection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined && !(typeof entry === "number" && !Number.isFinite(entry)))
    .map(([key, entry]) => [key, PRIVATE_PROJECTION_FIELDS.has(key) ? "geaendert" : entry]));
}

class PostgresAuditAdapter {
  constructor({ ops }) {
    this.ops = ops;
    this.open = new Map();
  }

  init() {}
  close() {}
  status() { return { ready: true, open: this.open.size, backend: "postgres" }; }

  async record(entry) {
    const operationId = String(entry.eventId || entry.operationId || "");
    const action = auditActionCode(entry.action);
    if (entry.result === "started") {
      const started = await this.ops.startAudit({
        operationId,
        actorType: entry.actorType === "device" ? "monitor" : entry.actorType,
        actorPersonId: entry.actorType === "user" && /^[1-9][0-9]*$/.test(String(entry.actorId || "")) ? String(entry.actorId) : null,
        actorName: entry.actorName || null,
        role: entry.role || null,
        action,
        subjectType: entry.targetType || null,
        subjectId: entry.targetId || null,
        subjectName: entry.targetName || null,
        requestId: entry.requestId || null,
        before: projection(entry.before),
        sourceIp: entry.sourceIp || null,
        attemptedLogin: entry.attemptedLogin || null,
      });
      this.open.set(operationId, { action, started });
      return started;
    }
    const current = this.open.get(operationId);
    const status = entry.result === "success" ? "success" : entry.result === "unknown" ? "unknown" : "failed";
    await this.ops.database.withTransaction("ops.audit.adapter.finish", (transaction) => this.ops.completeAudit(transaction, {
      operationId,
      action: current?.action || action,
      status,
      after: status === "success" ? projection(entry.after) : null,
      errorCode: entry.errorCode || null,
    }));
    this.open.delete(operationId);
    return { operationId, status };
  }
}

module.exports = { PostgresAuditAdapter, projection };
