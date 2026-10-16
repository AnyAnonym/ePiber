"use strict";

const crypto = require("crypto");
const { AppError } = require("./errors.js");

function requestHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest();
}

class PostgresCompetitionService {
  constructor({ play, messaging, ops }) {
    this.play = play;
    this.messaging = messaging;
    this.ops = ops;
  }

  repeatedResult(operation) {
    if (!operation.repeated) return null;
    if (operation.status === "success" && operation.response) return { ...operation.response, repeated: true };
    if (operation.status === "unknown") throw new AppError("WRITE_OUTCOME_UNKNOWN", "Ausgang der frueheren Operation ist unklar", 503);
    if (operation.status === "started") throw new AppError("OPERATION_IN_PROGRESS", "Operation wird bereits verarbeitet", 409);
    throw new AppError("OPERATION_ALREADY_FAILED", "Operation wurde bereits abgelehnt", 409);
  }

  async addEntry(principal, { operationId, bewerbId }) {
    const command = "competition.entry.add";
    const payload = { competitionId: String(bewerbId), personId: String(principal.id) };
    const operation = await this.ops.beginIdempotency({
      operationId,
      actorPersonId: principal.id,
      command,
      requestHash: requestHash(payload),
    });
    const repeated = this.repeatedResult(operation);
    if (repeated) return repeated;
    try {
      const result = await this.ops.executeAudited({
        audit: {
          operationId,
          actorType: "user",
          actorPersonId: principal.id,
          actorName: principal.name || null,
          role: principal.role || null,
          action: command,
          subjectType: "competition",
          subjectId: payload.competitionId,
          before: { competitionId: payload.competitionId, personId: payload.personId },
        },
        transactionOperation: command,
        isolation: "serializable",
        retries: 2,
      }, async (transaction) => {
        const entry = await this.play.addCompetitionEntry(transaction, {
          competitionId: payload.competitionId,
          personId: payload.personId,
          operationId,
        });
        if (!entry.alreadyPresent) {
          const eventId = `event-${crypto.createHash("sha256").update(operationId).digest("hex").slice(0, 32)}`;
          await this.messaging.createEvent({
            contractId: eventId,
            eventType: "competition.entry.created",
            operationId,
            templateParameters: { competitionId: payload.competitionId, personId: payload.personId },
            competitionId: payload.competitionId,
            participants: [{ personId: payload.personId, role: "entrant" }],
            recipients: [payload.personId],
            readPersonIds: [payload.personId],
            sourceType: "entry_list",
            sourceId: entry.id,
            actorPersonId: principal.id,
            actorName: principal.name || null,
            summary: `${principal.name || principal.id} hat sich zum Bewerb angemeldet.`,
          }, transaction);
        }
        const response = { success: true, entryId: entry.id, alreadyPresent: entry.alreadyPresent };
        await this.ops.queueInvalidation(transaction, { operationId, projection: "play", eventId: payload.competitionId });
        await this.ops.completeIdempotency(transaction, { operationId, command, status: "success", response });
        return {
          ...response,
          repeated: false,
          auditAfter: { competitionId: payload.competitionId, personId: payload.personId, entryId: entry.id, alreadyPresent: entry.alreadyPresent },
        };
      });
      const { auditAfter, ...publicResult } = result;
      return publicResult;
    } catch (error) {
      const status = error.code === "DB_COMMIT_OUTCOME_UNKNOWN" || error.code === "WRITE_OUTCOME_UNKNOWN" ? "unknown" : "failed";
      try {
        await this.ops.finalizeIdempotency({ operationId, command, status });
      } catch (finalizeError) {
        if (finalizeError.code !== "IDEMPOTENCY_OPERATION_NOT_OPEN") throw finalizeError;
      }
      throw error;
    }
  }

  async removeEntry(principal, { operationId, bewerbId }) {
    const command = "competition.entry.remove";
    const payload = { competitionId: String(bewerbId), personId: String(principal.id) };
    const operation = await this.ops.beginIdempotency({ operationId, actorPersonId: principal.id, command, requestHash: requestHash(payload) });
    const repeated = this.repeatedResult(operation);
    if (repeated) return repeated;
    try {
      const result = await this.ops.executeAudited({
        audit: {
          operationId,
          actorType: "user",
          actorPersonId: principal.id,
          actorName: principal.name || null,
          role: principal.role || null,
          action: command,
          subjectType: "competition",
          subjectId: payload.competitionId,
          before: { competitionId: payload.competitionId, personId: payload.personId },
        },
        transactionOperation: command,
        isolation: "serializable",
        retries: 2,
      }, async (transaction) => {
        const entry = await this.play.withdrawCompetitionEntry(transaction, {
          competitionId: payload.competitionId,
          personId: payload.personId,
        });
        if (entry) {
          const eventId = `event-${crypto.createHash("sha256").update(operationId).digest("hex").slice(0, 32)}`;
          await this.messaging.createEvent({
            contractId: eventId,
            eventType: "competition.entry.withdrawn",
            operationId,
            templateParameters: { competitionId: payload.competitionId, personId: payload.personId },
            competitionId: payload.competitionId,
            participants: [{ personId: payload.personId, role: "entrant" }],
            recipients: [payload.personId],
            readPersonIds: [payload.personId],
            sourceType: "entry_list",
            sourceId: entry.id,
            actorPersonId: principal.id,
            actorName: principal.name || null,
            summary: `${principal.name || principal.id} hat die Anmeldung zum Bewerb zurueckgezogen.`,
          }, transaction);
        }
        const response = { success: true, removed: Boolean(entry), entryId: entry?.id || "none" };
        await this.ops.queueInvalidation(transaction, { operationId, projection: "play", eventId: payload.competitionId });
        await this.ops.completeIdempotency(transaction, { operationId, command, status: "success", response });
        return {
          ...response,
          repeated: false,
          auditAfter: { competitionId: payload.competitionId, personId: payload.personId, entryId: response.entryId, removed: response.removed },
        };
      });
      const { auditAfter, ...publicResult } = result;
      return publicResult;
    } catch (error) {
      const status = error.code === "DB_COMMIT_OUTCOME_UNKNOWN" || error.code === "WRITE_OUTCOME_UNKNOWN" ? "unknown" : "failed";
      try {
        await this.ops.finalizeIdempotency({ operationId, command, status });
      } catch (finalizeError) {
        if (finalizeError.code !== "IDEMPOTENCY_OPERATION_NOT_OPEN") throw finalizeError;
      }
      throw error;
    }
  }
}

module.exports = { PostgresCompetitionService, requestHash };
