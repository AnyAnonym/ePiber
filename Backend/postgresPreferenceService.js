"use strict";

const { AppError } = require("./errors.js");
const { requestHash } = require("./postgresCompetitionService.js");

class PostgresPreferenceService {
  constructor({ identity, ops }) {
    this.identity = identity;
    this.ops = ops;
  }

  repeatedResult(operation) {
    if (!operation.repeated) return null;
    if (operation.status === "success" && operation.response) return { ...operation.response, repeated: true };
    if (operation.status === "unknown") throw new AppError("WRITE_OUTCOME_UNKNOWN", "Ausgang der frueheren Operation ist unklar", 503);
    if (operation.status === "started") throw new AppError("OPERATION_IN_PROGRESS", "Operation wird bereits verarbeitet", 409);
    throw new AppError("OPERATION_ALREADY_FAILED", "Operation wurde bereits abgelehnt", 409);
  }

  mapError(error) {
    if (error.code === "REVISION_CONFLICT") return new AppError("REVISION_CONFLICT", "Daten wurden zwischenzeitlich geaendert", 409);
    if (error.code === "PREFERENCE_COMPETITION_NOT_FOUND" || error.code === "PREFERENCE_HALL_TIME_GRID_NOT_FOUND") {
      return new AppError("PREFERENCE_TARGET_NOT_FOUND", "Favoritenziel wurde nicht gefunden", 404);
    }
    if (error.code === "PREFERENCE_TARGET_INVALID") return new AppError("VALIDATION_ERROR", "Favoritenziel ist ungueltig", 400);
    return error;
  }

  async execute(personId, operationId, command, payload, write) {
    try {
      return await this.identity.database.withTransaction(command, async (transaction) => {
        const operation = await this.ops.beginIdempotencyOn(transaction, {
          operationId,
          actorPersonId: personId,
          command,
          requestHash: requestHash(payload),
        });
        const repeated = this.repeatedResult(operation);
        if (repeated) return repeated;
        const written = await write(transaction);
        const { updatedAt, ...response } = written;
        await this.ops.queueInvalidation(transaction, { operationId, projection: "identity", eventId: personId });
        await this.ops.completeIdempotency(transaction, { operationId, command, status: "success", response });
        return { ...response, repeated: false };
      }, { isolation: "serializable", retries: 2 });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  setUserFavorites(personId, { operationId, expectedRevision, favorites }) {
    const payload = { expectedRevision, favorites };
    return this.execute(personId, operationId, "preference.favorites.set", payload, (transaction) => (
      this.identity.replaceUserFavorites(transaction, personId, expectedRevision, favorites)
    ));
  }

  setUserStartPage(personId, { operationId, expectedRevision, target }) {
    const payload = { expectedRevision, target };
    return this.execute(personId, operationId, "preference.start_page.set", payload, (transaction) => (
      this.identity.replaceUserStartPage(transaction, personId, expectedRevision, target)
    ));
  }
}

module.exports = { PostgresPreferenceService };
