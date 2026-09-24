const crypto = require("crypto");
const { AppError } = require("./errors.js");
const {
  booleanValue,
  idValue,
  integerValue,
  operationId,
  requireObject,
  stringValue,
} = require("./validators.js");
const { validateChanges } = require("./peopleNormalization.js");
const { validateReconciliationRequest } = require("./memberReconciliation.js");

function objectShape(raw, fields) {
  const value = requireObject(raw);
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(fields, key)) throw new AppError("VALIDATION_ERROR", `Unbekanntes Feld: ${key}`);
  }
  return Object.fromEntries(Object.entries(fields).flatMap(([key, validator]) => {
    const result = validator(value[key]);
    return result === undefined ? [] : [[key, result]];
  }));
}

const optional = (validator) => (value) => value === undefined ? undefined : validator(value);
const id = (name) => (value) => idValue(value, name);
const text = (name, options) => (value) => stringValue(value, name, options);
const integer = (name, options) => (value) => integerValue(value, name, options);
const operation = (value) => operationId(value);
const reconciliationWrite = (params) => {
  const value = requireObject(params);
  const { operationId: rawOperationId, ...request } = value;
  return { operationId: operation(rawOperationId), ...validateReconciliationRequest(request) };
};
const empty = (params) => objectShape(params, {});
const competitionFilter = (params) => objectShape(params, { bewerbId: optional(id("bewerbId")) });
const competitionWrite = (params) => objectShape(params, { operationId: operation, bewerbId: id("bewerbId") });
const adminRankingReason = text("reason", { min: 1, max: 500 });
const fingerprint = text("expectedFingerprint", { min: 64, max: 64, pattern: /^[0-9a-f]{64}$/i });
const completionKind = text("kind", { max: 16, pattern: /^(regular|walkover|retirement)$/ });
const optionalMatchStart = optional(text("matchStart", { min: 11, max: 11, pattern: /^\d{6}-\d{4}$/ }));
const optionalMatchEnd = optional(text("matchEnd", { min: 11, max: 11, pattern: /^\d{6}-\d{4}$/ }));
const matchCompletionFields = {
  operationId: operation,
  matchId: id("matchId"),
  kind: completionKind,
  result: optional(text("result", { min: 0, max: 200 })),
  losingSide: optional(integer("losingSide", { min: 1, max: 2 })),
  matchStart: optionalMatchStart,
  matchEnd: optionalMatchEnd,
  longDurationConfirmed: optional((value) => booleanValue(value, "longDurationConfirmed")),
  expectedFingerprint: fingerprint,
};
const matchCorrectionFields = {
  operationId: operation,
  matchId: id("matchId"),
  kind: completionKind,
  result: optional(text("result", { min: 0, max: 200 })),
  losingSide: optional(integer("losingSide", { min: 1, max: 2 })),
  expectedFingerprint: fingerprint,
};
const rankPlan = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10000) {
    throw new AppError("VALIDATION_ERROR", "rankPlan muss ein nichtleeres Array sein");
  }
  const validated = value.map((entry) => objectShape(entry, {
    personId: id("personId"),
    expectedRank: integer("expectedRank", { min: 0, max: 10000 }),
    newRank: integer("newRank", { min: 0, max: 10000 }),
  }));
  const positiveRanks = validated.map(({ newRank }) => newRank).filter((rank) => rank > 0);
  if (validated.some(({ expectedRank, newRank }) => expectedRank > 0 && newRank === 0)) {
    throw new AppError("RANK_PLAN_INVALID", "Aktive Ranglistenmitglieder koennen nicht auf Rang 0 gesetzt werden", 409);
  }
  if (new Set(positiveRanks).size !== positiveRanks.length) {
    throw new AppError("VALIDATION_ERROR", "Positive Zielraenge muessen eindeutig sein");
  }
  return validated;
};
const rankingHour = (name) => text(name, { min: 11, max: 11, pattern: /^\d{6}-(?:[01]\d|2[0-3])00$/ });
const rankingMinute = (name) => text(name, { min: 11, max: 11, pattern: /^\d{6}-(?:[01]\d|2[0-3])[0-5]\d$/ });
const monitorWrite = (params) => objectShape(params, { operationId: operation, monitorId: id("monitorId") });
const historyCommentText = text("body", { min: 1, max: 16000 });
const historyReaction = (value) => value === null
  ? null
  : text("reactionKey", { max: 32, pattern: /^[a-z][a-z0-9_]*$/ })(value);
const playerIds = (name) => (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw new AppError("VALIDATION_ERROR", `${name} muss ein Array mit ein bis zwei IDs sein`);
  }
  return value.map((entry) => idValue(entry, name));
};
const FAVORITE_PAGES = new Set([
  "index", "Matches1", "players", "Bewerbe", "scoreboard", "RoundRobin", "entryList", "rangliste",
  "bewerbsRaster", "hallzeiten", "adminLogging", "personenNormalisieren", "mitgliederAbgleichen", "servicebereich", "hallzeitenVerwalten", "navigator", "monitor",
]);
const FAVORITE_ID_PAGES = new Set(["RoundRobin", "entryList", "rangliste", "bewerbsRaster", "hallzeiten"]);
const FAVORITE_OVERLAYS = new Set(["match-result", "match-appointment", "profile", "profile-messages"]);

function favoriteTargetId(target) {
  return `favorite-${crypto.createHash("sha256").update(JSON.stringify(target)).digest("base64url")}`;
}

function favoriteTarget(raw) {
  const value = requireObject(raw, "favorite");
  if (value.type === "page") {
    const pageTarget = objectShape(value, {
      type: (entry) => text("type", { max: 8, pattern: /^page$/ })(entry),
      page: text("page", { max: 32 }),
      params: optional((entry) => requireObject(entry, "params")),
    });
    if (!FAVORITE_PAGES.has(pageTarget.page)) throw new AppError("VALIDATION_ERROR", "Favoritenseite ist nicht erlaubt");
    const rawParams = pageTarget.params || {};
    let params;
    if (pageTarget.page === "RoundRobin") {
      params = objectShape(rawParams, {
        id: id("id"),
        paarungslayout: optional(integer("paarungslayout", { min: 0, max: 5 })),
      });
    } else if (pageTarget.page === "Bewerbe" && rawParams.history !== undefined) {
      params = objectShape(rawParams, {
        history: (entry) => text("history", { max: 11, pattern: /^(all|competition)$/ })(entry),
        id: optional(id("id")),
      });
      if ((params.history === "competition") !== (params.id !== undefined)) {
        throw new AppError("VALIDATION_ERROR", "Bewerbshistorie benoetigt genau bei Einzelhistorien eine ID");
      }
    } else if (FAVORITE_ID_PAGES.has(pageTarget.page)) {
      params = objectShape(rawParams, { id: id("id") });
    } else if (pageTarget.page === "navigator") {
      params = objectShape(rawParams, {
        profil: optional(text("profil", { max: 32, pattern: /^[A-Za-z0-9_.:-]+$/ })),
      });
    } else {
      params = objectShape(rawParams, {});
    }
    const target = { type: "page", page: pageTarget.page, ...(Object.keys(params).length ? { params } : {}) };
    return { targetId: favoriteTargetId(target), ...target };
  }
  if (value.type === "overlay") {
    const overlayTarget = objectShape(value, {
      type: (entry) => text("type", { max: 8, pattern: /^overlay$/ })(entry),
      overlay: text("overlay", { max: 32 }),
    });
    if (!FAVORITE_OVERLAYS.has(overlayTarget.overlay)) throw new AppError("VALIDATION_ERROR", "Favoritenoverlay ist nicht erlaubt");
    const target = { type: "overlay", overlay: overlayTarget.overlay };
    return { targetId: favoriteTargetId(target), ...target };
  }
  throw new AppError("VALIDATION_ERROR", "Favoritenzieltyp ist nicht erlaubt");
}

function favoriteTargets(value) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new AppError("VALIDATION_ERROR", "favorites muss ein Array mit maximal 32 Zielen sein");
  }
  const targets = value.map(favoriteTarget);
  if (new Set(targets.map(({ targetId }) => targetId)).size !== targets.length) {
    throw new AppError("VALIDATION_ERROR", "Favoritenziele muessen eindeutig sein");
  }
  return targets;
}

function idArray(name, { min = 0, max = 500 } = {}) {
  return (value) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      throw new AppError("VALIDATION_ERROR", `${name} muss ${min} bis ${max} Eintraege enthalten`);
    }
    const values = value.map((entry) => idValue(entry, name));
    if (new Set(values).size !== values.length) throw new AppError("VALIDATION_ERROR", `${name} darf keine Duplikate enthalten`);
    return values;
  };
}

function hallTimeSlots(value) {
  if (!Array.isArray(value) || value.length > 250) throw new AppError("VALIDATION_ERROR", "slots darf maximal 250 Termine enthalten");
  const slots = value.map((entry) => objectShape(entry, {
    id: optional(id("slot.id")),
    date: text("slot.date", { min: 10, max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ }),
    start: text("slot.start", { min: 5, max: 5, pattern: /^(?:[01]\d|2[0-3]):[0-5]\d$/ }),
    end: text("slot.end", { min: 5, max: 5, pattern: /^(?:[01]\d|2[0-3]):[0-5]\d$/ }),
  }));
  if (slots.some(({ date }) => {
    const parsed = new Date(`${date}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date;
  })) throw new AppError("VALIDATION_ERROR", "Termin-Datum ist ungueltig");
  if (slots.some(({ start, end }) => end <= start)) throw new AppError("VALIDATION_ERROR", "Terminende muss nach dem Beginn liegen");
  if (new Set(slots.map(({ id: slotId }) => slotId).filter(Boolean)).size !== slots.filter(({ id: slotId }) => slotId).length) throw new AppError("VALIDATION_ERROR", "Termin-IDs muessen eindeutig sein");
  if (new Set(slots.map(({ date, start, end }) => `${date}:${start}:${end}`)).size !== slots.length) throw new AppError("VALIDATION_ERROR", "Termine duerfen nicht doppelt vorkommen");
  return slots;
}

function fairUseConfig(value) {
  const config = objectShape(value, {
    base: integer("fairUse.base", { min: 0, max: 1000 }),
    extendedDays: integer("fairUse.extendedDays", { min: 1, max: 365 }),
    percent: integer("fairUse.percent", { min: 0, max: 1000 }),
    openDays: integer("fairUse.openDays", { min: 0, max: 364 }),
  });
  if (config.extendedDays <= config.openDays) throw new AppError("VALIDATION_ERROR", "Erweiterte Freigabe muss vor der freien Restplatzvergabe beginnen");
  return config;
}

function hallTimeGridWrite(params) {
  return objectShape(params, {
    operationId: operation,
    expectedRevision: integer("expectedRevision", { min: 0 }),
    gridId: optional(id("gridId")),
    name: text("name", { min: 1, max: 100 }),
    description: text("description", { max: 4000 }),
    mode: text("mode", { max: 16, pattern: /^(equal|fair_use)$/ }),
    capacity: integer("capacity", { min: 1, max: 100 }),
    waitlistEnabled: (value) => booleanValue(value, "waitlistEnabled"),
    maxWaitlistEntries: integer("maxWaitlistEntries", { min: 0, max: 1000 }),
    publicJoinable: (value) => booleanValue(value, "publicJoinable"),
    fairUse: fairUseConfig,
    active: (value) => booleanValue(value, "active"),
    participantIds: idArray("participantIds", { max: 500 }),
    slots: hallTimeSlots,
  });
}

function startTarget(value) {
  const raw = requireObject(value, "startTarget");
  if (raw.type === "page" && ["index", "favorites"].includes(raw.page)) {
    return objectShape(raw, {
      type: (entry) => text("type", { max: 8, pattern: /^page$/ })(entry),
      page: (entry) => text("page", { max: 16, pattern: /^(index|favorites)$/ })(entry),
    });
  }
  const { targetId, ...target } = favoriteTarget(raw);
  return target;
}

function courtAssignment(params) {
  const value = objectShape(params, {
    operationId: operation,
    court: id("court"),
    expectedRevision: integer("expectedRevision", { min: 1 }),
    empty: optional((entry) => booleanValue(entry, "empty")),
    matchId: optional(id("matchId")),
    homePlayerIds: optional(playerIds("homePlayerIds")),
    guestPlayerIds: optional(playerIds("guestPlayerIds")),
  });
  const hasMatch = value.matchId !== undefined;
  const hasPlayers = value.homePlayerIds !== undefined || value.guestPlayerIds !== undefined;
  const isEmpty = value.empty === true;
  if (Number(hasMatch) + Number(hasPlayers) + Number(isEmpty) !== 1
    || value.empty === false
    || (hasPlayers && (value.homePlayerIds === undefined || value.guestPlayerIds === undefined))) {
    throw new AppError("VALIDATION_ERROR", "Court-Zuweisung benoetigt genau Match, Spielerpaarung oder empty: true");
  }
  return value;
}

const requestContracts = {
  players: empty,
  adminPeopleNormalization: empty,
  adminMemberReconciliation: empty,
  sheetDataStatus: empty,
  refreshSheetData: (params) => objectShape(params, { operationId: operation }),
  publicProfile: (params) => objectShape(params, { id: id("id") }),
  bewerbe: empty,
  bewerbsart: empty,
  matches1: competitionFilter,
  preMatches: competitionFilter,
  matches: competitionFilter,
  rlPlatzierung: competitionFilter,
  entryList: competitionFilter,
  readMatchRestrictions: competitionFilter,
  withdrawnRankingPlayers: (params) => objectShape(params, { bewerbId: id("bewerbId") }),
  getScoreboardCourts: empty,
  courtScores: empty,
  scoreboardSnapshot: empty,
  memberDirectory: empty,
  myProfile: empty,
  myHallTimeGroups: empty,
  hallTimeGrids: empty,
  hallTimeGrid: (params) => objectShape(params, { gridId: id("gridId") }),
  hallTimeHistory: (params) => objectShape(params, { gridId: id("gridId") }),
  adminHallTimeGrids: empty,
  adminSaveHallTimeGrid: hallTimeGridWrite,
  setHallTimeBooking: (params) => objectShape(params, {
    operationId: operation,
    gridId: id("gridId"),
    slotId: id("slotId"),
    personId: optional(id("personId")),
    selected: (value) => booleanValue(value, "selected"),
  }),
  setMyHallTimeGroupMembership: (params) => objectShape(params, {
    operationId: operation,
    expectedRevision: integer("expectedRevision", { min: 0 }),
    gridId: id("gridId"),
    selected: (value) => booleanValue(value, "selected"),
  }),
  adminDistributeHallTimeGrid: (params) => objectShape(params, {
    operationId: operation,
    gridId: id("gridId"),
    expectedRevision: integer("expectedRevision", { min: 0 }),
  }),
  adminClearAllHallTimeStatuses: (params) => objectShape(params, {
    operationId: operation,
    gridId: id("gridId"),
    expectedRevision: integer("expectedRevision", { min: 0 }),
  }),
  myFavorites: empty,
  myStartPage: empty,
  setMyFavorites: (params) => objectShape(params, {
    operationId: operation,
    expectedRevision: integer("expectedRevision", { min: 0 }),
    favorites: favoriteTargets,
  }),
  setMyStartPage: (params) => objectShape(params, {
    operationId: operation,
    expectedRevision: integer("expectedRevision", { min: 0 }),
    target: startTarget,
  }),
  myMessageSummary: empty,
  myMessages: (params) => objectShape(params, {
    cursor: optional(id("cursor")),
    limit: optional(integer("limit", { min: 1, max: 100 })),
  }),
  myMessage: (params) => objectShape(params, { messageId: id("messageId") }),
  acknowledgeMessage: (params) => objectShape(params, { operationId: operation, messageId: id("messageId") }),
  acknowledgeAllMessages: (params) => objectShape(params, { operationId: operation }),
  competitionHistory: (params) => objectShape(params, {
    bewerbId: optional(id("bewerbId")),
    cursor: optional(text("cursor", { max: 256, pattern: /^[A-Za-z0-9_-]+$/ })),
    limit: optional(integer("limit", { min: 1, max: 100 })),
  }),
  competitionHistoryComments: (params) => objectShape(params, {
    eventId: id("eventId"),
    cursor: optional(text("cursor", { max: 256, pattern: /^[A-Za-z0-9_-]+$/ })),
    limit: optional(integer("limit", { min: 1, max: 100 })),
  }),
  competitionHistoryInteraction: (params) => objectShape(params, { eventId: id("eventId") }),
  competitionHistoryCommentForEdit: (params) => objectShape(params, { commentId: id("commentId") }),
  competitionHistoryReactions: (params) => objectShape(params, { eventId: id("eventId") }),
  competitionHistoryCommentReactions: (params) => objectShape(params, { commentId: id("commentId") }),
  addCompetitionHistoryComment: (params) => objectShape(params, {
    operationId: operation,
    eventId: id("eventId"),
    body: historyCommentText,
  }),
  editCompetitionHistoryComment: (params) => objectShape(params, {
    operationId: operation,
    commentId: id("commentId"),
    body: historyCommentText,
  }),
  deleteCompetitionHistoryComment: (params) => objectShape(params, {
    operationId: operation,
    commentId: id("commentId"),
  }),
  moderateCompetitionHistoryComment: (params) => objectShape(params, {
    operationId: operation,
    commentId: id("commentId"),
    status: text("status", { max: 16, pattern: /^(visible|under_review)$/ }),
  }),
  setCompetitionHistoryReaction: (params) => objectShape(params, {
    operationId: operation,
    eventId: id("eventId"),
    reactionKey: historyReaction,
  }),
  setCompetitionHistoryCommentReaction: (params) => objectShape(params, {
    operationId: operation,
    commentId: id("commentId"),
    reactionKey: historyReaction,
  }),
  rankingChallengeState: (params) => objectShape(params, { bewerbId: id("bewerbId") }),
  operationStatus: (params) => objectShape(params, { operationId: operation }),
  normalizePerson: (params) => objectShape(params, {
    operationId: operation,
    personId: id("personId"),
    expectedFingerprint: text("expectedFingerprint", { min: 64, max: 64, pattern: /^[0-9a-f]{64}$/i }),
    changes: validateChanges,
  }),
  reconcilePerson: reconciliationWrite,
  addMatch: (params) => objectShape(params, {
    operationId: operation,
    bewerbId: id("bewerbId"),
    opponentId: id("opponentId"),
  }),
  setMatchAppointment: (params) => objectShape(params, {
    operationId: operation,
    matchId: id("matchId"),
    matchDate: rankingHour("matchDate"),
  }),
  clearMatchAppointment: (params) => objectShape(params, {
    operationId: operation,
    matchId: id("matchId"),
  }),
  matchResultSuggestion: (params) => objectShape(params, {
    matchId: id("matchId"),
    court: text("court", { min: 1, max: 1, pattern: /^[12]$/ }),
  }),
  setMatchResult: (params) => objectShape(params, matchCompletionFields),
  adminSetMatchEnd: (params) => objectShape(params, {
    operationId: operation,
    matchId: id("matchId"),
    matchEnd: text("matchEnd", { min: 11, max: 11, pattern: /^\d{6}-\d{4}$/ }),
    expectedFingerprint: fingerprint,
    reason: adminRankingReason,
  }),
  adminClearMatchResult: (params) => objectShape(params, {
    operationId: operation,
    matchId: id("matchId"),
    expectedFingerprint: fingerprint,
    reason: adminRankingReason,
  }),
  adminCorrectRankingResult: (params) => objectShape(params, {
    ...matchCorrectionFields,
    reason: adminRankingReason,
    rankPlan,
  }),
  adminDeleteRankingChallenge: (params) => objectShape(params, {
    operationId: operation,
    matchId: id("matchId"),
    reason: adminRankingReason,
  }),
  adminSetRankingChallengeDate: (params) => objectShape(params, {
    operationId: operation,
    matchId: id("matchId"),
    challengeDate: rankingMinute("challengeDate"),
    reason: adminRankingReason,
  }),
  adminSetMatchAppointment: (params) => objectShape(params, {
    operationId: operation,
    matchId: id("matchId"),
    matchDate: rankingHour("matchDate"),
    reason: adminRankingReason,
  }),
  adminClearMatchAppointment: (params) => objectShape(params, {
    operationId: operation,
    matchId: id("matchId"),
    reason: adminRankingReason,
  }),
  addEntryList: competitionWrite,
  removeEntryList: competitionWrite,
  withdrawFromRanking: (params) => objectShape(params, {
    operationId: operation,
    bewerbId: id("bewerbId"),
    rank: integer("rank", { min: 1, max: 10000 }),
    reason: text("reason", { min: 3, max: 500 }),
  }),
  navigator: (params) => objectShape(params, { profil: optional(text("profil", { max: 32 })) }),
  courtAssign: courtAssignment,
  courtSetActive: (params) => objectShape(params, {
    operationId: operation,
    court: id("court"),
    expectedRevision: integer("expectedRevision", { min: 1 }),
    active: (value) => booleanValue(value, "active"),
  }),
  monitorList: empty,
  monitorNavigate: (params) => objectShape(params, {
    operationId: operation,
    monitorId: id("monitorId"),
    path: text("path", { max: 512 }),
  }),
  monitorScroll: (params) => objectShape(params, {
    operationId: operation,
    monitorId: id("monitorId"),
    direction: text("direction", { max: 4, pattern: /^(up|down)$/ }),
  }),
  monitorProvision: (params) => objectShape(params, {
    operationId: operation,
    label: text("label", { max: 100 }),
  }),
  monitorRotate: monitorWrite,
  monitorRevoke: monitorWrite,
  monitorTarget: empty,
  monitorAck: (params) => objectShape(params, {
    kind: text("kind", { max: 16, pattern: /^(navigate|scroll)$/ }),
    commandId: id("commandId"),
    status: text("status", { max: 16 }),
    errorCode: optional(text("errorCode", { max: 64, pattern: /^[A-Z0-9_]+$/ })),
  }),
};

function validateEndpointRequest(endpoint, params) {
  const contract = requestContracts[endpoint];
  if (!contract) throw new AppError("ENDPOINT_CONTRACT_MISSING", "Endpointvertrag fehlt", 500);
  return contract(params);
}

function validateEndpointResponse(endpoint, result) {
  requireObject(result, `${endpoint} response`);
  if (result.success !== true) throw new AppError("ENDPOINT_RESPONSE_INVALID", "Endpointantwort ist ungueltig", 500);
  return result;
}

module.exports = {
  requestContracts,
  validateEndpointRequest,
  validateEndpointResponse,
  validateFavoriteTargets: favoriteTargets,
  validateStartTarget: startTarget,
};
