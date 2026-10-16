"use strict";

const crypto = require("crypto");
const { AppError } = require("./errors.js");
const { requestHash } = require("./postgresCompetitionService.js");

function timestamp(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.getTime() : Number(value);
}

function projectCourt(row) {
  const scheduledAt = timestamp(row.scheduledAt);
  const homeNames = row.homePlayerNames || [];
  const guestNames = row.guestPlayerNames || [];
  return {
    matchId: row.matchId || "",
    bewerbId: row.competitionId || "",
    matchtypId: row.matchFormatId || "",
    displayRules: row.displayRules || null,
    bewerb: row.competitionName || "",
    homePlayerIds: row.homePlayerIds || [],
    guestPlayerIds: row.guestPlayerIds || [],
    homePlayer: homeNames.join(" / "),
    guestPlayer: guestNames.join(" / "),
    dateTime: scheduledAt ? new Date(scheduledAt).toISOString() : "",
    runde: row.roundCode || "",
    aktiv: row.active ? 1 : 0,
    automaticActivation: row.matchId ? {
      matchId: row.matchId,
      matchDate: scheduledAt ? new Date(scheduledAt).toISOString() : "",
      status: row.automationStatus || (scheduledAt ? "pending" : "unscheduled"),
    } : null,
    revision: Number(row.revision),
    updatedAt: timestamp(row.updatedAt),
  };
}

class PostgresCourtService {
  constructor({ venue, ops, publish = () => {}, log = () => {} }) {
    this.venue = venue;
    this.ops = ops;
    this.publish = publish;
    this.log = log;
    this.cache = new Map();
    this.listeners = new Set();
    this.persistent = true;
  }

  async refresh(reason = "read") {
    const rows = await this.venue.courts();
    this.cache = new Map(rows.map((row) => [row.id, projectCourt(row)]));
    this.log("debug", "postgres_court_state_refreshed", { reason, courtCount: this.cache.size });
    return this.getScoreboardCourtsCached();
  }

  getScoreboardCourtsCached() {
    return Object.fromEntries(["1", "2"].map((id) => [id, structuredClone(this.cache.get(id) || {
      matchId: "", bewerbId: "", matchtypId: "", displayRules: null, bewerb: "", homePlayerIds: [], guestPlayerIds: [],
      homePlayer: "", guestPlayer: "", dateTime: "", runde: "", aktiv: 0, automaticActivation: null, revision: 0, updatedAt: null,
    })]));
  }

  async getScoreboardCourts() { if (!this.cache.size) await this.refresh("initial-read"); return this.getScoreboardCourtsCached(); }
  getCourtCached(courtId) { return this.getScoreboardCourtsCached()[String(courtId)] || null; }
  async getCourt(courtId) { return (await this.getScoreboardCourts())[courtId]; }
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  emit(courtId) {
    const courts = this.getScoreboardCourtsCached();
    const event = { type: "court", court: courtId, value: courts[courtId] };
    for (const listener of this.listeners) { try { listener(event); } catch {} }
    this.publish("scoreboard-state", { courts });
  }

  mapError(error) {
    if (error.code === "REVISION_CONFLICT") return new AppError("REVISION_CONFLICT", "Court wurde zwischenzeitlich geaendert", 409);
    if (error.code === "COURT_NOT_FOUND") return new AppError("COURT_NOT_FOUND", "Court wurde nicht gefunden", 404);
    if (error.code === "MATCH_NOT_FOUND") return new AppError("MATCH_NOT_FOUND", "Match wurde nicht gefunden", 404);
    if (error.code === "PERSON_NOT_FOUND") return new AppError("PERSON_NOT_FOUND", "Person wurde nicht gefunden", 404);
    if (error.code === "IDEMPOTENCY_CONFLICT") return new AppError("IDEMPOTENCY_CONFLICT", "Operation-ID wurde mit anderen Daten verwendet", 409);
    return error;
  }

  async execute(principal, operationId, command, payload, write) {
    try {
      const response = await this.venue.database.withTransaction(command, async (transaction) => {
        const operation = await this.ops.beginIdempotencyOn(transaction, {
          operationId, actorPersonId: principal.id, command, requestHash: requestHash(payload),
        });
        if (operation.repeated) {
          if (operation.status === "success") return { ...operation.response, repeated: true };
          throw new AppError(operation.status === "unknown" ? "WRITE_OUTCOME_UNKNOWN" : "OPERATION_IN_PROGRESS", "Ausgang der Court-Operation ist unklar", operation.status === "unknown" ? 503 : 409);
        }
        const result = await write(transaction);
        const projected = { success: true, courtId: payload.court, revision: result.revision, active: result.active };
        await this.ops.queueInvalidation(transaction, { operationId, projection: "venue", eventId: `court-${payload.court}` });
        await this.ops.completeIdempotency(transaction, { operationId, command, status: "success", response: projected });
        return projected;
      }, { isolation: "serializable", retries: 2 });
      await this.refresh(command);
      this.emit(payload.court);
      return { success: true, court: structuredClone(this.cache.get(payload.court)), ...(response.repeated ? { repeated: true } : {}) };
    } catch (error) { throw this.mapError(error); }
  }

  assign(principal, params) {
    const assignment = params.empty ? null : params.matchId ? { matchId: params.matchId } : {
      homePlayerIds: params.homePlayerIds, guestPlayerIds: params.guestPlayerIds,
    };
    const payload = {
      court: params.court, empty: Boolean(params.empty), matchId: params.matchId || "none",
      homePlayerIds: params.homePlayerIds || [], guestPlayerIds: params.guestPlayerIds || [], expectedRevision: params.expectedRevision,
    };
    return this.execute(principal, params.operationId, "court.assign", payload, (transaction) => this.venue.replaceCourtAssignment(transaction, {
      courtId: params.court, expectedRevision: params.expectedRevision, actorPersonId: principal.id, assignment,
    }));
  }

  setActive(principal, params) {
    const payload = { court: params.court, active: params.active, expectedRevision: params.expectedRevision };
    return this.execute(principal, params.operationId, "court.active.set", payload, (transaction) => this.venue.setCourtActive(transaction, {
      courtId: params.court, expectedRevision: params.expectedRevision, actorPersonId: principal.id, active: params.active,
    }));
  }

  async updateAutomation(courtId, expectedRevision, { active = null, status, operationId = crypto.randomUUID() }) {
    const result = await this.venue.database.withTransaction("court.automation", async (transaction) => {
      const value = await this.venue.updateCourtAutomation(transaction, { courtId, expectedRevision, active, automationStatus: status });
      await this.ops.queueInvalidation(transaction, { operationId, projection: "venue", eventId: `court-${courtId}` });
      return value;
    }, { isolation: "serializable", retries: 2 });
    await this.refresh("automation"); this.emit(courtId); return result;
  }

  setScoreboardCourt(courtId, data, expectedRevision) {
    return this.updateAutomation(courtId, expectedRevision, {
      active: data.aktiv === undefined ? null : Boolean(data.aktiv),
      status: data.automaticActivation?.status || null,
    });
  }

  status() { return { ready: this.cache.size > 0, courts: this.getScoreboardCourtsCached(), backend: "postgres" }; }
}

class PostgresScoreService {
  constructor(venue) { this.venue = venue; }
  async append(event) {
    const [sets, points] = [event.score.split("/").slice(0, 3), event.score.split("/")[3] || "0-0"];
    const values = sets.map((value) => value.split("-"));
    while (values.length < 3) values.push(["0", "0"]);
    const pointValues = points.split("-");
    const stored = await this.venue.appendScoreEvent({ eventId: event.eventId, courtId: event.court, score: {
      sideOneSetOne: values[0][0], sideTwoSetOne: values[0][1], sideOneSetTwo: values[1][0], sideTwoSetTwo: values[1][1],
      sideOneSetThree: values[2][0], sideTwoSetThree: values[2][1], sideOnePoints: pointValues[0], sideTwoPoints: pointValues[1],
    } });
    return { ...event, sequence: Number(stored.courtSequence), occurredAt: Date.now() };
  }
  acceptBaseline({ court, score }) {
    const parts = score.split("/"); const sets = parts.slice(0, 3).map((value) => value.split("-"));
    while (sets.length < 3) sets.push(["0", "0"]); const points = (parts[3] || "0-0").split("-");
    return this.venue.acceptScoreBaseline(court, {
      sideOneSetOne: sets[0][0], sideTwoSetOne: sets[0][1], sideOneSetTwo: sets[1][0], sideTwoSetTwo: sets[1][1],
      sideOneSetThree: sets[2][0], sideTwoSetThree: sets[2][1], sideOnePoints: points[0], sideTwoPoints: points[1],
    });
  }
  getLatestByMatchIdAndCourt(matchId, court) { return this.venue.latestScoreByMatchAndCourt(matchId, court); }
  status() { return { open: true, ready: true, backend: "postgres" }; }
}

module.exports = { PostgresCourtService, PostgresScoreService, projectCourt };
