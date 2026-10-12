"use strict";

const AUDIT_CONTRACTS = Object.freeze({
  "competition.entry.add": Object.freeze({
    before: Object.freeze({ competitionId: "id", personId: "id" }),
    after: Object.freeze({ competitionId: "id", personId: "id", entryId: "id", alreadyPresent: "boolean" }),
  }),
  "competition.entry.remove": Object.freeze({
    before: Object.freeze({ competitionId: "id", personId: "id" }),
    after: Object.freeze({ competitionId: "id", personId: "id", entryId: "id", removed: "boolean" }),
  }),
});

const IDEMPOTENCY_CONTRACTS = Object.freeze({
  "competition.entry.add": Object.freeze({ success: "boolean", entryId: "id", alreadyPresent: "boolean" }),
  "competition.entry.remove": Object.freeze({ success: "boolean", entryId: "id", removed: "boolean" }),
  "preference.favorites.set": Object.freeze({ success: "boolean", favorites: "preference_targets", revision: "revision" }),
  "preference.start_page.set": Object.freeze({ success: "boolean", target: "preference_target", revision: "revision" }),
  "messaging.comment.add": Object.freeze({ success: "boolean", changed: "boolean", commentId: "id", eventId: "id", competitionId: "id" }),
  "messaging.comment.edit": Object.freeze({ success: "boolean", changed: "boolean", commentId: "id", eventId: "id", competitionId: "id" }),
  "messaging.comment.delete": Object.freeze({ success: "boolean", changed: "boolean", commentId: "id", eventId: "id", competitionId: "id" }),
  "messaging.comment.moderate": Object.freeze({ success: "boolean", changed: "boolean", commentId: "id", eventId: "id", competitionId: "id", status: "status" }),
  "messaging.reaction.set": Object.freeze({ success: "boolean", changed: "boolean", eventId: "id", competitionId: "id", myReaction: "status" }),
  "messaging.comment_reaction.set": Object.freeze({ success: "boolean", changed: "boolean", commentId: "id", eventId: "id", competitionId: "id", myReaction: "status" }),
  "messaging.acknowledge": Object.freeze({ success: "boolean", messageId: "id", acknowledgedAt: "epoch_ms", changed: "boolean" }),
  "messaging.acknowledge_all": Object.freeze({ success: "boolean", changed: "boolean", changedCount: "count", unreadCount: "count", messageCount: "count", revision: "revision" }),
  "monitor.provision": Object.freeze({ success: "boolean", monitor: "monitor" }),
  "monitor.rotate": Object.freeze({ success: "boolean", monitor: "monitor" }),
  "monitor.revoke": Object.freeze({ success: "boolean", monitor: "monitor" }),
  "monitor.navigate": Object.freeze({ success: "boolean", commandId: "id", monitorId: "id", path: "controlled", revision: "revision", issuedAt: "epoch_ms" }),
  "monitor.scroll": Object.freeze({ success: "boolean", commandId: "id", seq: "count", expiresAt: "epoch_ms" }),
});

const MESSAGE_EVENT_CONTRACTS = Object.freeze({
  "competition.entry.created": Object.freeze({
    templateKey: "competition.entry.created",
    templateVersion: 1,
    parameters: Object.freeze({ competitionId: "id", personId: "id" }),
  }),
  "competition.entry.withdrawn": Object.freeze({
    templateKey: "competition.entry.withdrawn",
    templateVersion: 1,
    parameters: Object.freeze({ competitionId: "id", personId: "id" }),
  }),
});

const LEGACY_AUDIT_ACTIONS = Object.freeze([
  "login", "logout", "passwordChange", "passwordSetup", "adminPasswordSetup", "adminPasswordSet",
  "frontendLoggingSettings", "frontendLoggingTargetSet", "frontendLoggingTargetRemove", "monitorEnroll", "monitorLogout",
  "courtAutomaticActivation", "courtAutomaticDeactivation",
  "addMatch", "setMatchAppointment", "clearMatchAppointment", "adminSetMatchAppointment", "adminClearMatchAppointment",
  "adminDeleteRankingChallenge", "adminSetRankingChallengeDate", "setMatchResult", "adminCorrectRankingResult",
  "adminSetMatchEnd", "adminClearMatchResult", "acknowledgeMessage", "acknowledgeAllMessages",
  "addCompetitionHistoryComment", "editCompetitionHistoryComment", "deleteCompetitionHistoryComment",
  "moderateCompetitionHistoryComment", "setCompetitionHistoryReaction", "setCompetitionHistoryCommentReaction",
  "addEntryList", "removeEntryList", "withdrawFromRanking", "courtAssign", "courtSetActive", "monitorNavigate",
  "monitorScroll", "monitorProvision", "monitorRotate", "monitorRevoke", "normalizePerson", "reconcilePerson",
  "refreshSheetData", "adminSaveHallTimeGrid", "setHallTimeBooking", "setMyHallTimeGroupMembership",
  "adminDistributeHallTimeGrid", "adminApplyHallTimeDistribution", "adminSaveHallTimeConstraints",
  "adminClearAllHallTimeStatuses",
]);

const LEGACY_AUDIT_FIELDS = Object.freeze([
  "acknowledged", "acknowledgedCount", "active", "aktiv", "allowed", "alreadyPresent", "avoidCount",
  "bewerbId", "changed", "changedFieldCount", "changedTableCount", "challengeDate", "commandId", "commentId",
  "competitionId", "credentialChanged", "deleted", "deletedEntryCount", "delivery", "direction", "entryId",
  "eventId", "existed", "expectedRevision", "fieldCount", "gridId", "identifierValid", "matchDate", "matchId",
  "mode", "monitorId", "opponentId", "path", "personId", "rank", "reactionKey", "reasonRecorded", "recordId",
  "recovered", "refreshedAt", "removed", "repeated", "replacedFutureEntries", "revision", "scope", "selected",
  "sequence", "sessionsRevoked", "status", "tableCount", "textRecorded", "unavailableCount", "unreadCount",
  "address", "admin", "batchSize", "birthDate", "city", "country", "defaultTargetDurationMinutes",
  "defaultTargetLevel", "email", "enabled", "externalId", "firstName", "flushIntervalMs", "gender",
  "includeAnonymous", "lastName", "level", "login", "maxTargetDurationMinutes", "member", "normalRetentionDays",
  "operator", "phone", "postalCode", "role", "sampleRatePercent", "targetedRetentionDays",
  "completionType", "createdAt", "createdBy", "expiresAt", "koTargetMatchId", "koTargetStatus", "label",
  "shiftedCount", "source", "withdrawnAt",
  "court", "reason", "scheduledAt",
]);

function auditActionCode(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

const LEGACY_AUDIT_CONTRACTS = Object.freeze(Object.fromEntries(LEGACY_AUDIT_ACTIONS.map((action) => [
  auditActionCode(action),
  Object.freeze({
    before: Object.freeze(Object.fromEntries(LEGACY_AUDIT_FIELDS.map((field) => [field, "controlled"]))),
    after: Object.freeze(Object.fromEntries(LEGACY_AUDIT_FIELDS.map((field) => [field, "controlled"]))),
  }),
])));

module.exports = { AUDIT_CONTRACTS, IDEMPOTENCY_CONTRACTS, LEGACY_AUDIT_CONTRACTS, MESSAGE_EVENT_CONTRACTS, auditActionCode };
