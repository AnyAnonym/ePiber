"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Temporal } = require("@js-temporal/polyfill");
const { SQLITE_FILES } = require("./sourceInspector");
const {
  SECTION_ID, TENANT_ID, contractId, fail, hex32, instant, integer, jsonObject, legacyBoolean,
  sha256, stableUuid, text,
} = require("./transformCommon");

function rows(database, table) {
  return database.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).all();
}

function uuid(value, scope) {
  const raw = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw.toLowerCase() : stableUuid(scope, raw);
}

function cutoff(exportStartedAt, months) {
  return Temporal.Instant.from(exportStartedAt).toZonedDateTimeISO("UTC").subtract({ months }).toInstant().epochMilliseconds;
}

function sqliteTables() {
  return Object.fromEntries([
    "sites", "courts", "score_sources", "court_assignments", "court_assignment_participants", "court_live_state", "score_events", "monitor_devices",
    "hall_time_grids", "hall_time_grid_participants", "hall_time_slots", "hall_time_allocations", "hall_time_constraints", "hall_time_history", "hall_time_history_items",
    "user_favorites", "user_start_pages", "user_preference_states", "ranking_changes", "ranking_change_items", "match_ranking_effects", "idempotency_operations",
    "frontend_logging_settings", "events", "event_participants", "event_recipients", "receipts", "deliveries", "comments", "reactions", "user_revisions", "history_revision",
    "audit_operations", "audit_security_context", "audit_transitions",
  ].map((name) => [name, []]));
}

function addFinding(findings, code, source, severity = "info", count = 1) {
  const key = `${code}:${source}:${severity}`;
  const item = findings.get(key) || { code, source, projection: source, severity, count: 0, ruleVersion: 1 };
  item.count += count;
  findings.set(key, item);
}

function unixInstant(value, source, projection) {
  return instant(value, source, projection, { unixMs: true, optional: false });
}

function viennaSlot(date, time, source) {
  try {
    return Temporal.PlainDateTime.from(`${date}T${time}:00`).toZonedDateTime("Europe/Vienna", { disambiguation: "reject" }).toInstant().toString({ smallestUnit: "millisecond" });
  } catch { fail("HALL_TIME_SLOT_INVALID", source, "slot"); }
}

function preferenceTarget(value, refs, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("PREFERENCE_TARGET_INVALID", source, "target");
  if (value.type === "overlay" && new Set(["match-result", "match-appointment", "profile", "profile-messages"]).has(value.overlay)) {
    return { target_type: "overlay", page_key: null, overlay_key: value.overlay, competition_id: null, hall_time_grid_id: null, round_robin_layout: null, navigator_profile_code: null };
  }
  if (value.type !== "page" || typeof value.page !== "string") fail("PREFERENCE_TARGET_INVALID", source, "target");
  const params = value.params || {}, pages = new Set(["index", "favorites", "Matches1", "players", "Bewerbe", "scoreboard", "adminLogging", "personenNormalisieren", "mitgliederAbgleichen", "servicebereich", "hallzeitenVerwalten", "navigator", "monitor"]);
  if (value.page === "Bewerbe" && params.history === "all") return { target_type: "competition_history_all", page_key: null, overlay_key: null, competition_id: null, hall_time_grid_id: null, round_robin_layout: null, navigator_profile_code: null };
  if (value.page === "Bewerbe" && params.history === "competition") {
    const competition = refs.competitions.get(String(params.id))?.id; if (!competition) fail("PREFERENCE_COMPETITION_MISSING", source, "target");
    return { target_type: "competition_history", page_key: null, overlay_key: null, competition_id: competition, hall_time_grid_id: null, round_robin_layout: null, navigator_profile_code: null };
  }
  if (pages.has(value.page)) return { target_type: "page", page_key: value.page, overlay_key: null, competition_id: null, hall_time_grid_id: null, round_robin_layout: null, navigator_profile_code: value.page === "navigator" ? String(params.profil || "1") : null };
  const competitionTypes = { rangliste: "ranking", entryList: "entry_list", bewerbsRaster: "bracket", RoundRobin: "round_robin" };
  if (competitionTypes[value.page]) {
    const competition = refs.competitions.get(String(params.id))?.id; if (!competition) fail("PREFERENCE_COMPETITION_MISSING", source, "target");
    return { target_type: competitionTypes[value.page], page_key: null, overlay_key: null, competition_id: competition, hall_time_grid_id: null, round_robin_layout: value.page === "RoundRobin" && params.paarungslayout !== undefined ? integer(params.paarungslayout, source, "paarungslayout", { min: 0, max: 5 }) : null, navigator_profile_code: null };
  }
  if (value.page === "hallzeiten") {
    const grid = refs.hallGrids.get(String(params.id)); if (!grid) fail("PREFERENCE_HALL_GRID_MISSING", source, "target");
    return { target_type: "hall_time_grid", page_key: null, overlay_key: null, competition_id: null, hall_time_grid_id: grid, round_robin_layout: null, navigator_profile_code: null };
  }
  fail("PREFERENCE_TARGET_INVALID", source, "target");
}

function transformHallTimes(row, tables, refs) {
  const value = jsonObject(row.value_json, "state.sqlite:app_state", "hall-times:v1");
  if (!Array.isArray(value.grids)) fail("HALL_TIME_STATE_INVALID", "state.sqlite:app_state", "grids");
  refs.hallGrids ||= new Map();
  for (const grid of value.grids) {
    const source = "state.sqlite:app_state:hall-times", contract = contractId(grid.id, source), id = stableUuid("hall-grid", contract);
    if (refs.hallGrids.has(contract)) fail("HALL_TIME_GRID_DUPLICATE", source, "id");
    refs.hallGrids.set(contract, id);
    const mode = grid.mode === "fair_use" ? "reservation" : grid.mode === "equal" ? "allocation" : fail("HALL_TIME_MODE_INVALID", source, "mode");
    const createdAt = unixInstant(grid.createdAt, source, "createdAt"), updatedAt = unixInstant(grid.updatedAt, source, "updatedAt");
    const fair = grid.fairUse || {};
    tables.hall_time_grids.push({ id, section_id: SECTION_ID, contract_id: contract, name: text(grid.name, { required: true, max: 200, source, projection: "name" }), description: text(grid.description, { max: 2000, source, projection: "description" }), mode, active: Boolean(grid.active), public_join_enabled: Boolean(grid.publicJoinable), capacity: integer(grid.capacity, source, "capacity", { min: 1, max: 100 }), waiting_list_enabled: Boolean(grid.waitlistEnabled), waiting_limit_per_person: grid.waitlistEnabled ? integer(grid.maxWaitlistEntries ?? 2, source, "maxWaitlistEntries", { min: 1, max: 100 }) : null, fair_use_enabled: mode === "reservation", fair_use_base: integer(fair.base ?? 0, source, "fairUse.base", { min: 0 }), fair_use_extended_days: integer(fair.extendedDays ?? 1, source, "fairUse.extendedDays", { min: 1 }), fair_use_percent: integer(fair.percent ?? 0, source, "fairUse.percent", { min: 0 }), fair_use_open_days: integer(fair.openDays ?? 0, source, "fairUse.openDays", { min: 0 }), revision: Number(row.revision), projection_revision: Number(row.revision), created_at: createdAt, updated_at: updatedAt });
    for (const participant of grid.participants || []) {
      const person = refs.people.get(String(participant.id)); if (!person) fail("HALL_TIME_PERSON_MISSING", source, "participants");
      tables.hall_time_grid_participants.push({ grid_id: id, person_id: person, joined_at: createdAt, left_at: null });
    }
    const slots = new Map();
    for (const slot of grid.slots || []) {
      const slotContract = contractId(slot.id, source), slotId = stableUuid("hall-slot", `${contract}:${slotContract}`), startsAt = viennaSlot(slot.date, slot.start, source), endsAt = viennaSlot(slot.date, slot.end, source);
      slots.set(slotContract, { id: slotId, startsAt, endsAt });
      tables.hall_time_slots.push({ id: slotId, grid_id: id, starts_at: startsAt, ends_at: endsAt, capacity: Number(grid.capacity), slot_revision: 1, active: true });
    }
    for (const entry of grid.entries || []) {
      const slot = slots.get(String(entry.slotId)), person = refs.people.get(String(entry.personId));
      if (!slot || !person) fail("HALL_TIME_ENTRY_REFERENCE_MISSING", source, "entries");
      const status = entry.status === "waitlist" ? "waiting" : entry.status === "confirmed" ? "confirmed" : fail("HALL_TIME_ENTRY_STATUS_INVALID", source, "entries.status");
      const queuedAt = unixInstant(entry.queuedAt, source, "entries.queuedAt");
      tables.hall_time_allocations.push({ id: stableUuid("hall-allocation", `${slot.id}:${person}`), slot_id: slot.id, person_id: person, status, queued_at: queuedAt, assigned_at: status === "confirmed" ? queuedAt : null, created_by_person_id: person });
    }
    for (const constraint of grid.constraints || []) {
      const slot = slots.get(String(constraint.slotId)), person = refs.people.get(String(constraint.personId));
      if (!slot || !person || !["unavailable", "avoid"].includes(constraint.kind)) fail("HALL_TIME_CONSTRAINT_INVALID", source, "constraints");
      tables.hall_time_constraints.push({ id: stableUuid("hall-constraint", `${id}:${person}:${slot.id}:${constraint.kind}`), grid_id: id, person_id: person, slot_id: slot.id, constraint_type: constraint.kind, created_at: updatedAt });
    }
    for (const history of grid.history || []) {
      const historyId = stableUuid("hall-history", `${contract}:${history.id}`), person = history.personId ? refs.people.get(String(history.personId)) || null : null, actor = history.actorId ? refs.people.get(String(history.actorId)) || null : null;
      const before = history.from === "waitlist" ? "waiting" : history.from === "confirmed" ? "confirmed" : null;
      const after = history.to === "waitlist" ? "waiting" : history.to === "confirmed" ? "confirmed" : null;
      const slot = slots.get(String(history.slotId)), snapshot = history.slot;
      tables.hall_time_history.push({ id: historyId, grid_id: id, operation_id: uuid(history.id, "hall-history-operation"), action_code: String(history.action), actor_person_id: actor, occurred_at: unixInstant(history.at, source, "history.at"), item_count: history.personId || history.slotId ? 1 : 0, detail: text(history.detail, { max: 2000, source, projection: "history.detail" }), unavailable_count: null, avoid_count: null, assigned_count: null, removed_count: null, promoted_count: null, unchanged_count: null });
      if (history.personId || history.slotId) tables.hall_time_history_items.push({ history_id: historyId, item_no: 1, slot_id: slot?.id || null, person_id: person, before_status: before, after_status: after, slot_starts_at_snapshot: slot?.startsAt || (snapshot?.date && snapshot?.start ? viennaSlot(snapshot.date, snapshot.start, source) : null), person_contract_id_snapshot: history.personId ? String(history.personId) : null, person_name_snapshot: text(history.personName, { max: 200, source, projection: "history.personName" }) });
    }
  }
}

function transformCourts(stateRows, tables, refs) {
  refs.courtAssignments ||= new Map();
  for (const row of stateRows.filter(({ key }) => String(key).startsWith("court:"))) {
    const code = contractId(String(row.key).slice(6), "state.sqlite:app_state"), value = jsonObject(row.value_json, "state.sqlite:app_state", "court");
    const infrastructure = ensureCourt(tables, refs, code, "paj"), courtRow = tables.courts.find(({ id }) => id === infrastructure.court), live = tables.court_live_state.find(({ court_id }) => court_id === infrastructure.court);
    courtRow.active = Number(value.aktiv) === 1; courtRow.revision = Number(row.revision);
    live.active = courtRow.active; live.awaiting_baseline = courtRow.active; live.revision = Number(row.revision); live.updated_at = unixInstant(row.updated_at, "state.sqlite:app_state", "court.updated_at");
    const matchContract = String(value.matchId || "").trim(), homeIds = Array.isArray(value.homePlayerIds) ? value.homePlayerIds.map(String) : [], guestIds = Array.isArray(value.guestPlayerIds) ? value.guestPlayerIds.map(String) : [];
    if (!matchContract && !homeIds.length && !guestIds.length) continue;
    const match = matchContract ? refs.matchDetails.get(matchContract) : null;
    if (matchContract && !match) fail("COURT_MATCH_REFERENCE_MISSING", "state.sqlite:app_state", "court.matchId");
    const assignmentId = stableUuid("court-assignment", `${code}:${row.updated_at}`), automation = value.automaticActivation?.status;
    if (automation && !["pending", "activated", "finished", "expired", "unscheduled"].includes(automation)) fail("COURT_AUTOMATION_INVALID", "state.sqlite:app_state", "court.automaticActivation");
    tables.court_assignments.push({ id: assignmentId, court_id: infrastructure.court, assignment_type: match ? "match" : "manual", match_id: match?.id || null, competition_id: match?.competitionId || (value.bewerbId ? refs.competitions.get(String(value.bewerbId))?.id || null : null), match_format_version_id: match?.formatId || null, competition_name_snapshot: text(value.bewerb, { max: 200, source: "state.sqlite:app_state", projection: "court.bewerb" }), round_code_snapshot: text(value.runde, { max: 100, source: "state.sqlite:app_state", projection: "court.runde" }), scheduled_at_snapshot: instant(value.dateTime, "state.sqlite:app_state", "court.dateTime"), automation_status: automation || null, assigned_at: unixInstant(row.updated_at, "state.sqlite:app_state", "court.updated_at"), assigned_by_person_id: null, released_at: null, released_by_person_id: null });
    live.assignment_id = assignmentId; refs.courtAssignments.set(`${code}:${matchContract}`, assignmentId);
    for (const [side, ids] of [[1, homeIds], [2, guestIds]]) ids.forEach((personContract, index) => {
      const detail = refs.peopleDetails.get(personContract); if (!detail) fail("COURT_PERSON_REFERENCE_MISSING", "state.sqlite:app_state", "court.participants");
      tables.court_assignment_participants.push({ assignment_id: assignmentId, side_no: side, position_no: index + 1, person_id: detail.id, first_name_snapshot: detail.firstName, last_name_snapshot: detail.lastName });
    });
  }
}

function transformPreferences(stateRows, tables, refs) {
  const states = new Map();
  const preferenceState = (account) => {
    if (!states.has(account)) states.set(account, { account_id: account, favorites_revision: 0, favorites_updated_at: null, start_page_revision: 0, start_page_updated_at: null });
    return states.get(account);
  };
  for (const row of stateRows) {
    const key = String(row.key), family = key.split(":")[0];
    if (!new Set(["favorites", "start-page"]).has(family)) continue;
    const personContract = key.slice(family.length + 1), account = refs.accounts.get(personContract);
    if (!account) fail("PREFERENCE_ACCOUNT_MISSING", "state.sqlite:app_state", family);
    const state = preferenceState(account), updatedAt = unixInstant(row.updated_at, "state.sqlite:app_state", `${family}.updated_at`), value = JSON.parse(row.value_json);
    if (family === "favorites") {
      if (!Array.isArray(value) || value.length > 32) fail("PREFERENCE_FAVORITES_INVALID", "state.sqlite:app_state", family);
      value.forEach((target, position) => tables.user_favorites.push({ account_id: account, position: position + 1, ...preferenceTarget(target, refs, "state.sqlite:app_state:favorites"), revision: Number(row.revision) }));
      state.favorites_revision = Number(row.revision); state.favorites_updated_at = updatedAt;
    } else {
      tables.user_start_pages.push({ account_id: account, ...preferenceTarget(value, refs, "state.sqlite:app_state:start-page"), revision: Number(row.revision), updated_at: updatedAt });
      state.start_page_revision = Number(row.revision); state.start_page_updated_at = updatedAt;
    }
  }
  tables.user_preference_states.push(...states.values());
}

function monitorTarget(pathValue, refs, source) {
  let url; try { url = new URL(String(pathValue), "https://epiber.invalid"); } catch { fail("MONITOR_TARGET_INVALID", source, "path"); }
  const id = url.searchParams.get("id"), competition = id ? refs.competitions.get(id)?.id : null, grid = id ? refs.hallGrids?.get(id) : null;
  const pages = new Set(["index", "scoreboard", "Sponsoren", "Matches1", "Bewerbe", "players", "monitor"]), page = url.pathname.replace(/^\//, "").replace(/\.html$/, "");
  if (pages.has(page) && !url.search) return { target_type: "page", page_key: page, competition_id: null, hall_time_grid_id: null };
  if (url.pathname === "/hallzeiten.html" && grid) return { target_type: "hall_time_grid", page_key: null, competition_id: null, hall_time_grid_id: grid };
  const types = { "/rangliste.html": "ranking", "/entryList.html": "entry_list", "/bewerbsRaster.html": "competition", "/RoundRobin.html": "competition" };
  if (types[url.pathname] && competition) return { target_type: types[url.pathname], page_key: null, competition_id: competition, hall_time_grid_id: null };
  fail("MONITOR_TARGET_INVALID", source, "path");
}

function transformMonitorTargets(stateRows, tables, refs) {
  for (const row of stateRows.filter(({ key }) => String(key).startsWith("monitor-target:"))) {
    const value = jsonObject(row.value_json, "state.sqlite:app_state", "monitor-target"), contract = String(value.monitorId || String(row.key).slice(15)), monitor = tables.monitor_devices.find(({ contract_id }) => contract_id === contract);
    if (!monitor) fail("MONITOR_REFERENCE_MISSING", "state.sqlite:app_state", "monitor-target");
    Object.assign(monitor, monitorTarget(value.path, refs, "state.sqlite:app_state:monitor-target"), { target_path: String(value.path), target_command_id: uuid(value.commandId, "monitor-command"), target_issued_at: unixInstant(value.issuedAt, "state.sqlite:app_state", "monitor-target.issuedAt"), revision: Number(row.revision), updated_at: unixInstant(row.updated_at, "state.sqlite:app_state", "monitor-target.updated_at") });
  }
}

function transformRankingEffects(stateRows, tables, refs, findings) {
  for (const row of stateRows.filter(({ key }) => String(key).startsWith("match-result-ranking:"))) {
    const matchContract = String(row.key).slice("match-result-ranking:".length), value = JSON.parse(row.value_json);
    if (value === null) { addFinding(findings, "RANKING_EFFECT_EMPTY_DISCARDED", "state.sqlite", "info"); continue; }
    const history = refs.matchResultHistory.get(matchContract), match = refs.matchDetails.get(matchContract);
    if (!history || !match || !Array.isArray(value.before) || !Array.isArray(value.after)) fail("RANKING_EFFECT_REFERENCE_MISSING", "state.sqlite:app_state", "match-result-ranking");
    const before = new Map(value.before.map((item) => [String(item.personId), item.beforeRank ?? null])), after = new Map(value.after.map((item) => [String(item.personId), item.afterRank ?? null])), people = new Set([...before.keys(), ...after.keys()]);
    const change = stableUuid("ranking-change", matchContract);
    tables.ranking_changes.push({ id: change, competition_id: match.competitionId, match_result_history_id: history, created_at: unixInstant(row.updated_at, "state.sqlite:app_state", "match-result-ranking.updated_at") });
    for (const contract of people) {
      const person = refs.people.get(contract); if (!person) fail("RANKING_EFFECT_PERSON_MISSING", "state.sqlite:app_state", "match-result-ranking");
      const beforeRank = before.get(contract), afterRank = after.get(contract);
      if (beforeRank === afterRank) continue;
      tables.ranking_change_items.push({ ranking_change_id: change, person_id: person, before_rank: beforeRank, after_rank: afterRank });
    }
    tables.match_ranking_effects.push({ match_result_history_id: history, ranking_change_id: change, challenger_rank_snapshot: null, challenged_rank_snapshot: null });
  }
}

function transformState(database, tables, refs, findings, exportStartedAt) {
  const discardedSessions = rows(database, "sessions").length;
  const discardedLimits = rows(database, "login_failures").length;
  if (discardedSessions) addFinding(findings, "STATE_SESSIONS_DISCARDED", "state.sqlite", "info", discardedSessions);
  if (discardedLimits) addFinding(findings, "STATE_LOGIN_LIMITS_DISCARDED", "state.sqlite", "info", discardedLimits);
  for (const row of rows(database, "monitor_devices")) {
    const contract = contractId(row.monitor_id, "state.sqlite:monitor_devices");
    const revoked = instant(row.revoked_at, "state.sqlite:monitor_devices", "revoked_at", { unixMs: true });
    tables.monitor_devices.push({
      id: stableUuid("monitor", contract), tenant_id: TENANT_ID, contract_id: contract,
      label: text(row.label, { required: true, source: "state.sqlite:monitor_devices", projection: "label" }),
      token_hash: hex32(row.token_hash, "state.sqlite:monitor_devices", "token_hash"), target_type: "page", page_key: "index",
      competition_id: null, hall_time_grid_id: null, revision: 1,
      created_at: instant(row.created_at, "state.sqlite:monitor_devices", "created_at", { unixMs: true, optional: false }),
      updated_at: instant(row.updated_at, "state.sqlite:monitor_devices", "updated_at", { unixMs: true, optional: false }),
      last_seen_at: instant(row.last_seen_at, "state.sqlite:monitor_devices", "last_seen_at", { unixMs: true }), revoked_at: revoked,
    });
  }
  const expiresAt = Temporal.Instant.from(exportStartedAt).add({ hours: 24 });
  for (const row of rows(database, "operations")) {
    const startedAt = instant(row.created_at, "state.sqlite:operations", "created_at", { unixMs: true, optional: false });
    if (Temporal.Instant.compare(Temporal.Instant.from(startedAt), expiresAt.subtract({ hours: 24 })) < 0) {
      addFinding(findings, "STATE_OPERATION_EXPIRED", "state.sqlite");
      continue;
    }
    const actorContract = String(row.actor_key ?? "").trim().replace(/^(?:user|person):/, "");
    const actor = refs.people.get(actorContract);
    if (!actor) fail("STATE_OPERATION_ACTOR_MISSING", "state.sqlite:operations", "actor_key");
    const response = jsonObject(row.result_json, "state.sqlite:operations", "result_json");
    if (response.status === "started" || response.status === "unknown") fail("STATE_OPERATION_UNRESOLVED", "state.sqlite:operations", "result_json");
    tables.idempotency_operations.push({ id: stableUuid("state-operation", `${actorContract}:${row.operation_id}`), tenant_id: TENANT_ID, operation_id: uuid(row.operation_id, "operation"), actor_person_id: actor, command: text(row.endpoint, { required: true, max: 126, source: "state.sqlite:operations", projection: "endpoint" }), request_hash: hex32(row.payload_hash, "state.sqlite:operations", "payload_hash"), status: response.status === "failed" ? "failed" : "success", response_projection: response, response_expires_at: expiresAt.toString({ smallestUnit: "millisecond" }), started_at: startedAt, completed_at: startedAt, expires_at: expiresAt.toString({ smallestUnit: "millisecond" }) });
  }
  const stateRows = rows(database, "app_state");
  const hallState = stateRows.find(({ key }) => key === "hall-times:v1");
  refs.hallGrids = new Map();
  if (hallState) transformHallTimes(hallState, tables, refs);
  transformCourts(stateRows, tables, refs);
  transformMonitorTargets(stateRows, tables, refs);
  transformPreferences(stateRows, tables, refs);
  transformRankingEffects(stateRows, tables, refs, findings);
  for (const row of stateRows) {
    const key = String(row.key);
    if (/^(court:|monitor-target:|favorites:|start-page:|hall-times:v1$|match-result-ranking:)/.test(key)) continue;
    if (key === "frontend-logging:targets") {
      let value; try { value = JSON.parse(row.value_json); } catch { fail("SOURCE_JSON_INVALID", "state.sqlite:app_state", "frontend-logging:targets"); }
      addFinding(findings, "STATE_FRONTEND_LOGGING_TARGETS_DISCARDED", "state.sqlite", "info", Array.isArray(value) ? value.length : Array.isArray(value.targets) ? value.targets.length : 1);
      continue;
    }
    const value = jsonObject(row.value_json, "state.sqlite:app_state", "value_json");
    if (key === "frontend-logging:settings") {
      const level = String(value.minimumLevel || value.level || "");
      if (!["error", "warn", "info", "debug"].includes(level)) fail("STATE_FRONTEND_LOGGING_INVALID", "state.sqlite:app_state", "frontend-logging:settings");
      tables.frontend_logging_settings.push({ tenant_id: TENANT_ID, minimum_level: level, info_sample_rate: Number(value.infoSampleRate ?? 0), debug_sample_rate: Number(value.debugSampleRate ?? 0), revision: Number(row.revision), updated_at: instant(row.updated_at, "state.sqlite:app_state", "updated_at", { unixMs: true, optional: false }) });
    } else if (key.startsWith("record-metadata-intent:")) {
      if (!new Set(["confirmed", "deleted"]).has(String(value.status))) fail("STATE_RECOVERY_INTENT_UNRESOLVED", "state.sqlite:app_state", "record-metadata-intent");
      addFinding(findings, "STATE_RECOVERY_INTENT_RESOLVED_DISCARDED", "state.sqlite", "info");
    } else {
      fail("STATE_KEY_UNKNOWN", "state.sqlite:app_state", "key");
    }
  }
}

function ensureCourt(tables, refs, code, instance) {
  if (!refs.site) {
    refs.site = stableUuid("site", "legacy-main");
    tables.sites.push({ id: refs.site, section_id: SECTION_ID, site_code: "legacy-main", display_name: "Legacy-Anlage", active: true });
  }
  if (!refs.courts.has(code)) {
    const court = stableUuid("court", code), source = stableUuid("score-source", `${instance}:${code}`);
    refs.courts.set(code, { court, source });
    tables.courts.push({ id: court, site_id: refs.site, court_code: code, display_name: `Platz ${code}`, active: false, epoch: 0, revision: 1 });
    tables.score_sources.push({ id: source, court_id: court, source_type: "legacy_court_receiver", source_key: `${instance}:${code}`, active: true });
    tables.court_live_state.push({ court_id: court, assignment_id: null, source_id: source, active: false, awaiting_baseline: false, side_one_set_one: "0", side_two_set_one: "0", side_one_set_two: "0", side_two_set_two: "0", side_one_set_three: "0", side_two_set_three: "0", side_one_points: "0", side_two_points: "0", source_state: "unknown", epoch: 0, revision: 1 });
  }
  return refs.courts.get(code);
}

function transformScore(database, tables, refs) {
  const maximums = new Map(rows(database, "score_log_sequence").map((row) => [`${row.instance}:${row.court}`, Number(row.last_sequence)]));
  const observed = new Map();
  for (const row of rows(database, "score_log")) {
    const source = "scorelog.sqlite:score_log", code = contractId(row.court, source), infrastructure = ensureCourt(tables, refs, code, String(row.instance));
    const components = String(row.score).match(/^([^-\/]+)-([^\/]+)\/([^-\/]+)-([^\/]+)\/([^-\/]+)-([^\/]+)\/([^-\/]+)-([^\/]+)$/);
    if (!components || Number(row.court_active) !== 1) fail("SCORE_EVENT_INVALID", source, "score");
    const sequence = integer(row.sequence, source, "sequence", { min: 1 });
    observed.set(`${row.instance}:${code}`, Math.max(observed.get(`${row.instance}:${code}`) || 0, sequence));
    const match = String(row.match_id ?? "").trim();
    if (match && !refs.matches.has(match)) fail("SCORE_MATCH_REFERENCE_MISSING", source, "match_id");
    tables.score_events.push({ id: stableUuid("score-row", row.event_id), event_id: uuid(row.event_id, "score-event"), court_id: infrastructure.court, assignment_id: refs.courtAssignments?.get(`${code}:${match}`) || null, source_id: infrastructure.source, court_sequence: sequence, source_occurred_at: instant(row.occurred_at, source, "occurred_at", { optional: false }), accepted_at: instant(row.created_at, source, "created_at", { unixMs: true, optional: false }), side_one_set_one: components[1], side_two_set_one: components[2], side_one_set_two: components[3], side_two_set_two: components[4], side_one_set_three: components[5], side_two_set_three: components[6], side_one_points: components[7], side_two_points: components[8], court_revision: Math.max(1, integer(row.court_revision, source, "court_revision", { min: 0 })), source_instance: String(row.instance), source_sequence: sequence, source_key: String(row.event_id), source_sha256: sha256([row.instance, code, sequence, row.score, match]) });
  }
  for (const [key, maximum] of maximums) if ((observed.get(key) || 0) !== maximum) fail("SCORE_SEQUENCE_MISMATCH", "scorelog.sqlite:score_log_sequence", "last_sequence");
}

function transformMessaging(database, tables, refs, findings, exportStartedAt) {
  const eventRefs = new Map(), recipientRefs = new Map(), commentRefs = new Map();
  for (const row of rows(database, "competition_events")) {
    const competitionContract = String(row.competition_id ?? "").trim(), competition = competitionContract ? refs.competitions.get(competitionContract)?.id : null;
    if (competitionContract && !competition) fail("MESSAGE_COMPETITION_REFERENCE_MISSING", "messaging.sqlite:competition_events", "competition_id");
    const id = uuid(row.event_id, "message-event"), actor = refs.people.get(String(row.actor_id));
    if (!actor) fail("MESSAGE_ACTOR_REFERENCE_MISSING", "messaging.sqlite:competition_events", "actor_id");
    const eventType = String(row.event_type).trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
    if (!/^[a-z][a-z0-9_.-]{1,126}$/.test(eventType)) fail("MESSAGE_EVENT_TYPE_INVALID", "messaging.sqlite:competition_events", "event_type");
    const sourceType = String(row.source ?? "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_") || null;
    if (sourceType && !/^[a-z][a-z0-9_.-]{0,62}$/.test(sourceType)) fail("MESSAGE_SOURCE_TYPE_INVALID", "messaging.sqlite:competition_events", "source");
    const sourceContractId = text(row.source_id, { max: 160, source: "messaging.sqlite:competition_events", projection: "source_id" });
    const match = sourceType === "match" ? refs.matches.get(String(row.source_id)) || null : null;
    tables.events.push({
      id, tenant_id: TENANT_ID, contract_id: contractId(row.event_id, "messaging.sqlite:competition_events"), event_type: eventType,
      template_key: `legacy.${eventType}`, template_version: 1, template_parameters: {}, competition_id: competition,
      match_id: match, match_result_history_id: null, source_type: sourceType, source_contract_id: sourceContractId,
      actor_person_id: actor, actor_contract_id_snapshot: String(row.actor_id),
      actor_name_snapshot: text(row.actor_name, { max: 200, source: "messaging.sqlite:competition_events", projection: "actor_name" }),
      summary_snapshot: text(row.summary, { max: 2000, source: "messaging.sqlite:competition_events", projection: "summary" }),
      detail_snapshot: text(row.detail, { max: 16000, source: "messaging.sqlite:competition_events", projection: "detail" }),
      result_snapshot: text(row.result, { max: 500, source: "messaging.sqlite:competition_events", projection: "result" }),
      source_operation_id: stableUuid("legacy-message-operation", row.event_id),
      created_at: instant(row.created_at, "messaging.sqlite:competition_events", "created_at", { unixMs: true, optional: false }),
    });
    eventRefs.set(String(row.event_id), { id, actor, actorName: String(row.actor_name), subject: String(row.summary), body: String(row.detail) });
  }
  const messageCutoff = cutoff(exportStartedAt, 24);
  for (const row of rows(database, "event_participants")) {
    const event = eventRefs.get(String(row.event_id)), person = refs.people.get(String(row.user_id));
    if (!event || !person) fail("MESSAGE_PARTICIPANT_REFERENCE_MISSING", "messaging.sqlite:event_participants", "reference");
    const personRow = [...refs.people.entries()].find(([, id]) => id === person);
    const display = String(row.display_name ?? "").trim().split(/\s+/), recipientId = uuid(row.message_id, "message-recipient");
    tables.event_participants.push({ event_id: event.id, person_id: person, participant_role: String(row.participant_role).trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_"), contract_id_snapshot: personRow?.[0] || String(row.user_id), first_name_snapshot: display.length > 1 ? display.slice(0, -1).join(" ") : null, last_name_snapshot: display.at(-1) || "Unbekannt" });
    const inboxVisible = legacyBoolean(row.inbox_visible, "messaging.sqlite:event_participants", "inbox_visible");
    if (inboxVisible) {
      tables.event_recipients.push({ id: recipientId, event_id: event.id, person_id: person, template_key: `legacy.${String(row.projection_type).toLowerCase().replace(/[^a-z0-9_.-]/g, "_") || "message"}`, template_version: 1, template_parameters: {}, legacy_subject: String(row.subject), legacy_body: String(row.body), created_at: tables.events.find((item) => item.id === event.id).created_at });
      recipientRefs.set(`${row.event_id}:${row.user_id}`, recipientId);
    }
  }
  for (const row of rows(database, "event_receipts")) {
    const recipient = recipientRefs.get(`${row.event_id}:${row.user_id}`);
    if (!recipient) { addFinding(findings, "MESSAGE_HIDDEN_RECEIPT_DISCARDED", "messaging.sqlite", "info"); continue; }
    const acknowledged = instant(row.acknowledged_at, "messaging.sqlite:event_receipts", "acknowledged_at", { unixMs: true });
    if (!acknowledged || Number(row.acknowledged_at) >= messageCutoff) tables.receipts.push({ recipient_id: recipient, read_at: acknowledged, acknowledged_at: acknowledged, revision: 1 });
  }
  for (const row of rows(database, "event_deliveries")) {
    if (Number(row.updated_at) < messageCutoff) { addFinding(findings, "MESSAGE_DELIVERY_EXPIRED", "messaging.sqlite"); continue; }
    if (row.channel === "Inbox") { addFinding(findings, "MESSAGE_INTERNAL_DELIVERY_DISCARDED", "messaging.sqlite", "info"); continue; }
    const recipient = recipientRefs.get(`${row.event_id}:${row.user_id}`);
    if (!recipient) { addFinding(findings, "MESSAGE_HIDDEN_DELIVERY_DISCARDED", "messaging.sqlite", "info"); continue; }
    const channel = String(row.channel), status = row.status === "delivered" ? "sent" : String(row.status);
    if (!["email", "whatsapp"].includes(channel) || !["not_configured", "pending", "sent", "failed"].includes(status)) fail("MESSAGE_DELIVERY_INVALID", "messaging.sqlite:event_deliveries", "status");
    tables.deliveries.push({ id: stableUuid("delivery", `${row.event_id}:${row.user_id}:${channel}`), recipient_id: recipient, channel, status, idempotency_key: sha256([row.event_id, row.user_id, channel]), attempt_count: status === "pending" ? 0 : 1, updated_at: instant(row.updated_at, "messaging.sqlite:event_deliveries", "updated_at", { unixMs: true, optional: false }) });
  }
  for (const row of rows(database, "event_comments")) {
    const event = eventRefs.get(String(row.event_id)), author = refs.people.get(String(row.author_id));
    if (!event || !author) fail("MESSAGE_COMMENT_REFERENCE_MISSING", "messaging.sqlite:event_comments", "reference");
    const id = uuid(row.comment_id, "comment"), display = String(row.author_name ?? "").trim().split(/\s+/);
    const status = String(row.status);
    if (!new Set(["visible", "under_review"]).has(status)) fail("MESSAGE_COMMENT_STATUS_INVALID", "messaging.sqlite:event_comments", "status");
    const moderatedBy = row.moderated_by === null || row.moderated_by === undefined ? null : refs.people.get(String(row.moderated_by));
    if (row.moderated_by !== null && row.moderated_by !== undefined && !moderatedBy) fail("MESSAGE_MODERATOR_REFERENCE_MISSING", "messaging.sqlite:event_comments", "moderated_by");
    tables.comments.push({
      id, event_id: event.id, author_person_id: author, author_contract_id_snapshot: String(row.author_id),
      author_first_name_snapshot: display.length > 1 ? display.slice(0, -1).join(" ") : null,
      author_last_name_snapshot: display.at(-1) || null, body: String(row.body),
      created_at: instant(row.created_at, "messaging.sqlite:event_comments", "created_at", { unixMs: true, optional: false }),
      updated_at: instant(row.updated_at, "messaging.sqlite:event_comments", "updated_at", { unixMs: true }),
      moderation_status: status,
      moderated_at: instant(row.moderated_at, "messaging.sqlite:event_comments", "moderated_at", { unixMs: true }),
      moderated_by_person_id: moderatedBy,
      revision: 1,
    });
    commentRefs.set(String(row.comment_id), id);
  }
  for (const [table, target] of [["comment_reactions", "comment"], ["event_reactions", "event"]]) for (const row of rows(database, table)) {
    const person = refs.people.get(String(row.user_id)), targetId = target === "comment" ? commentRefs.get(String(row.comment_id)) : eventRefs.get(String(row.event_id))?.id;
    if (!person || !targetId) fail("MESSAGE_REACTION_REFERENCE_MISSING", `messaging.sqlite:${table}`, "reference");
    tables.reactions.push({ id: stableUuid("reaction", `${table}:${targetId}:${person}`), event_id: target === "event" ? targetId : null, comment_id: target === "comment" ? targetId : null, person_id: person, reaction_key: String(row.reaction_key), created_at: instant(row.created_at, `messaging.sqlite:${table}`, "created_at", { unixMs: true, optional: false }) });
  }
  for (const row of rows(database, "messaging_revisions")) {
    const person = refs.people.get(String(row.user_id));
    if (!person) fail("MESSAGE_REVISION_REFERENCE_MISSING", "messaging.sqlite:messaging_revisions", "user_id");
    tables.user_revisions.push({ person_id: person, revision: integer(row.revision, "messaging.sqlite:messaging_revisions", "revision", { min: 0 }) });
  }
  for (const table of ["event_ack_operations", "message_bulk_ack_operations", "event_interaction_operations"]) {
    const count = rows(database, table).length;
    if (count) addFinding(findings, "MESSAGE_IDEMPOTENCY_ARCHIVED", `messaging.sqlite:${table}`, "info", count);
  }
  const revisionRows = rows(database, "competition_history_revision");
  if (revisionRows.length !== 1 || Number(revisionRows[0].singleton) !== 1) fail("MESSAGE_REVISION_INVALID", "messaging.sqlite:competition_history_revision", "singleton");
  tables.history_revision.push({ singleton: true, revision: integer(revisionRows[0].revision, "messaging.sqlite:competition_history_revision", "revision", { min: 0 }) });
}

function transformAudit(database, tables, refs, findings, exportStartedAt) {
  const auditCutoff = cutoff(exportStartedAt, 12);
  for (const row of rows(database, "audit_log")) {
    const occurredAt = instant(row.occurred_at, "audit.sqlite:audit_log", "occurred_at", { optional: false });
    if (Temporal.Instant.from(occurredAt).epochMilliseconds < auditCutoff) { addFinding(findings, "AUDIT_EXPIRED", "audit.sqlite"); continue; }
    const actorRaw = String(row.actor_id ?? "").trim(), actor = actorRaw ? refs.people.get(actorRaw) : null;
    if (actorRaw && !actor && row.actor_type === "user") fail("AUDIT_ACTOR_REFERENCE_MISSING", "audit.sqlite:audit_log", "actor_id");
    if (!["started", "success", "failed", "unknown"].includes(String(row.result))) fail("AUDIT_RESULT_INVALID", "audit.sqlite:audit_log", "result");
    const actorType = row.actor_type === "device" ? "monitor" : String(row.actor_type);
    if (!new Set(["anonymous", "user", "monitor", "system"]).has(actorType)) fail("AUDIT_ACTOR_TYPE_INVALID", "audit.sqlite:audit_log", "actor_type");
    const operationId = uuid(row.operation_id || row.event_id, "audit-operation"), id = stableUuid("audit-operation-row", operationId);
    tables.audit_operations.push({ id, tenant_id: TENANT_ID, operation_id: operationId, actor_person_id: actor, actor_type: actorType, actor_name_snapshot: text(row.actor_name, { max: 200, source: "audit.sqlite:audit_log", projection: "actor_name" }), role_snapshot: text(row.role, { max: 100, source: "audit.sqlite:audit_log", projection: "role" }), action: String(row.action).toLowerCase().replace(/[^a-z0-9_.-]/g, "_"), subject_type: text(row.target_type, { max: 100, source: "audit.sqlite:audit_log", projection: "target_type" }), subject_id: text(row.target_id, { max: 200, source: "audit.sqlite:audit_log", projection: "target_id" }), subject_name_snapshot: text(row.target_name, { max: 200, source: "audit.sqlite:audit_log", projection: "target_name" }), request_id: text(row.request_id, { max: 200, source: "audit.sqlite:audit_log", projection: "request_id" }), status: String(row.result), source_instance: String(row.instance), before_projection: jsonObject(row.before_json, "audit.sqlite:audit_log", "before_json", { nullable: true }), after_projection: jsonObject(row.after_json, "audit.sqlite:audit_log", "after_json", { nullable: true }), started_at: occurredAt, completed_at: row.result === "started" ? null : instant(row.updated_at, "audit.sqlite:audit_log", "updated_at", { unixMs: true, optional: false }), expires_at: Temporal.Instant.from(occurredAt).toZonedDateTimeISO("UTC").add({ months: 12 }).toInstant().toString({ smallestUnit: "millisecond" }) });
    if (String(row.source_ip || row.attempted_email || row.attempted_login).trim()) tables.audit_security_context.push({ audit_operation_id: id, source_ip: text(row.source_ip, { max: 64, source: "audit.sqlite:audit_log", projection: "source_ip" }), attempted_login: text(row.attempted_login, { max: 254, source: "audit.sqlite:audit_log", projection: "attempted_login" }), attempted_email: text(row.attempted_email, { max: 254, source: "audit.sqlite:audit_log", projection: "attempted_email" }) });
    tables.audit_transitions.push({ id: uuid(row.event_id, "audit-transition"), audit_operation_id: id, transition: String(row.result), occurred_at: occurredAt, error_code: text(row.error_code, { max: 100, source: "audit.sqlite:audit_log", projection: "error_code" }) });
  }
}

function transformSqlite(root, refs, manifest) {
  const tables = sqliteTables(), findings = new Map(), localRefs = { ...refs, courts: new Map(), site: null };
  for (const [source, relative] of Object.entries(SQLITE_FILES)) {
    const database = new DatabaseSync(path.join(root, ...relative.split("/")), { readOnly: true });
    try {
      if (source === "state.sqlite") transformState(database, tables, localRefs, findings, manifest.exportStartedAt);
      else if (source === "scorelog.sqlite") transformScore(database, tables, localRefs);
      else if (source === "messaging.sqlite") transformMessaging(database, tables, localRefs, findings, manifest.exportStartedAt);
      else transformAudit(database, tables, localRefs, findings, manifest.exportStartedAt);
    } finally { database.close(); }
  }
  return { tables, findings: [...findings.values()] };
}

module.exports = { transformSqlite };
