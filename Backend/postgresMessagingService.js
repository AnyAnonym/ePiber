"use strict";

const crypto = require("crypto");
const { AppError } = require("./errors.js");
const dataStore = require("./dataStore.js");
const { hasRole } = require("./personRoles.js");
const { reactionCatalog, reactionByKey } = require("./competitionHistoryReactionCatalog.js");
const { normalizeWinnerPerspective } = require("./resultPerspective.js");

const COMMENT_SEGMENTER = new Intl.Segmenter("de", { granularity: "grapheme" });
const VIENNA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });
const RESULT_REPORT_TYPES = new Set(["result", "result_corrected", "result_cleared", "match_end_corrected"]);
const CHALLENGE_REPORT_TYPES = new Set(["challenge", "challenge_confirmation"]);
const DATE_CHANGE_REPORT_TYPES = new Set(["appointment_changed", "ranking_challenge_date_changed", "ranking_match_date_admin_changed", "match_end_corrected"]);
function viennaDay(timestamp) { const parts = Object.fromEntries(VIENNA_DAY.formatToParts(new Date(timestamp)).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value])); return `${parts.year}-${parts.month}-${parts.day}`; }

function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest(); }

class PostgresMessagingService {
  constructor({ messaging, ops, publish = () => {}, log = () => {}, now = Date.now }) {
    this.repository = messaging;
    this.ops = ops;
    this.publish = publish;
    this.log = log;
    this.now = now;
  }

  mapError(error) {
    const definitions = {
      COMPETITION_HISTORY_EVENT_NOT_FOUND: ["COMPETITION_HISTORY_EVENT_NOT_FOUND", "Historieneintrag wurde nicht gefunden", 404],
      COMPETITION_HISTORY_COMMENT_NOT_FOUND: ["COMPETITION_HISTORY_COMMENT_NOT_FOUND", "Kommentar wurde nicht gefunden", 404],
      FORBIDDEN: ["FORBIDDEN", "Berechtigung fehlt", 403],
      IDEMPOTENCY_CONFLICT: ["IDEMPOTENCY_CONFLICT", "Operation-ID wurde mit anderen Daten verwendet", 409],
    };
    const definition = definitions[error.code];
    return definition ? new AppError(...definition) : error;
  }

  repeated(operation) {
    if (!operation.repeated) return null;
    if (operation.status === "success" && operation.response) return { ...operation.response, repeated: true };
    if (operation.status === "unknown") throw new AppError("WRITE_OUTCOME_UNKNOWN", "Ausgang der frueheren Operation ist unklar", 503);
    throw new AppError("OPERATION_IN_PROGRESS", "Operation wird bereits verarbeitet", 409);
  }

  async write(principal, operationId, command, payload, callback) {
    const startedAt = this.now();
    try {
      const result = await this.repository.database.withTransaction(command, async (transaction) => {
        const operation = await this.ops.beginIdempotencyOn(transaction, {
          operationId, actorPersonId: principal.id, command, requestHash: hash(payload),
        });
        const repeated = this.repeated(operation);
        if (repeated) return repeated;
        const response = await callback(transaction);
        await this.ops.completeIdempotency(transaction, { operationId, command, status: "success", response });
        return { ...response, repeated: false };
      }, { isolation: "serializable", retries: 2 });
      if (result.changed && !command.startsWith("messaging.acknowledge")) this.publish("competition-history", { revision: await this.repository.historyRevision(), eventId: result.eventId, competitionId: result.competitionId });
      this.log("info", "postgres_history_interaction_completed", { action: command, actorId: principal.id, result: "success", changed: result.changed, repeated: result.repeated, durationMs: this.now() - startedAt });
      return result;
    } catch (error) {
      this.log("warn", "postgres_history_interaction_completed", { action: command, actorId: principal.id, result: (error.status || 500) < 500 ? "rejected" : "failed", errorCode: error.code || "HISTORY_INTERACTION_FAILED", durationMs: this.now() - startedAt });
      throw this.mapError(error);
    }
  }

  normalizeComment(body) {
    if (typeof body !== "string") throw new AppError("VALIDATION_ERROR", "Kommentar muss Text sein", 400);
    const normalized = body.replace(/\r\n?/g, "\n").trim();
    if (!normalized) throw new AppError("VALIDATION_ERROR", "Kommentar darf nicht leer sein", 400);
    if ([...COMMENT_SEGMENTER.segment(normalized)].length > 1000 || Buffer.byteLength(normalized, "utf8") > 16000) throw new AppError("VALIDATION_ERROR", "Kommentar darf hoechstens 1000 Zeichen enthalten", 400);
    if (/[^\P{Cc}\n\t]/u.test(normalized)) throw new AppError("VALIDATION_ERROR", "Kommentar enthaelt ungueltige Steuerzeichen", 400);
    return normalized;
  }

  projectReaction(summary = { reactionTotal: 0, reactions: [], myReaction: null }) {
    const order = new Map(reactionCatalog.map((entry) => [entry.key, entry.order]));
    return {
      reactionTotal: summary.reactionTotal,
      reactions: summary.reactions.filter(({ key }) => reactionByKey.has(key)).sort((left, right) => order.get(left.key) - order.get(right.key)),
      myReaction: summary.myReaction,
    };
  }

  projectInteraction(summary = { commentCount: 0, reactionTotal: 0, reactions: [], myReaction: null }) {
    return { commentCount: summary.commentCount, ...this.projectReaction(summary) };
  }

  projectComment(comment, principal, interaction) {
    const admin = hasRole(principal, "admin");
    const mine = comment.authorId === principal.id;
    const hidden = comment.status === "under_review" && !admin;
    return {
      id: comment.id, eventId: comment.eventId, authorName: comment.authorName, createdAt: comment.createdAt,
      updatedAt: comment.updatedAt, status: comment.status, body: hidden ? "" : comment.body,
      placeholder: hidden ? "Kommentar wird geprüft." : "", mine, canEdit: mine, canDelete: mine || admin,
      canModerate: admin, canReact: !hidden, interaction: hidden ? this.projectReaction() : this.projectReaction(interaction),
    };
  }

  competitionName(competitionId) {
    if (!competitionId) return "Allgemeine Meldung";
    const values = dataStore.get("bewerbe"), header = values[0] || [];
    const idIndex = header.findIndex((value) => String(value).toLowerCase() === "id");
    const nameIndex = header.findIndex((value) => String(value).toLowerCase() === "bezeichnung");
    const row = values.slice(1).find((entry) => String(entry[idIndex]) === competitionId);
    return row ? String(row[nameIndex] || `Bewerb ${competitionId}`) : `Bewerb ${competitionId}`;
  }

  projectMessage(message) {
    return {
      id: message.id,
      eventId: message.eventId,
      type: message.eventType,
      createdAt: message.createdAt instanceof Date ? message.createdAt.getTime() : Number(message.createdAt),
      competitionId: message.competitionId,
      source: message.source,
      sourceId: message.sourceId,
      subject: message.legacySubject || message.summary || message.templateKey,
      body: message.legacyBody || message.detail || "",
      actorName: message.actorName || "",
      acknowledgedAt: message.acknowledgedAt ? message.acknowledgedAt.getTime() : null,
      readAt: message.readAt ? message.readAt.getTime() : null,
    };
  }

  async summary(principal) {
    const summary = await this.repository.summary(principal.id);
    if (!summary) throw new AppError("PERSON_NOT_FOUND", "Person wurde nicht gefunden", 404);
    return { success: true, ...summary };
  }

  async messages(principal, params) {
    const [page, summary] = await Promise.all([this.repository.inboxPage(principal.id, params), this.repository.summary(principal.id)]);
    return {
      success: true,
      ...summary,
      nextCursor: page.nextCursor,
      messages: page.messages.map((value) => {
        const message = this.projectMessage(value);
        return { id: message.id, createdAt: message.createdAt, competitionName: this.competitionName(message.competitionId), roundName: "", subject: message.subject, actorName: message.actorName, acknowledgedAt: message.acknowledgedAt };
      }),
    };
  }

  async message(principal, messageId) {
    const stored = await this.repository.inboxMessage(principal.id, messageId);
    if (!stored) throw new AppError("MESSAGE_NOT_FOUND", "Nachricht wurde nicht gefunden", 404);
    const message = this.projectMessage(stored);
    return { success: true, message: { ...message, competitionName: this.competitionName(message.competitionId) } };
  }

  async acknowledge(principal, { operationId, messageId }) {
    const result = await this.write(principal, operationId, "messaging.acknowledge", { messageId }, async (transaction) => {
      const acknowledgment = await this.repository.acknowledgeOn(transaction, principal.id, messageId);
      if (acknowledgment.changed) await this.repository.queueInvalidation(transaction, operationId, `inbox-${principal.id}`);
      return { success: true, messageId, acknowledgedAt: acknowledgment.acknowledgedAt, changed: acknowledgment.changed };
    });
    if (result.changed) await this.publishSummary(principal.id);
    return result;
  }

  async acknowledgeAll(principal, { operationId }) {
    const result = await this.write(principal, operationId, "messaging.acknowledge_all", {}, async (transaction) => {
      const acknowledgment = await this.repository.acknowledgeAllOn(transaction, principal.id);
      if (acknowledgment.changed) await this.repository.queueInvalidation(transaction, operationId, `inbox-${principal.id}`);
      return { success: true, ...acknowledgment };
    });
    if (result.changed) await this.publishSummary(principal.id);
    return result;
  }

  async publishSummary(personId) {
    try {
      const summary = await this.repository.summary(personId);
      this.publish(`messages:${personId}`, { revision: summary.revision, unreadCount: summary.unreadCount });
    } catch (error) {
      this.log("warn", "message_summary_publish_failed", { recipientId: personId, errorCode: error.code || "PUBLISH_FAILED" });
    }
  }

  createDomainEvent(values, transaction) { return this.repository.createEvent(values, transaction); }

  async competitionHistory(principal, { bewerbId, cursor = null, limit = 50 }) {
    const values = dataStore.get("bewerbe");
    const header = values[0] || [];
    const index = (name) => header.findIndex((value) => String(value).toLowerCase() === name);
    const idIndex = index("id"), nameIndex = index("bezeichnung"), typeIndex = index("bewerbsartid");
    const competitions = new Map(values.slice(1).map((row) => [String(row[idIndex]), String(row[nameIndex])]));
    if (bewerbId && !competitions.has(bewerbId)) throw new AppError("COMPETITION_NOT_FOUND", "Bewerb wurde nicht gefunden", 404);
    const rankingIds = new Set(values.slice(1).filter((row) => String(row[typeIndex]) === "2").map((row) => String(row[idIndex])));
    const page = await this.repository.competitionHistory(bewerbId || null, { cursor, limit });
    const interactions = await this.repository.interactionSummaries(page.events.map(({ id }) => id), principal.id);
    return {
      success: true,
      competition: bewerbId ? { id: bewerbId, name: competitions.get(bewerbId) } : { id: "", name: "Alle Bewerbe" },
      reactionCatalog: reactionCatalog.map(({ key, emoji, label, order, active }) => ({ key, emoji, label, order, active })),
      revision: await this.repository.historyRevision(),
      entries: page.events.map((event) => ({
        id: event.id, competitionId: event.competitionId, competitionName: competitions.get(event.competitionId) || `Bewerb ${event.competitionId}`,
        roundName: event.source === "match" && !rankingIds.has(event.competitionId) ? "" : "", type: event.type,
        occurredAt: event.createdAt, summary: event.summary || "", detail: event.detail || "",
        result: ["result", "result_corrected"].includes(event.type) ? normalizeWinnerPerspective(event.result) : event.result,
        actorName: event.actorName || "", participants: event.participants.map(({ participantRole, displayName }) => ({ role: participantRole, name: displayName })),
        interaction: this.projectInteraction(interactions.get(event.id)),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async competitionHistoryComments(principal, { eventId, cursor = null, limit = 30 }) {
    const page = await this.repository.comments(eventId, { cursor, limit });
    const interactions = await this.repository.commentReactionSummaries(page.comments.map(({ id }) => id), principal.id);
    return { success: true, eventId, comments: page.comments.map((comment) => this.projectComment(comment, principal, interactions.get(comment.id))), nextCursor: page.nextCursor, revision: await this.repository.historyRevision() };
  }

  async competitionHistoryInteraction(principal, eventId) {
    const summaries = await this.repository.interactionSummaries([eventId], principal.id);
    if (!summaries.has(eventId)) throw new AppError("COMPETITION_HISTORY_EVENT_NOT_FOUND", "Historieneintrag wurde nicht gefunden", 404);
    return { success: true, eventId, interaction: this.projectInteraction(summaries.get(eventId)), revision: await this.repository.historyRevision() };
  }

  async competitionHistoryCommentForEdit(principal, commentId) {
    const comment = await this.repository.comment(this.repository.database, commentId);
    if (comment.authorId !== principal.id) throw new AppError("FORBIDDEN", "Nur der Autor darf den Kommentar bearbeiten", 403);
    return { success: true, comment: { id: comment.id, eventId: comment.eventId, body: comment.body, status: comment.status } };
  }

  async addCompetitionHistoryComment(principal, params) {
    const body = this.normalizeComment(params.body);
    const result = await this.write(principal, params.operationId, "messaging.comment.add", { eventId: params.eventId, body }, (transaction) => (
      this.repository.addComment(transaction, { operationId: params.operationId, personId: principal.id, personName: principal.name, eventId: params.eventId, body })
    ));
    const comment = await this.repository.comment(this.repository.database, result.commentId);
    return { ...result, comment: this.projectComment(comment, principal, this.projectReaction()) };
  }

  async editCompetitionHistoryComment(principal, params) {
    const body = this.normalizeComment(params.body);
    const result = await this.write(principal, params.operationId, "messaging.comment.edit", { commentId: params.commentId, body }, (transaction) => (
      this.repository.editComment(transaction, { operationId: params.operationId, personId: principal.id, commentId: params.commentId, body })
    ));
    const comment = await this.repository.comment(this.repository.database, result.commentId);
    const interactions = await this.repository.commentReactionSummaries([result.commentId], principal.id);
    return { ...result, comment: this.projectComment(comment, principal, interactions.get(result.commentId)) };
  }

  deleteCompetitionHistoryComment(principal, params) {
    return this.write(principal, params.operationId, "messaging.comment.delete", { commentId: params.commentId }, (transaction) => (
      this.repository.deleteComment(transaction, { operationId: params.operationId, personId: principal.id, admin: hasRole(principal, "admin"), commentId: params.commentId })
    ));
  }

  moderateCompetitionHistoryComment(principal, params) {
    if (!hasRole(principal, "admin")) throw new AppError("FORBIDDEN", "Berechtigung fehlt", 403);
    return this.write(principal, params.operationId, "messaging.comment.moderate", { commentId: params.commentId, status: params.status }, (transaction) => (
      this.repository.moderateComment(transaction, { operationId: params.operationId, personId: principal.id, commentId: params.commentId, status: params.status })
    ));
  }

  async setCompetitionHistoryReaction(principal, params) {
    if (params.reactionKey !== null && !reactionByKey.get(params.reactionKey)?.active) throw new AppError("COMPETITION_HISTORY_REACTION_INVALID", "Reaktion ist nicht verfügbar", 400);
    const result = await this.write(principal, params.operationId, "messaging.reaction.set", { eventId: params.eventId, reactionKey: params.reactionKey }, (transaction) => (
      this.repository.setReaction(transaction, { operationId: params.operationId, personId: principal.id, eventId: params.eventId, reactionKey: params.reactionKey })
    ));
    const summaries = await this.repository.interactionSummaries([params.eventId], principal.id);
    return { ...result, interaction: this.projectInteraction(summaries.get(params.eventId)) };
  }

  async setCompetitionHistoryCommentReaction(principal, params) {
    if (params.reactionKey !== null && !reactionByKey.get(params.reactionKey)?.active) throw new AppError("COMPETITION_HISTORY_REACTION_INVALID", "Reaktion ist nicht verfügbar", 400);
    const comment = await this.repository.comment(this.repository.database, params.commentId);
    if (comment.status === "under_review" && !hasRole(principal, "admin")) throw new AppError("COMPETITION_HISTORY_COMMENT_UNDER_REVIEW", "Kommentar wird geprüft", 403);
    const result = await this.write(principal, params.operationId, "messaging.comment_reaction.set", { commentId: params.commentId, reactionKey: params.reactionKey }, (transaction) => (
      this.repository.setReaction(transaction, { operationId: params.operationId, personId: principal.id, commentId: params.commentId, reactionKey: params.reactionKey })
    ));
    const summaries = await this.repository.commentReactionSummaries([params.commentId], principal.id);
    return { ...result, interaction: this.projectReaction(summaries.get(params.commentId)) };
  }

  async competitionHistoryReactions(principal, eventId) {
    const details = await this.repository.eventReactionDetails(eventId);
    return {
      success: true,
      eventId,
      reactions: details.reactions.filter(({ key }) => reactionByKey.has(key)).map(({ key, userId, userName, createdAt }) => ({ key, userName, createdAt, mine: userId === principal.id })),
      revision: await this.repository.historyRevision(),
    };
  }

  async competitionHistoryCommentReactions(principal, commentId) {
    const details = await this.repository.commentReactionDetails(commentId);
    if (details.comment.status === "under_review" && !hasRole(principal, "admin")) throw new AppError("COMPETITION_HISTORY_COMMENT_UNDER_REVIEW", "Kommentar wird geprüft", 403);
    return {
      success: true,
      commentId,
      reactions: details.reactions.filter(({ key }) => reactionByKey.has(key)).map(({ key, userId, userName, createdAt }) => ({ key, userName, createdAt, mine: userId === principal.id })),
      revision: await this.repository.historyRevision(),
    };
  }

  reportingPeople() {
    const values = dataStore.get("players"), header = values[0] || [];
    const index = (name) => header.findIndex((value) => String(value).toLowerCase() === name);
    const indexes = { id: index("id"), first: index("vorname"), last: index("nachname"), role: index("role") };
    return new Map(values.slice(1).flatMap((row) => {
      const id = String(row[indexes.id] || ""); if (!id) return [];
      const role = String(row[indexes.role] || "player").trim();
      return [[id, { role, recipientClass: ["player", "player A", "player B"].includes(role) ? "Spieler" : role === "admin" ? "Administratoren" : "Andere/Unbekannt", name: [row[indexes.first], row[indexes.last]].filter(Boolean).join(" ") }]];
    }));
  }

  messagingReportOptions({ deployment, hallTimes = { grids: [] }, logCompletion = false }) {
    const startedAt = this.now(), values = dataStore.get("bewerbe"), header = values[0] || [];
    if (!dataStore.getMeta("bewerbe")?.lastUpdate) {
      if (logCompletion) this.log("warn", "messaging_report_options_completed", { deployment, result: "failed", durationMs: this.now() - startedAt, errorCode: "DATA_NOT_READY" });
      throw new AppError("DATA_NOT_READY", "Meldungsbericht wartet auf aktuelle Grunddaten", 503);
    }
    const id = header.findIndex((value) => String(value).toLowerCase() === "id"), name = header.findIndex((value) => String(value).toLowerCase() === "bezeichnung");
    const options = [{ __text: "Persönliche Meldungen", __value: "personal" }, { __text: "Historie aller Bewerbe", __value: "competitions:*" },
      ...values.slice(1).filter((row) => row[id]).map((row) => ({ __text: `Historie: ${row[name] || `Bewerb ${row[id]}`}`, __value: `competition:${row[id]}` })),
      { __text: "Historie aller Hallenraster", __value: "halls:*" }, ...hallTimes.grids.map((grid) => ({ __text: `Hallenraster: ${grid.name}`, __value: `hall:${grid.id}` }))];
    if (logCompletion) this.log("info", "messaging_report_options_completed", { deployment, result: "success", durationMs: this.now() - startedAt, optionCount: options.length });
    return { success: true, deployment, generatedAt: this.now(), options };
  }

  async messagingReport({ fromMs, toMs, deployment, selection = ["personal"], hallTimes = { grids: [], entries: [] } }) {
    const startedAt = this.now(), people = this.reportingPeople();
    try {
      if (!dataStore.getMeta("players")?.lastUpdate || !dataStore.getMeta("bewerbe")?.lastUpdate) throw new AppError("DATA_NOT_READY", "Meldungsbericht wartet auf aktuelle Grunddaten", 503);
      const competitionValues = dataStore.get("bewerbe"), header = competitionValues[0] || [];
      const idIndex = header.findIndex((value) => String(value).toLowerCase() === "id"), nameIndex = header.findIndex((value) => String(value).toLowerCase() === "bezeichnung");
      const competitions = new Map(competitionValues.slice(1).map((row) => [String(row[idIndex]), String(row[nameIndex] || `Bewerb ${row[idIndex]}`)]));
      const requested = new Set(selection); if (requested.has("all")) { requested.clear(); requested.add("personal"); requested.add("competitions:*"); requested.add("halls:*"); }
      const options = new Set(this.messagingReportOptions({ deployment, hallTimes }).options.map(({ __value }) => __value));
      if (!requested.size || [...requested].some((value) => !options.has(value))) throw new AppError("REPORTING_SELECTION_INVALID", "Meldungsauswahl ist ungueltig", 400);
      const dayKeys = new Set(); for (let value = fromMs; value < toMs; value += 21600000) dayKeys.add(viennaDay(value)); dayKeys.add(viennaDay(toMs - 1));
      const days = new Map([...dayKeys].sort().map((day) => [day, { total: 0, personal: 0, competitions: 0, halls: 0, results: 0, challenges: 0, dateChanges: 0 }]));
      const roleTotals = new Map(["Spieler", "Administratoren", "Andere/Unbekannt"].map((value) => [value, { messageCount: 0, recipients: new Set() }]));
      const recipients = new Map(), entries = [], messages = [];
      if (requested.has("personal")) for (const projection of await this.repository.reportProjections(fromMs, toMs)) {
        const person = people.get(projection.recipientId) || { role: "unknown", recipientClass: "Andere/Unbekannt", name: "" };
        const category = { result: RESULT_REPORT_TYPES.has(projection.projectionType), challenge: CHALLENGE_REPORT_TYPES.has(projection.projectionType), dateChange: DATE_CHANGE_REPORT_TYPES.has(projection.projectionType) };
        const day = days.get(viennaDay(projection.createdAt)); day.total++; day.personal++; if (category.result) day.results++; if (category.challenge) day.challenges++; if (category.dateChange) day.dateChanges++;
        const total = roleTotals.get(person.recipientClass); total.messageCount++; total.recipients.add(projection.recipientId);
        const key = `${deployment}:${projection.recipientId}`, recipient = recipients.get(key) || { recipientKey: key, recipientId: projection.recipientId, recipientName: projection.recipientName || person.name || projection.recipientId, recipientRole: person.role, recipientClass: person.recipientClass, messageCount: 0, unreadCount: 0, latestAt: projection.createdAt };
        recipient.messageCount++; if (projection.acknowledgedAt === null) recipient.unreadCount++; recipient.latestAt = Math.max(recipient.latestAt, projection.createdAt); recipients.set(key, recipient);
        const message = { time: projection.createdAt, deployment, ...projection, recipientName: recipient.recipientName, recipientRole: person.role, recipientClass: person.recipientClass, competitionName: projection.competitionId ? competitions.get(projection.competitionId) || `Bewerb ${projection.competitionId}` : "Allgemeine Meldung", isResult: category.result, isChallenge: category.challenge, isDateChange: category.dateChange, deliveries: JSON.stringify(projection.deliveries) };
        messages.push(message); entries.push({ id: `personal:${message.id}`, sourceId: message.id, time: message.time, area: "Persönliche Meldung", contextName: message.competitionName, eventType: message.projectionType, subject: message.subject, body: message.body, summary: message.summary, detail: message.detail, result: message.result, actorName: message.actorName, personName: message.recipientName, participants: "", statusChange: "", acknowledgedAt: message.acknowledgedAt, deliveries: message.deliveries });
      }
      const competitionIds = new Set([...requested].filter((value) => value.startsWith("competition:")).map((value) => value.slice(12)));
      const competitionEvents = requested.has("competitions:*") || competitionIds.size ? (await this.repository.reportEvents(fromMs, toMs)).filter((event) => requested.has("competitions:*") || competitionIds.has(event.competitionId)) : [];
      for (const event of competitionEvents) { const day = days.get(viennaDay(event.createdAt)); day.total++; day.competitions++; entries.push({ id: `competition:${event.id}`, sourceId: event.id, time: event.createdAt, area: "Bewerbshistorie", contextName: competitions.get(event.competitionId) || `Bewerb ${event.competitionId}`, eventType: event.type, subject: event.summary, body: "", summary: event.summary, detail: event.detail, result: RESULT_REPORT_TYPES.has(event.type) ? normalizeWinnerPerspective(event.result) : event.result, actorName: event.actorName, personName: "", participants: event.participants.map(({ displayName }) => displayName).filter(Boolean).join(", "), statusChange: "", acknowledgedAt: null, deliveries: "" }); }
      const hallIds = new Set([...requested].filter((value) => value.startsWith("hall:")).map((value) => value.slice(5))), hallEntries = hallTimes.entries.filter((entry) => requested.has("halls:*") || hallIds.has(entry.gridId));
      for (const entry of hallEntries) { const day = days.get(viennaDay(entry.time)); day.total++; day.halls++; entries.push({ id: `hall:${entry.id}`, sourceId: entry.id, time: entry.time, area: "Hallenraster-Historie", contextName: entry.gridName, eventType: entry.action, subject: entry.summary || entry.action, body: "", summary: entry.summary || "", detail: entry.detail || "", result: "", actorName: entry.actorName, personName: entry.personName || "", participants: entry.slotTime || "", statusChange: entry.from && entry.to && entry.from !== entry.to ? `${entry.from} → ${entry.to}` : "", acknowledgedAt: null, deliveries: "" }); }
      entries.sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
      const result = { success: true, deployment, from: fromMs, to: toMs, generatedAt: this.now(), selection: [...requested], totals: { totalCount: entries.length, messageCount: messages.length, personalCount: messages.length, competitionCount: competitionEvents.length, hallCount: hallEntries.length, recipientCount: recipients.size }, series: [...days].map(([day, counts]) => ({ time: Date.parse(`${day}T12:00:00Z`), ...counts })), roleSummary: [...roleTotals].map(([recipientClass, value]) => ({ recipientClass, messageCount: value.messageCount, recipientCount: value.recipients.size })), recipients: [...recipients.values()], messages, entries };
      this.log("info", "messaging_report_completed", { deployment, result: "success", durationMs: this.now() - startedAt, totalCount: entries.length }); return result;
    } catch (error) { this.log("warn", "messaging_report_completed", { deployment, result: "failed", durationMs: this.now() - startedAt, errorCode: error.code || "MESSAGING_REPORT_FAILED" }); throw error; }
  }
}

module.exports = { PostgresMessagingService };
