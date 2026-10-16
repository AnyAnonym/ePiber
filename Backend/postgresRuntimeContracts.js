"use strict";

const AUDIT_CONTRACTS = Object.freeze({
  "paj.password.rotate_all": Object.freeze({
    before: Object.freeze({ scope: "status" }),
    after: Object.freeze({ accountCount: "count", credentialCount: "count", sessionsRevoked: "count", authorizationsRevoked: "count", loginLimitsCleared: "count" }),
  }),
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
  "court.assign": Object.freeze({ success: "boolean", courtId: "id", revision: "revision", active: "boolean" }),
  "court.active.set": Object.freeze({ success: "boolean", courtId: "id", revision: "revision", active: "boolean" }),
  "hall_time.membership.set": Object.freeze({ success: "boolean", gridId: "id", selected: "boolean", revision: "revision" }),
  "hall_time.grid.save": Object.freeze({ success: "boolean", gridId: "id", revision: "revision" }),
  "hall_time.booking.set": Object.freeze({ success: "boolean", gridId: "id", revision: "revision" }),
  "hall_time.constraints.save": Object.freeze({ success: "boolean", gridId: "id", revision: "revision" }),
  "hall_time.distribution.apply": Object.freeze({ success: "boolean", gridId: "id", revision: "revision" }),
  "hall_time.distribution.run": Object.freeze({ success: "boolean", gridId: "id", revision: "revision" }),
  "hall_time.status.clear": Object.freeze({ success: "boolean", gridId: "id", revision: "revision", deletedEntryCount: "count" }),
  "match.add": Object.freeze({ success: "boolean", newMatchId: "id" }),
  "match.appointment.set": Object.freeze({ success: "boolean", matchId: "id", matchDate: "controlled" }),
  "match.appointment.admin_set": Object.freeze({ success: "boolean", matchId: "id", matchDate: "controlled" }),
  "match.appointment.clear": Object.freeze({ success: "boolean", matchId: "id", matchDate: "controlled" }),
  "match.appointment.admin_clear": Object.freeze({ success: "boolean", matchId: "id", matchDate: "controlled" }),
  "match.result.set": Object.freeze({ success: "boolean", matchId: "id", result: "controlled", completionType: "status" }),
  "match.result.correct": Object.freeze({ success: "boolean", matchId: "id", result: "controlled", completionType: "status" }),
  "match.end.set": Object.freeze({ success: "boolean", matchId: "id", matchEnd: "controlled" }),
  "match.result.clear": Object.freeze({ success: "boolean", matchId: "id", cleared: "boolean" }),
  "match.challenge.delete": Object.freeze({ success: "boolean", matchId: "id", deleted: "boolean" }),
  "match.challenge_date.set": Object.freeze({ success: "boolean", matchId: "id", challengeDate: "controlled" }),
  "ranking.withdraw": Object.freeze({ success: "boolean", bewerbId: "id", rank: "count", withdrawn: "boolean" }),
  "person.normalize": Object.freeze({ success: "boolean", personId: "id", changedFieldCount: "count" }),
  "person.reconcile.create": Object.freeze({ success: "boolean", action: "status", personId: "id" }),
  "person.reconcile.update": Object.freeze({ success: "boolean", action: "status", personId: "id" }),
  "person.reconcile.deactivate": Object.freeze({ success: "boolean", action: "status", personId: "id" }),
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
  "match.challenge.created": Object.freeze({ templateKey: "match.challenge.created", templateVersion: 1, parameters: Object.freeze({ matchId: "id", competitionId: "id" }) }),
  "match.appointment.set": Object.freeze({ templateKey: "match.appointment.set", templateVersion: 1, parameters: Object.freeze({ matchId: "id", competitionId: "id", scheduledAt: "timestamp" }) }),
  "match.appointment.cleared": Object.freeze({ templateKey: "match.appointment.cleared", templateVersion: 1, parameters: Object.freeze({ matchId: "id", competitionId: "id" }) }),
  "match.result.set": Object.freeze({ templateKey: "match.result.set", templateVersion: 1, parameters: Object.freeze({ matchId: "id", competitionId: "id", completionType: "status" }) }),
  "match.result.corrected": Object.freeze({ templateKey: "match.result.corrected", templateVersion: 1, parameters: Object.freeze({ matchId: "id", competitionId: "id", completionType: "status" }) }),
  "match.result.cleared": Object.freeze({ templateKey: "match.result.cleared", templateVersion: 1, parameters: Object.freeze({ matchId: "id", competitionId: "id" }) }),
  "ranking.withdrawn": Object.freeze({ templateKey: "ranking.withdrawn", templateVersion: 1, parameters: Object.freeze({ competitionId: "id", personId: "id", rank: "count" }) }),
  "hall_time.booking.changed": Object.freeze({ templateKey: "hall_time.booking.changed", templateVersion: 1, parameters: Object.freeze({ gridId: "id", slotId: "id", personId: "id", status: "status" }) }),
  "hall_time.waitlist.promoted": Object.freeze({ templateKey: "hall_time.waitlist.promoted", templateVersion: 1, parameters: Object.freeze({ gridId: "id", slotId: "id", personId: "id" }) }),
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
  "court", "reason", "scheduledAt", "automationStatus",
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
