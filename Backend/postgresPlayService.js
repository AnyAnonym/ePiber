"use strict";

const crypto = require("crypto");
const { AppError } = require("./errors.js");
const dataStore = require("./dataStore.js");
const { analyzeMatchRules, matchCompletionFingerprint, parseMatchDate } = require("./matchRules.js");
const { validateCompletion } = require("./matchResultRules.js");
const { headerIndex, headerOf } = require("./tableUtils.js");
const { requestHash } = require("./postgresCompetitionService.js");
const { personFingerprint, projectPeopleNormalization } = require("./peopleNormalization.js");
const { projectPeopleReconciliation } = require("./memberReconciliation.js");
const { Temporal } = require("@js-temporal/polyfill");
const { rankingEntryRestriction } = require("./rankingEntryRestriction");
const { competitionLifecycle } = require("./competitionLifecycle");
const { createDomainMessage } = require("./postgresDomainMessages");
const { legacyInstant } = require("./postgresProjectionService");

function hasRole(principal, role) { return principal?.role === role || principal?.roles?.includes?.(role); }
function stableId(prefix, operationId) { return `${prefix}-${crypto.createHash("sha256").update(String(operationId)).digest("hex").slice(0, 32)}`; }
function eventId(operationId, type) { return `event-${crypto.createHash("sha256").update(`${operationId}:${type}`).digest("hex").slice(0, 32)}`; }

class PostgresPlayService {
  constructor({ play, identity, messaging, ops, projectionLoader, log = () => {}, now = Date.now }) {
    this.play = play; this.identity = identity; this.messaging = messaging; this.ops = ops; this.projectionLoader = projectionLoader; this.log = log; this.now = now;
  }
  status() { return { backend: "postgres", ready: true, activeWrites: 0 }; }
  stop() { return Promise.resolve(); }
  async refreshSheetData(_principal, { operationId }) {
    const result = await this.projectionLoader.refresh("admin-request");
    return { success: true, operationId, tableCount: result.tableCount, changedTableCount: result.changedTables.length, refreshedAt: Date.now() };
  }

  repeated(operation) {
    if (!operation.repeated) return null;
    if (operation.status === "success") return { ...operation.response, repeated: true };
    throw new AppError(operation.status === "unknown" ? "WRITE_OUTCOME_UNKNOWN" : "OPERATION_IN_PROGRESS", "Ausgang der Operation ist unklar", operation.status === "unknown" ? 503 : 409);
  }
  mapError(error) {
    if (error instanceof AppError) return error;
    if (error.code === "IDEMPOTENCY_CONFLICT") return new AppError("IDEMPOTENCY_CONFLICT", "Operation-ID wurde mit anderen Daten verwendet", 409);
    if (error.code === "23505") return new AppError("WRITE_CONFLICT", "Daten wurden gleichzeitig geändert", 409);
    return error;
  }
  async execute(principal, operationId, command, payload, callback) {
    try {
      const result = await this.play.database.withTransaction(command, async (transaction) => {
        const operation = await this.ops.beginIdempotencyOn(transaction, { operationId, actorPersonId: principal.id, command, requestHash: requestHash(payload) });
        const prior = this.repeated(operation); if (prior) return prior;
        const response = await callback(transaction);
        await this.ops.queueInvalidation(transaction, { operationId, projection: command.startsWith("person.") ? "identity" : "play", eventId: response.matchId || response.personId || response.bewerbId || response.newMatchId || operationId });
        await this.ops.completeIdempotency(transaction, { operationId, command, status: "success", response });
        return response;
      }, { isolation: "serializable", retries: 2 });
      await this.projectionLoader.refresh(command);
      return result;
    } catch (error) { throw this.mapError(error); }
  }

  competitionRow(competitionId) {
    const values = dataStore.get("bewerbe"), header = headerOf(values), id = headerIndex(header, "id");
    const row = values.slice(1).find((entry) => String(entry[id] || "") === String(competitionId));
    if (!row) throw new AppError("COMPETITION_NOT_FOUND", "Bewerb wurde nicht gefunden", 404);
    return { values, header, row };
  }
  rankingContext(principal, competitionId) {
    const { header: competitionHeader, row: competition } = this.competitionRow(competitionId);
    if (String(competition[headerIndex(competitionHeader, "bewerbsartid")] || "") !== "2") throw new AppError("RANKING_REQUIRED", "Bewerb ist keine Rangliste", 409);
    const { competitionEndAt, competitionEnded } = competitionLifecycle(competition[headerIndex(competitionHeader, "bewerbsende")], this.now());
    const players = dataStore.get("players"), playerHeader = headerOf(players), playerId = headerIndex(playerHeader, "id"), activeIndex = headerIndex(playerHeader, "aktiv");
    const person = players.slice(1).find((row) => String(row[playerId] || "") === String(principal.id));
    if (!person || (activeIndex >= 0 && String(person[activeIndex] || "") !== "1")) throw new AppError("PLAYER_NOT_ACTIVE", "Spieler ist nicht aktiv", 409);
    const rankings = dataStore.get("rlPlatzierung"), header = headerOf(rankings);
    const indexes = { competition: headerIndex(header, "bewerbid"), person: headerIndex(header, "personid"), rank: headerIndex(header, "rang"), previous: headerIndex(header, "rausgehangenletzteplatzierung"), withdrawn: headerIndex(header, "rausgehangenam") };
    const all = rankings.slice(1).filter((row) => String(row[indexes.competition] || "") === String(competitionId)).map((row) => ({ id: String(row[indexes.person] || ""), rank: Number(row[indexes.rank]), previousRank: Number(row[indexes.previous]), withdrawnAt: String(row[indexes.withdrawn] || "") }));
    const entries = all.filter(({ rank }) => Number.isInteger(rank) && rank > 0).sort((a, b) => a.rank - b.rank);
    const own = all.find(({ id }) => id === String(principal.id));
    if (own?.rank > 0) return { mode: "ranked", rank: own.rank, returnFromRank: null, entries, competitionEndAt, competitionEnded };
    if (own?.rank === 0 && own.previousRank > 0) {
      const withdrawn = parseMatchDate(own.withdrawnAt); if (withdrawn) { withdrawn.setFullYear(withdrawn.getFullYear() + 1); if (withdrawn.getTime() >= this.now()) return { mode: "returning", rank: null, returnFromRank: own.previousRank, entries, competitionEndAt, competitionEnded }; }
    }
    const genderText = String(competition[headerIndex(competitionHeader, "geschlecht")] || "");
    if (genderText) {
      const allowed = genderText.split(/[|,]/).map((value) => value.trim()).filter(Boolean), genderIndex = headerIndex(playerHeader, "geschlechtid", "geschlecht");
      if (!allowed.includes(String(person[genderIndex] || "").trim())) throw new AppError("RANKING_ENTRY_NOT_ELIGIBLE", "Geschlecht passt nicht zum Ranglistenbewerb", 409);
    }
    const ageRule = String(competition[headerIndex(competitionHeader, "alterskategorie")] || "0+").match(/^(\d{1,3})([+-])$/);
    if (ageRule && ageRule[1] !== "0") {
      const birth = String(person[headerIndex(playerHeader, "geburtsdatum")] || "").match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!birth) throw new AppError("RANKING_ENTRY_NOT_ELIGIBLE", "Geburtsdatum fehlt", 409);
      const age = new Date(this.now()).getFullYear() - Number(birth[3]), limit = Number(ageRule[1]);
      if (ageRule[2] === "+" ? age < limit : age > limit) throw new AppError("RANKING_ENTRY_NOT_ELIGIBLE", "Alter passt nicht zum Ranglistenbewerb", 409);
    }
    const entryRestriction = rankingEntryRestriction(dataStore.get("matches1"), competitionId, principal.id, this.now());
    return { mode: "newcomer", rank: null, returnFromRank: null, entryRestriction, entries, competitionEndAt, competitionEnded };
  }
  rankingChallengeState(principal, competitionId) {
    try { const { entries: _entries, ...value } = this.rankingContext(principal, competitionId); return { success: true, ...value }; }
    catch (error) {
      if (error.code === "RANKING_ENTRY_NOT_ELIGIBLE") {
        const { header, row } = this.competitionRow(competitionId);
        const { competitionEndAt, competitionEnded } = competitionLifecycle(row[headerIndex(header, "bewerbsende")], this.now());
        return { success: true, mode: "ineligible", rank: null, returnFromRank: null, competitionEndAt, competitionEnded };
      }
      throw error;
    }
  }
  challengeEligibility(principal, competitionId, opponentId) {
    if (String(principal.id) === String(opponentId)) return { allowed: false, code: "MATCH_SELF" };
    try {
      const context = this.rankingContext(principal, competitionId); if (context.competitionEnded) throw new AppError("COMPETITION_ENDED", "Bewerb ist beendet", 409);
      const opponentIndex = context.entries.findIndex(({ id }) => id === String(opponentId)); if (opponentIndex < 0) throw new AppError("RANKING_MEMBERSHIP_REQUIRED", "Gegner ist nicht gereiht", 409);
      if (context.mode === "returning") { if (context.entries[opponentIndex].rank < context.returnFromRank) throw new AppError("CHALLENGE_NOT_ALLOWED", "Spieler kann nicht gefordert werden", 409); }
      else if (context.mode === "newcomer" && context.entryRestriction?.active && context.entries[opponentIndex].rank < context.entryRestriction.minimumRank) throw new AppError("CHALLENGE_NOT_ALLOWED", "Einstiegsforderung liegt vor dem erlaubten Rang", 409);
      else if (context.mode === "ranked") {
        const rows = []; for (let index = 0, size = 1; index < context.entries.length; size++) { rows.push(context.entries.slice(index, index + size)); index += size; }
        let rowIndex = -1, column = -1; for (const [index, row] of rows.entries()) { const found = row.findIndex(({ id }) => id === String(principal.id)); if (found >= 0) { rowIndex = index; column = found; break; } }
        const allowed = new Set(); for (let index = 0; index < column; index++) allowed.add(rows[rowIndex][index].id); for (let index = column; index < (rows[rowIndex - 1] || []).length; index++) allowed.add(rows[rowIndex - 1][index].id);
        if (context.rank === 3) allowed.add(context.entries.find(({ rank }) => rank === 1)?.id);
        if (!allowed.has(String(opponentId))) throw new AppError("CHALLENGE_NOT_ALLOWED", "Spieler kann nicht gefordert werden", 409);
      }
      const rules = analyzeMatchRules(dataStore.get("matches1"), competitionId, new Date(this.now()));
      if (rules.busyIds.has(String(principal.id)) || rules.busyIds.has(String(opponentId))) throw new AppError("PLAYER_BUSY", "Spieler hat bereits eine offene Forderung", 409);
      if (rules.blocked.has(String(principal.id))) throw new AppError("PLAYER_BLOCKED", "Eigene Sperrzeit ist aktiv", 409);
      if (rules.protection.has(String(opponentId))) throw new AppError("OPPONENT_PROTECTED", "Gegnerische Schonzeit ist aktiv", 409);
      return { allowed: true, code: "" };
    } catch (error) { return error instanceof AppError ? { allowed: false, code: error.code } : (() => { throw error; })(); }
  }

  async addMatch(principal, params) {
    const eligibility = this.challengeEligibility(principal, params.bewerbId, params.opponentId);
    if (!eligibility.allowed) throw new AppError(eligibility.code, "Forderung ist nicht erlaubt", 409);
    const matchId = stableId("m", params.operationId);
    return this.execute(principal, params.operationId, "match.add", { competitionId: params.bewerbId, opponentId: params.opponentId }, async (transaction) => {
      const result = await transaction.query(`
        WITH context AS (
          SELECT competition.id AS competition_id,competition.default_match_format_version_id AS format_id,challenger.id AS challenger_id,opponent.id AS opponent_id
            FROM play.competitions competition JOIN core.sections section ON section.id=competition.section_id
            JOIN identity.people challenger ON challenger.tenant_id=section.tenant_id AND challenger.contract_id=$3 AND challenger.active
            JOIN identity.people opponent ON opponent.tenant_id=section.tenant_id AND opponent.contract_id=$4 AND opponent.active
           WHERE section.tenant_id=$1::uuid AND competition.contract_id=$2 AND competition.default_match_format_version_id IS NOT NULL
        ), inserted AS (
          INSERT INTO play.matches(competition_id,contract_id,match_format_version_id,format_binding_source,challenged_at)
          SELECT competition_id,$5,format_id,'competition_default',clock_timestamp() FROM context RETURNING id
        ), sides AS (
          INSERT INTO play.match_sides(match_id,side_no) SELECT id,side_no FROM inserted CROSS JOIN (VALUES (1),(2)) value(side_no) RETURNING id,match_id,side_no
        )
        INSERT INTO play.match_participants(match_id,side_id,position_no,participant_type,person_id)
        SELECT sides.match_id,sides.id,1,'person',CASE sides.side_no WHEN 1 THEN context.challenger_id ELSE context.opponent_id END FROM sides,context
        RETURNING match_id
      `, [this.play.context.tenantId, params.bewerbId, String(principal.id), params.opponentId, matchId]);
      if (!result.rowCount) throw new AppError("MATCH_CONTEXT_INVALID", "Forderungskontext wurde nicht gefunden", 409);
      // Recheck the persistent entry boundary inside the serializable write,
      // independently of the UI/cache. Snapshot the target before it can move.
      const entry = await transaction.query(`SELECT opponent.rank,
        own.status AS own_status, own.withdrawn_at,
        (SELECT result.entry_minimum_rank FROM play.matches prior
          JOIN play.match_results result ON result.id=prior.current_result_id
          JOIN play.match_participants participant ON participant.match_id=prior.id
          JOIN play.match_sides side ON side.id=participant.side_id AND side.side_no=1
          WHERE prior.competition_id=match.competition_id AND participant.person_id=challenger.id
            AND NOT prior.is_ignored AND result.winner_side_no=2 AND result.entry_expires_at>clock_timestamp()
          ORDER BY result.entry_expires_at DESC LIMIT 1) AS minimum_rank
        FROM play.matches match JOIN identity.people challenger ON challenger.tenant_id=$2::uuid AND challenger.contract_id=$3
        JOIN identity.people defender ON defender.tenant_id=$2::uuid AND defender.contract_id=$4
        JOIN play.ranking_entries opponent ON opponent.competition_id=match.competition_id AND opponent.person_id=defender.id AND opponent.status='active'
        LEFT JOIN play.ranking_entries own ON own.competition_id=match.competition_id AND own.person_id=challenger.id
        WHERE match.id=$1::uuid`, [result.rows[0].match_id, this.play.context.tenantId, String(principal.id), params.opponentId]);
      const state = entry.rows[0];
      if (!state) throw new AppError("RANKING_MEMBERSHIP_REQUIRED", "Gegner ist nicht gereiht", 409);
      const returning = state.own_status === "withdrawn" && state.withdrawn_at && Temporal.Instant.from(new Date(state.withdrawn_at).toISOString()).toZonedDateTimeISO("Europe/Vienna").add({ years: 1 }).epochMilliseconds > this.now();
      if (state.own_status !== "active" && !returning) {
        if (state.minimum_rank && state.rank < state.minimum_rank) throw new AppError("CHALLENGE_NOT_ALLOWED", "Einstiegsforderung liegt vor dem erlaubten Rang", 409);
        await transaction.query("UPDATE play.matches SET entry_target_rank=$2 WHERE id=$1::uuid", [result.rows[0].match_id, state.rank]);
      }
      await createDomainMessage(this.messaging, {
        contractId: eventId(params.operationId, "challenge"), eventType: "match.challenge.created", operationId: params.operationId,
        templateParameters: { matchId, competitionId: params.bewerbId }, competitionId: params.bewerbId, matchId,
        participants: [{ personId: String(principal.id), role: "challenger" }, { personId: params.opponentId, role: "challenged" }],
        recipients: [String(principal.id), params.opponentId], readPersonIds: [String(principal.id)], sourceType: "match", sourceId: matchId,
        actorPersonId: String(principal.id), actorName: principal.name || null, summary: `${principal.name || principal.id} hat eine Forderung erstellt.`,
      }, transaction);
      return { success: true, newMatchId: matchId };
    });
  }

  async lockMatch(transaction, matchId) {
    const result = await transaction.query(`SELECT match.id,match.contract_id,match.competition_id,match.match_format_version_id,match.current_result_id,match.scheduled_at,match.challenged_at,match.revision,
      competition.contract_id AS competition_contract_id,type.contract_id AS competition_type_id,type_version.bracket_size,
       result.first_captured_at,result.play_started_at,result.play_ended_at,result.winner_side_no,match.entry_target_rank,result.entry_expires_at
      FROM play.matches match JOIN play.competitions competition ON competition.id=match.competition_id JOIN core.sections section ON section.id=competition.section_id
      JOIN play.competition_type_versions type_version ON type_version.id=competition.competition_type_version_id JOIN play.competition_types type ON type.id=type_version.competition_type_id
      LEFT JOIN play.match_results result ON result.id=match.current_result_id
      WHERE section.tenant_id=$1::uuid AND match.contract_id=$2 FOR UPDATE OF match`, [this.play.context.tenantId, matchId]);
    if (!result.rowCount) throw new AppError("MATCH_NOT_FOUND", "Match wurde nicht gefunden", 404); return result.rows[0];
  }
  async participants(transaction, internalMatchId) {
    const result = await transaction.query(`SELECT side.side_no,participant.position_no,person.contract_id AS person_id,person.id AS internal_person_id
      FROM play.match_sides side JOIN play.match_participants participant ON participant.side_id=side.id LEFT JOIN identity.people person ON person.id=participant.person_id
      WHERE side.match_id=$1::uuid ORDER BY side.side_no,participant.position_no`, [internalMatchId]); return result.rows;
  }
  assertParticipant(principal, participants) { if (!hasRole(principal, "admin") && !participants.some(({ person_id }) => person_id === String(principal.id))) throw new AppError("MATCH_PARTICIPANT_REQUIRED", "Nur Matchbeteiligte dürfen diese Änderung durchführen", 403); }

  async appointment(principal, params, { clear = false, admin = false } = {}) {
    if (admin && !hasRole(principal, "admin")) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    const command = clear ? (admin ? "match.appointment.admin_clear" : "match.appointment.clear") : (admin ? "match.appointment.admin_set" : "match.appointment.set");
    return this.execute(principal, params.operationId, command, { matchId: params.matchId, matchDate: clear ? "none" : params.matchDate, reason: params.reason || "none" }, async (transaction) => {
      const match = await this.lockMatch(transaction, params.matchId), people = await this.participants(transaction, match.id); this.assertParticipant(principal, people);
      if (match.current_result_id) throw new AppError("MATCH_APPOINTMENT_CLOSED", "Abgeschlossenes Match kann nicht geändert werden", 409);
      const scheduledAt = clear ? null : parseMatchDate(params.matchDate); if (!clear && !scheduledAt) throw new AppError("VALIDATION_ERROR", "Spieltermin ist ungültig", 400);
      await transaction.query("UPDATE play.matches SET scheduled_at=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [match.id, scheduledAt]);
      const recipientIds = people.map(({ person_id }) => person_id).filter(Boolean);
      await createDomainMessage(this.messaging, {
        contractId: eventId(params.operationId, clear ? "appointment-cleared" : "appointment-set"), eventType: clear ? "match.appointment.cleared" : "match.appointment.set", operationId: params.operationId,
        templateParameters: { matchId: params.matchId, competitionId: match.competition_contract_id, ...(!clear ? { scheduledAt: scheduledAt.toISOString() } : {}) },
        competitionId: match.competition_contract_id, matchId: params.matchId, participants: recipientIds.map((personId, index) => ({ personId, role: `participant_${index + 1}` })),
        recipients: recipientIds, readPersonIds: [String(principal.id)], sourceType: "match", sourceId: params.matchId,
        actorPersonId: String(principal.id), actorName: principal.name || null, summary: clear ? "Spieltermin wurde abgesagt." : "Spieltermin wurde festgelegt.", detail: admin ? params.reason : null,
        messageContext: { previousDate: legacyInstant(match.scheduled_at), matchDate: clear ? "" : params.matchDate },
      }, transaction);
      return { success: true, matchId: params.matchId, matchDate: clear ? "" : params.matchDate };
    });
  }
  setMatchAppointment(principal, params) { return this.appointment(principal, params); }
  adminSetMatchAppointment(principal, params) { return this.appointment(principal, params, { admin: true }); }
  clearMatchAppointment(principal, params) { return this.appointment(principal, params, { clear: true }); }
  adminClearMatchAppointment(principal, params) { return this.appointment(principal, params, { clear: true, admin: true }); }

  cachedFingerprint(matchId) {
    const values = dataStore.get("matches1"), header = headerOf(values), id = headerIndex(header, "id"), row = values.slice(1).find((entry) => String(entry[id] || "") === String(matchId));
    if (!row) throw new AppError("MATCH_NOT_FOUND", "Match wurde nicht gefunden", 404);
    return { fingerprint: matchCompletionFingerprint(row, header), row, header };
  }
  rulesFromDatabase(row) {
    const deciding = { full_set: "vollstaendiger Satz", match_tiebreak_7: "MT7", match_tiebreak_10: "MT10" }[row.deciding_set_type];
    return { winningSets: row.sets_to_win, setTarget: row.set_target_games, decidingSet: deciding };
  }
  async rankingTargets(transaction, match, participants, winnerSide, rankPlan = null) {
    if (match.competition_type_id !== "2") { if (rankPlan) throw new AppError("RANKING_MATCH_REQUIRED", "Rangplan ist nur für Ranglistenmatches erlaubt", 409); return []; }
    const rows = await transaction.query(`SELECT ranking.id,person.contract_id AS person_id,ranking.status,ranking.rank,ranking.last_active_rank,ranking.withdrawn_at
      FROM play.ranking_entries ranking JOIN identity.people person ON person.id=ranking.person_id WHERE ranking.competition_id=$1::uuid ORDER BY ranking.rank NULLS LAST FOR UPDATE OF ranking`, [match.competition_id]);
    const values = rows.rows, byPerson = new Map(values.map((entry) => [entry.person_id, entry]));
    if (rankPlan) {
      if (rankPlan.length !== values.length || rankPlan.some(({ personId }) => !byPerson.has(personId))) throw new AppError("RANK_PLAN_INCOMPLETE", "Rangplan muss alle Mitglieder enthalten", 409);
      return rankPlan.map((entry) => { const current = byPerson.get(entry.personId); const before = current.status === "active" ? current.rank : 0; if (before !== entry.expectedRank) throw new AppError("RANK_CONFLICT", "Rang wurde geändert", 409); return { row: current, beforeRank: before, afterRank: entry.newRank }; });
    }
    const challengerId = participants.find(({ side_no }) => side_no === 1)?.person_id, defenderId = participants.find(({ side_no }) => side_no === 2)?.person_id;
    const challenger = byPerson.get(challengerId), defender = byPerson.get(defenderId); if (!defender?.rank) throw new AppError("RANKING_REPAIR_REQUIRED", "Rangliste muss repariert werden", 409);
    const active = values.filter(({ status }) => status === "active");
    if (!challenger) {
      if (winnerSide !== 1 && active.some(({ rank }) => rank === (match.entry_target_rank || defender.rank) + 10)) return [];
      const afterRank = winnerSide === 1 ? defender.rank : Math.max(...active.map(({ rank }) => rank)) + 1;
      const person = participants.find(({ side_no }) => side_no === 1);
      return [...(winnerSide === 1 ? active.filter(({ rank }) => rank >= defender.rank).map((row) => ({ row, beforeRank: row.rank, afterRank: row.rank + 1 })) : []), { row: { id: null, person_id: challengerId, internal_person_id: person.internal_person_id }, beforeRank: null, afterRank }];
    }
    const challengerRank = challenger.status === "active" ? challenger.rank : 0;
    if (challengerRank === 0) {
      const expires = challenger.withdrawn_at ? new Date(challenger.withdrawn_at) : null; expires?.setFullYear(expires.getFullYear() + 1);
      if (match.entry_target_rank && winnerSide !== 1 && active.some(({ rank }) => rank === match.entry_target_rank + 10)) return [];
      const returning = expires && expires.getTime() >= this.now(); const insertion = winnerSide === 1 ? defender.rank : returning ? defender.rank + 1 : Math.max(...active.map(({ rank }) => rank)) + 1;
      return [...active.filter(({ rank }) => rank >= insertion).map((row) => ({ row, beforeRank: row.rank, afterRank: row.rank + 1 })), { row: challenger, beforeRank: 0, afterRank: insertion }];
    }
    if (winnerSide !== 1 || challengerRank <= defender.rank) return [];
    return values.flatMap((row) => row.person_id === challengerId ? [{ row, beforeRank: challengerRank, afterRank: defender.rank }] : row.status === "active" && row.rank >= defender.rank && row.rank < challengerRank ? [{ row, beforeRank: row.rank, afterRank: row.rank + 1 }] : []);
  }
  async applyRanks(transaction, competitionId, changes, historyId) {
    changes = changes.filter(({ beforeRank, afterRank }) => beforeRank !== afterRank);
    if (!changes.length) return;
    await transaction.query("UPDATE play.ranking_entries SET rank=rank+1000000 WHERE competition_id=$1::uuid AND status='active'", [competitionId]);
    const rankingChange = await transaction.query("INSERT INTO play.ranking_changes(competition_id,match_result_history_id,created_at) VALUES ($1::uuid,$2::uuid,clock_timestamp()) RETURNING id", [competitionId, historyId]);
    const changedIds = [];
    for (const change of changes) {
      let rowId = change.row.id;
      if (!rowId) {
        const inserted = await transaction.query(`INSERT INTO play.ranking_entries(competition_id,person_id,contract_id,status,rank) VALUES ($1::uuid,$2::uuid,$3,'active',$4) RETURNING id`, [competitionId, change.row.internal_person_id, stableId("r", `${historyId}:${change.row.person_id}`), change.afterRank]); rowId = inserted.rows[0].id;
      } else if (change.afterRank > 0) await transaction.query("UPDATE play.ranking_entries SET status='active',rank=$2,last_active_rank=NULL,withdrawn_at=NULL,withdrawal_reason=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [rowId, change.afterRank]);
      changedIds.push(rowId);
      await transaction.query("INSERT INTO play.ranking_change_items(ranking_change_id,person_id,before_rank,after_rank) SELECT $1::uuid,person_id,$3,$4 FROM play.ranking_entries WHERE id=$2::uuid", [rankingChange.rows[0].id, rowId, change.beforeRank, change.afterRank]);
    }
    await transaction.query("UPDATE play.ranking_entries SET rank=rank-1000000 WHERE competition_id=$1::uuid AND status='active' AND NOT (id=ANY($2::uuid[]))", [competitionId, changedIds]);
    await transaction.query("INSERT INTO play.match_ranking_effects(match_result_history_id,ranking_change_id) VALUES ($1::uuid,$2::uuid)", [historyId, rankingChange.rows[0].id]);
  }

  async reverseRankingEffect(transaction, matchResultHistoryId, competitionId) {
    if (!matchResultHistoryId) return;
    const changes = await transaction.query(`SELECT item.person_id,item.before_rank FROM play.ranking_changes change JOIN play.ranking_change_items item ON item.ranking_change_id=change.id WHERE change.match_result_history_id=$1::uuid`, [matchResultHistoryId]);
    if (!changes.rowCount) return;
    await transaction.query("UPDATE play.ranking_entries SET rank=rank+1000000 WHERE competition_id=$1::uuid AND status='active'", [competitionId]);
    for (const change of changes.rows) {
      if (change.before_rank === null) await transaction.query("DELETE FROM play.ranking_entries WHERE competition_id=$1::uuid AND person_id=$2::uuid", [competitionId, change.person_id]);
      else if (Number(change.before_rank) === 0) await transaction.query("UPDATE play.ranking_entries SET status='withdrawn',rank=NULL,last_active_rank=COALESCE(last_active_rank,1),withdrawn_at=COALESCE(withdrawn_at,clock_timestamp()),withdrawal_reason=COALESCE(withdrawal_reason,'Administrative Ergebnisrücknahme') WHERE competition_id=$1::uuid AND person_id=$2::uuid", [competitionId, change.person_id]);
      else await transaction.query("UPDATE play.ranking_entries SET status='active',rank=$3,last_active_rank=NULL,withdrawn_at=NULL,withdrawal_reason=NULL WHERE competition_id=$1::uuid AND person_id=$2::uuid", [competitionId, change.person_id, change.before_rank]);
    }
    const ids = changes.rows.map(({ person_id }) => person_id);
    await transaction.query("UPDATE play.ranking_entries SET rank=rank-1000000 WHERE competition_id=$1::uuid AND status='active' AND NOT (person_id=ANY($2::uuid[]))", [competitionId, ids]);
  }

  async resultOperation(principal, params, { admin = false, correction = false } = {}) {
    if (admin && !hasRole(principal, "admin")) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    const current = this.cachedFingerprint(params.matchId); if (current.fingerprint !== params.expectedFingerprint) throw new AppError("RESULT_CONFLICT", "Matchergebnis wurde geändert", 409, { currentFingerprint: current.fingerprint });
    const command = correction ? "match.result.correct" : "match.result.set";
    return this.execute(principal, params.operationId, command, { matchId: params.matchId, kind: params.kind, result: params.result || "none", losingSide: params.losingSide || 0, fingerprint: params.expectedFingerprint, reason: params.reason || "none" }, async (transaction) => {
      const match = await this.lockMatch(transaction, params.matchId), people = await this.participants(transaction, match.id); this.assertParticipant(principal, people);
      let effectiveCorrection = correction;
      if (match.current_result_id && !correction) {
        if (!match.first_captured_at || this.now() - new Date(match.first_captured_at).getTime() > 60 * 60 * 1000) throw new AppError("MATCH_RESULT_CORRECTION_EXPIRED", "Korrekturfrist ist abgelaufen", 409);
        effectiveCorrection = true;
      }
      if (params.kind === "regular" && !match.scheduled_at && !params.matchStart) throw new AppError("MATCH_APPOINTMENT_REQUIRED", "Reguläres Ergebnis benötigt einen Spieltermin", 409);
      const format = await transaction.query("SELECT sets_to_win,set_target_games,deciding_set_type FROM play.match_format_versions WHERE id=$1::uuid", [match.match_format_version_id]);
      const completion = validateCompletion(params, this.rulesFromDatabase(format.rows[0])); if (!completion.valid) throw new AppError("MATCH_RESULT_INVALID", "Matchergebnis ist ungültig", 409, { rule: completion.error });
      const version = await transaction.query("SELECT COALESCE(max(version_no),0)+1 AS value FROM play.match_results WHERE match_id=$1::uuid", [match.id]);
      const walkover = completion.kind === "walkover";
      const ended = walkover ? null : params.matchEnd ? parseMatchDate(params.matchEnd) : new Date(this.now());
      const started = walkover ? null : params.matchStart ? parseMatchDate(params.matchStart) : match.scheduled_at;
      if (!walkover) {
        if (!ended || ended.getTime() > this.now() + 60_000) throw new AppError("MATCH_END_IN_FUTURE", "Spielende darf nicht in der Zukunft liegen", 409);
        if (started && ended <= new Date(started)) throw new AppError("MATCH_DURATION_INVALID", "Spielende muss nach Spielbeginn liegen", 409);
        if (started && ended.getTime() - new Date(started).getTime() > 4 * 60 * 60 * 1000 && params.longDurationConfirmed !== true) throw new AppError("MATCH_DURATION_CONFIRMATION_REQUIRED", "Lange Spieldauer muss bestätigt werden", 409);
      }
      const inserted = await transaction.query(`INSERT INTO play.match_results(match_id,version_no,completion_type,winner_side_no,play_started_at,play_ended_at,first_captured_at,walkover_at,provenance)
        VALUES ($1::uuid,$2,$3,$4,$5,$6,clock_timestamp(),CASE WHEN $3='walkover' THEN clock_timestamp() ELSE NULL END,'postgresql') RETURNING id`, [match.id, version.rows[0].value, completion.kind, completion.winnerSide, started, ended]);
      for (const [index, set] of completion.sets.entries()) await transaction.query("INSERT INTO play.match_result_sets(result_id,set_no,side_one_games,side_two_games,loser_tiebreak_points,incomplete) VALUES ($1::uuid,$2,$3,$4,$5,$6)", [inserted.rows[0].id, index + 1, set.side1, set.side2, set.tiebreakLoserPoints, set.state === "partial"]);
      const actor = people.find(({ person_id }) => person_id === String(principal.id))?.internal_person_id || null;
      const history = await transaction.query(`INSERT INTO play.match_result_history(match_id,operation_id,change_type,before_result_id,after_result_id,actor_person_id,administrative_reason,changed_at)
        VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6::uuid,$7,clock_timestamp()) RETURNING id`, [match.id, params.operationId, effectiveCorrection ? "corrected" : "created", match.current_result_id, inserted.rows[0].id, actor, admin ? params.reason : null]);
      if (effectiveCorrection && match.current_result_id) {
        const priorHistory = await transaction.query("SELECT id FROM play.match_result_history WHERE match_id=$1::uuid AND after_result_id=$2::uuid AND change_type IN ('created','corrected') ORDER BY changed_at DESC LIMIT 1", [match.id, match.current_result_id]);
        await this.reverseRankingEffect(transaction, priorHistory.rows[0]?.id, match.competition_id);
      }
      if (match.competition_type_id === "2" && !match.entry_target_rank) {
        const entry = await transaction.query(`SELECT defender.rank FROM play.ranking_entries defender
          WHERE defender.competition_id=$1::uuid AND defender.person_id=$2::uuid AND defender.status='active'
          AND NOT EXISTS (SELECT 1 FROM play.ranking_entries own WHERE own.competition_id=$1::uuid AND own.person_id=$3::uuid)`,
        [match.competition_id, people.find(({ side_no }) => side_no === 2)?.internal_person_id, people.find(({ side_no }) => side_no === 1)?.internal_person_id]);
        if (entry.rowCount) {
          match.entry_target_rank = entry.rows[0].rank;
          await transaction.query("UPDATE play.matches SET entry_target_rank=$2 WHERE id=$1::uuid", [match.id, match.entry_target_rank]);
        }
      }
      if (match.entry_target_rank) {
        const expires = match.entry_expires_at || Temporal.Instant.fromEpochMilliseconds(this.now()).toZonedDateTimeISO("Europe/Vienna").add({ years: 1 }).toInstant().toString();
        await transaction.query("UPDATE play.match_results SET entry_minimum_rank=$2,entry_expires_at=$3 WHERE id=$1::uuid", [inserted.rows[0].id, match.entry_target_rank + 10, expires]);
      }
      const changes = await this.rankingTargets(transaction, match, people, completion.winnerSide, params.rankPlan || null); await this.applyRanks(transaction, match.competition_id, changes, history.rows[0].id);
      await transaction.query("UPDATE play.matches SET current_result_id=$2::uuid,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [match.id, inserted.rows[0].id]);
      const progression = await transaction.query("SELECT target_match_id,target_side_no FROM play.match_progressions WHERE source_match_id=$1::uuid", [match.id]);
      if (progression.rowCount) {
        const winner = people.find(({ side_no, position_no }) => side_no === completion.winnerSide && position_no === 1);
        await transaction.query(`UPDATE play.match_participants participant SET participant_type='person',person_id=$3::uuid FROM play.match_sides side
          WHERE participant.side_id=side.id AND side.match_id=$1::uuid AND side.side_no=$2 AND participant.position_no=1`, [progression.rows[0].target_match_id, progression.rows[0].target_side_no, winner.internal_person_id]);
      }
      const recipientIds = people.map(({ person_id }) => person_id).filter(Boolean);
      await createDomainMessage(this.messaging, {
        contractId: eventId(params.operationId, effectiveCorrection ? "result-corrected" : "result-set"), eventType: effectiveCorrection ? "match.result.corrected" : "match.result.set", operationId: params.operationId,
        templateParameters: { matchId: params.matchId, competitionId: match.competition_contract_id, completionType: completion.kind },
        competitionId: match.competition_contract_id, matchId: params.matchId, participants: recipientIds.map((personId, index) => ({ personId, role: `participant_${index + 1}` })),
        recipients: recipientIds, readPersonIds: [String(principal.id)], sourceType: "match", sourceId: params.matchId,
        actorPersonId: String(principal.id), actorName: principal.name || null, summary: effectiveCorrection ? "Matchergebnis wurde korrigiert." : "Matchergebnis wurde eingetragen.", result: completion.result || completion.kind,
        messageContext: { winnerSide: completion.winnerSide, completionType: completion.kind, result: completion.result, matchEnd: ended ? legacyInstant(ended) : "", reason: admin ? params.reason : "" },
      }, transaction);
      return { success: true, matchId: params.matchId, result: completion.result, completionType: completion.kind };
    });
  }
  setMatchResult(principal, params) { return this.resultOperation(principal, params); }
  adminCorrectRankingResult(principal, params) { return this.resultOperation(principal, params, { admin: true, correction: true }); }

  async administrativeMatchMessage(transaction, principal, params, match, eventType, messageContext = {}) {
    const people = await this.participants(transaction, match.id);
    const recipientIds = people.map(person => person.person_id).filter(Boolean);
    await createDomainMessage(this.messaging, {
      contractId: eventId(params.operationId, eventType), eventType, operationId: params.operationId,
      templateParameters: { matchId: params.matchId, competitionId: match.competition_contract_id },
      competitionId: match.competition_contract_id, matchId: params.matchId,
      participants: recipientIds.map((personId, index) => ({ personId, role: `participant_${index + 1}` })),
      recipients: recipientIds, readPersonIds: [String(principal.id)], sourceType: "match", sourceId: params.matchId,
      actorPersonId: String(principal.id), actorName: principal.name || null, detail: params.reason,
      messageContext,
    }, transaction);
  }

  async adminSetMatchEnd(principal, params) {
    if (!hasRole(principal, "admin")) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    const current = this.cachedFingerprint(params.matchId); if (current.fingerprint !== params.expectedFingerprint) throw new AppError("RESULT_CONFLICT", "Matchergebnis wurde geändert", 409);
    return this.execute(principal, params.operationId, "match.end.set", { matchId: params.matchId, matchEnd: params.matchEnd, reason: params.reason }, async (transaction) => {
      const match = await this.lockMatch(transaction, params.matchId); if (!match.current_result_id) throw new AppError("MATCH_RESULT_REQUIRED", "Matchergebnis fehlt", 409);
      await transaction.query("UPDATE play.match_results SET play_ended_at=$2 WHERE id=$1::uuid", [match.current_result_id, parseMatchDate(params.matchEnd)]);
      const actor = await transaction.query("SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id=$2", [this.play.context.tenantId, String(principal.id)]);
      await transaction.query(`INSERT INTO play.match_result_history(match_id,operation_id,change_type,before_result_id,after_result_id,actor_person_id,administrative_reason,changed_at)
        VALUES ($1::uuid,$2::uuid,'end_corrected',$3::uuid,$3::uuid,$4::uuid,$5,clock_timestamp())`, [match.id, params.operationId, match.current_result_id, actor.rows[0]?.id || null, params.reason]);
      await transaction.query("UPDATE play.matches SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [match.id]);
      await this.administrativeMatchMessage(transaction, principal, params, match, "match.end.corrected", { matchEnd: params.matchEnd });
      return { success: true, matchId: params.matchId, matchEnd: params.matchEnd };
    });
  }

  async adminClearMatchResult(principal, params) {
    if (!hasRole(principal, "admin")) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    const current = this.cachedFingerprint(params.matchId); if (current.fingerprint !== params.expectedFingerprint) throw new AppError("RESULT_CONFLICT", "Matchergebnis wurde geändert", 409);
    return this.execute(principal, params.operationId, "match.result.clear", { matchId: params.matchId, reason: params.reason }, async (transaction) => {
      const match = await this.lockMatch(transaction, params.matchId); if (!match.current_result_id) return { success: true, matchId: params.matchId, cleared: false };
      const previousHistory = await transaction.query("SELECT id FROM play.match_result_history WHERE match_id=$1::uuid AND after_result_id=$2::uuid AND change_type IN ('created','corrected') ORDER BY changed_at DESC LIMIT 1", [match.id, match.current_result_id]);
      if (previousHistory.rowCount) {
        await this.reverseRankingEffect(transaction, previousHistory.rows[0].id, match.competition_id);
      }
      await transaction.query("UPDATE play.matches SET current_result_id=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [match.id]);
      const progression = await transaction.query("SELECT target_match_id,target_side_no FROM play.match_progressions WHERE source_match_id=$1::uuid", [match.id]);
      if (progression.rowCount) await transaction.query(`UPDATE play.match_participants participant SET participant_type='open_bracket',person_id=NULL FROM play.match_sides side WHERE participant.side_id=side.id AND side.match_id=$1::uuid AND side.side_no=$2 AND participant.position_no=1`, [progression.rows[0].target_match_id, progression.rows[0].target_side_no]);
      await transaction.query(`INSERT INTO play.match_result_history(match_id,operation_id,change_type,before_result_id,after_result_id,administrative_reason,changed_at) VALUES ($1::uuid,$2::uuid,'cleared',$3::uuid,NULL,$4,clock_timestamp())`, [match.id, params.operationId, match.current_result_id, params.reason]);
      const people = await this.participants(transaction, match.id), recipientIds = people.map(({ person_id }) => person_id).filter(Boolean);
      await createDomainMessage(this.messaging, { contractId: eventId(params.operationId, "result-cleared"), eventType: "match.result.cleared", operationId: params.operationId,
        templateParameters: { matchId: params.matchId, competitionId: match.competition_contract_id }, competitionId: match.competition_contract_id, matchId: params.matchId,
        participants: recipientIds.map((personId, index) => ({ personId, role: `participant_${index + 1}` })), recipients: recipientIds, readPersonIds: [String(principal.id)],
        sourceType: "match", sourceId: params.matchId, actorPersonId: String(principal.id), actorName: principal.name || null, summary: "Matchergebnis wurde administrativ gelöscht.", detail: params.reason,
      }, transaction);
      return { success: true, matchId: params.matchId, cleared: true };
    });
  }

  async adminDeleteRankingChallenge(principal, params) {
    if (!hasRole(principal, "admin")) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    return this.execute(principal, params.operationId, "match.challenge.delete", { matchId: params.matchId, reason: params.reason }, async (transaction) => {
      const match = await this.lockMatch(transaction, params.matchId); if (match.current_result_id) throw new AppError("MATCH_ALREADY_COMPLETED", "Abgeschlossenes Match kann nicht gelöscht werden", 409);
      await transaction.query("UPDATE play.matches SET is_ignored=true,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [match.id]);
      await this.administrativeMatchMessage(transaction, principal, params, match, "match.challenge.deleted");
      return { success: true, matchId: params.matchId, deleted: true };
    });
  }
  async adminSetRankingChallengeDate(principal, params) {
    if (!hasRole(principal, "admin")) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    return this.execute(principal, params.operationId, "match.challenge_date.set", { matchId: params.matchId, challengeDate: params.challengeDate, reason: params.reason }, async (transaction) => {
      const match = await this.lockMatch(transaction, params.matchId); await transaction.query("UPDATE play.matches SET challenged_at=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [match.id, parseMatchDate(params.challengeDate)]);
      await this.administrativeMatchMessage(transaction, principal, params, match, "match.challenge.date_changed", { previousDate: legacyInstant(match.challenged_at), nextDate: params.challengeDate });
      return { success: true, matchId: params.matchId, challengeDate: params.challengeDate };
    });
  }

  async withdrawFromRanking(principal, params) {
    const rules = analyzeMatchRules(dataStore.get("matches1"), params.bewerbId, new Date(this.now()));
    if (rules.busyIds.has(String(principal.id))) throw new AppError("PLAYER_BUSY", "Offene Forderung muss zuerst abgeschlossen werden", 409);
    return this.execute(principal, params.operationId, "ranking.withdraw", { competitionId: params.bewerbId, rank: params.rank, reason: params.reason }, async (transaction) => {
      const own = await transaction.query(`SELECT ranking.id,ranking.competition_id,ranking.rank FROM play.ranking_entries ranking JOIN play.competitions competition ON competition.id=ranking.competition_id
        JOIN core.sections section ON section.id=competition.section_id JOIN identity.people person ON person.id=ranking.person_id
        WHERE section.tenant_id=$1::uuid AND competition.contract_id=$2 AND person.contract_id=$3 AND ranking.status='active' FOR UPDATE OF ranking`, [this.play.context.tenantId, params.bewerbId, String(principal.id)]);
      if (!own.rowCount) throw new AppError("RANKING_MEMBERSHIP_REQUIRED", "Spieler ist nicht in der Rangliste", 409); if (own.rows[0].rank !== params.rank) throw new AppError("RANK_CONFLICT", "Rang wurde geändert", 409);
      await transaction.query("UPDATE play.ranking_entries SET rank=rank+1000000 WHERE competition_id=$1::uuid AND status='active'", [own.rows[0].competition_id]);
      await transaction.query("UPDATE play.ranking_entries SET rank=rank-1000001,revision=revision+1,updated_at=clock_timestamp() WHERE competition_id=$1::uuid AND status='active' AND rank>$2+1000000", [own.rows[0].competition_id, params.rank]);
      await transaction.query("UPDATE play.ranking_entries SET status='withdrawn',last_active_rank=$2,rank=NULL,withdrawn_at=clock_timestamp(),withdrawal_reason=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [own.rows[0].id, params.rank, params.reason]);
      await transaction.query("UPDATE play.ranking_entries SET rank=rank-1000000 WHERE competition_id=$1::uuid AND status='active' AND rank>=1000000", [own.rows[0].competition_id]);
      await createDomainMessage(this.messaging, { contractId: eventId(params.operationId, "ranking-withdrawn"), eventType: "ranking.withdrawn", operationId: params.operationId,
        templateParameters: { competitionId: params.bewerbId, personId: String(principal.id), rank: params.rank }, competitionId: params.bewerbId,
        participants: [{ personId: String(principal.id), role: "withdrawn_player" }], recipients: [String(principal.id)], readPersonIds: [String(principal.id)],
        sourceType: "ranking", sourceId: String(principal.id), actorPersonId: String(principal.id), actorName: principal.name || null, summary: "Spieler wurde aus der Rangliste herausgehängt.", detail: params.reason,
      }, transaction);
      return { success: true, bewerbId: params.bewerbId, rank: params.rank, withdrawn: true };
    });
  }

  cachedPerson(personId, reconciliation = false) {
    const table = dataStore.get("players");
    const projection = reconciliation ? projectPeopleReconciliation(table).people : projectPeopleNormalization(table).people;
    const person = projection.find(({ id }) => id === String(personId));
    if (!person) throw new AppError("PERSON_NOT_FOUND", "Person wurde nicht gefunden", 404);
    return person;
  }

  async setRole(transaction, personInternalId, field, value, principal) {
    const tenantId = this.play.context.tenantId;
    const setTenantRole = async (role, enabled) => {
      if (!enabled && String(principal.id) && role === "admin") {
        const own = await transaction.query("SELECT contract_id FROM identity.people WHERE id=$1::uuid", [personInternalId]);
        if (own.rows[0]?.contract_id === String(principal.id)) throw new AppError("ADMIN_SELF_PROTECTION", "Die eigene Adminrolle darf nicht entfernt werden", 409);
        const activeAdmins = await transaction.query("SELECT count(*)::int AS count FROM identity.tenant_role_assignments WHERE tenant_id=$1::uuid AND role_code='admin' AND revoked_at IS NULL", [tenantId]);
        if (activeAdmins.rows[0].count <= 1) throw new AppError("LAST_ADMIN_PROTECTION", "Mindestens ein Admin muss erhalten bleiben", 409);
      }
      if (enabled) await transaction.query(`INSERT INTO identity.tenant_role_assignments(tenant_id,person_id,role_code,granted_at) VALUES ($1::uuid,$2::uuid,$3,clock_timestamp()) ON CONFLICT (tenant_id,person_id,role_code) WHERE revoked_at IS NULL DO NOTHING`, [tenantId, personInternalId, role]);
      else await transaction.query("UPDATE identity.tenant_role_assignments SET revoked_at=clock_timestamp() WHERE tenant_id=$1::uuid AND person_id=$2::uuid AND role_code=$3 AND revoked_at IS NULL", [tenantId, personInternalId, role]);
    };
    const setMembership = async (classification) => {
      const section = await transaction.query("SELECT id FROM core.sections WHERE tenant_id=$1::uuid AND section_code='tennis'", [tenantId]);
      await transaction.query("UPDATE identity.memberships SET active=false,valid_until=clock_timestamp(),revision=revision+1 WHERE section_id=$1::uuid AND person_id=$2::uuid AND valid_until IS NULL", [section.rows[0].id, personInternalId]);
      if (classification) await transaction.query("INSERT INTO identity.memberships(section_id,person_id,classification,active,valid_from) VALUES ($1::uuid,$2::uuid,$3,true,clock_timestamp())", [section.rows[0].id, personInternalId, classification]);
    };
    if (field === "admin") return setTenantRole("admin", value === "1");
    if (field === "operator") return setTenantRole("operator", value === "1");
    if (field === "member") return setMembership(value || null);
    if (field === "role") {
      if (value === "admin" || value === "operator") return setTenantRole(value, true);
      if (["player", "player A", "player B"].includes(value)) return setMembership(value);
    }
  }

  async applyPersonChanges(transaction, personId, changes, principal) {
    const locked = await transaction.query("SELECT id,active FROM identity.people WHERE tenant_id=$1::uuid AND contract_id=$2 FOR UPDATE", [this.play.context.tenantId, String(personId)]);
    if (!locked.rowCount) throw new AppError("PERSON_NOT_FOUND", "Person wurde nicht gefunden", 404);
    const id = locked.rows[0].id;
    if (Object.hasOwn(changes, "active") && changes.active !== "1") {
      const admin = await transaction.query("SELECT 1 FROM identity.tenant_role_assignments WHERE tenant_id=$1::uuid AND person_id=$2::uuid AND role_code='admin' AND revoked_at IS NULL", [this.play.context.tenantId, id]);
      if (admin.rowCount) {
        if (String(personId) === String(principal.id)) throw new AppError("ADMIN_SELF_PROTECTION", "Die eigene aktive Adminrolle darf nicht deaktiviert werden", 409);
        const count = await transaction.query("SELECT count(*)::int AS count FROM identity.tenant_role_assignments WHERE tenant_id=$1::uuid AND role_code='admin' AND revoked_at IS NULL", [this.play.context.tenantId]);
        if (count.rows[0].count <= 1) throw new AppError("LAST_ADMIN_PROTECTION", "Mindestens ein aktiver Admin muss erhalten bleiben", 409);
      }
    }
    const direct = { firstName: "first_name", lastName: "last_name", active: "active", gender: "gender_code" };
    for (const [field, column] of Object.entries(direct)) if (Object.hasOwn(changes, field)) {
      const value = field === "active" ? changes[field] === "1" : field === "gender" ? (changes[field] ? Number(changes[field]) : null) : changes[field] || null;
      await transaction.query(`UPDATE identity.people SET ${column}=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid`, [id, value]);
    }
    if (Object.hasOwn(changes, "birthDate")) {
      const match = changes.birthDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/); const value = match ? `${match[3]}-${match[2]}-${match[1]}` : null;
      await transaction.query("UPDATE identity.people SET birth_date=$2::date,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [id, value]);
    }
    for (const [field, type] of [["email", "email"], ["phone", "mobile"]]) if (Object.hasOwn(changes, field)) {
      await transaction.query("UPDATE identity.person_contacts SET active=false,revoked_at=clock_timestamp() WHERE person_id=$1::uuid AND contact_type=$2 AND active", [id, type]);
      if (changes[field]) await transaction.query("INSERT INTO identity.person_contacts(person_id,contact_type,contact_value) VALUES ($1::uuid,$2,$3)", [id, type, changes[field]]);
    }
    if (["country", "postalCode", "city", "address"].some((field) => Object.hasOwn(changes, field))) {
      const current = await transaction.query("SELECT country_label,postal_code,city,address_line FROM identity.person_addresses WHERE person_id=$1::uuid AND active FOR UPDATE", [id]);
      const before = current.rows[0] || {};
      const address = {
        country: changes.country ?? before.country_label ?? null, postalCode: changes.postalCode ?? before.postal_code ?? null,
        city: changes.city ?? before.city ?? null, address: changes.address ?? before.address_line ?? null,
      };
      await transaction.query("UPDATE identity.person_addresses SET active=false,revoked_at=clock_timestamp() WHERE person_id=$1::uuid AND active", [id]);
      if (Object.values(address).some(Boolean)) await transaction.query("INSERT INTO identity.person_addresses(person_id,country_label,postal_code,city,address_line) VALUES ($1::uuid,$2,$3,$4,$5)", [id, address.country || null, address.postalCode || null, address.city || null, address.address || null]);
    }
    if (Object.hasOwn(changes, "login")) {
      await transaction.query(`INSERT INTO identity.user_accounts(tenant_id,person_id,login,active) VALUES ($2::uuid,$1::uuid,$3,true)
        ON CONFLICT (person_id) DO UPDATE SET login=EXCLUDED.login,revision=identity.user_accounts.revision+1,auth_revision=identity.user_accounts.auth_revision+1,updated_at=clock_timestamp()`, [id, this.play.context.tenantId, changes.login || null]);
    }
    for (const field of ["role", "member", "admin", "operator"]) if (Object.hasOwn(changes, field)) await this.setRole(transaction, id, field, changes[field], principal);
    if (Object.hasOwn(changes, "active") && changes.active !== "1") {
      await transaction.query("UPDATE identity.user_accounts SET active=false,auth_revision=auth_revision+1,revision=revision+1,updated_at=clock_timestamp() WHERE person_id=$1::uuid", [id]);
      await transaction.query("UPDATE identity.sessions SET revoked_at=clock_timestamp() WHERE account_id=(SELECT id FROM identity.user_accounts WHERE person_id=$1::uuid) AND revoked_at IS NULL", [id]);
    }
    if (["login", "role", "member", "admin", "operator"].some((field) => Object.hasOwn(changes, field))) await transaction.query("UPDATE identity.sessions SET revoked_at=clock_timestamp() WHERE account_id=(SELECT id FROM identity.user_accounts WHERE person_id=$1::uuid) AND revoked_at IS NULL", [id]);
    return id;
  }

  async normalizePerson(principal, params) {
    if (!hasRole(principal, "admin")) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    const current = this.cachedPerson(params.personId); const values = current.values;
    const fingerprint = personFingerprint(values); if (fingerprint !== params.expectedFingerprint) throw new AppError("PERSON_CONFLICT", "Personendaten wurden geändert", 409, { currentFingerprint: fingerprint });
    return this.execute(principal, params.operationId, "person.normalize", { personId: params.personId, fingerprint: params.expectedFingerprint, changes: params.changes }, async (transaction) => {
      await this.applyPersonChanges(transaction, params.personId, params.changes, principal);
      return { success: true, personId: params.personId, changedFieldCount: Object.keys(params.changes).length };
    }).then(async (result) => ({ ...result, fingerprint: this.cachedPerson(params.personId).fingerprint }));
  }

  async reconcilePerson(principal, request) {
    if (!hasRole(principal, "admin")) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    if (request.action === "create") {
      return this.execute(principal, request.operationId, "person.reconcile.create", { action: request.action, externalId: request.externalId, values: request.values }, async (transaction) => {
        await transaction.query("SELECT pg_advisory_xact_lock(hashtext('identity.person.contract-id'))");
        const next = await transaction.query("SELECT (COALESCE(max(contract_id::bigint),0)+1)::text AS id FROM identity.people WHERE tenant_id=$1::uuid", [this.play.context.tenantId]);
        const personId = next.rows[0].id;
        const birth = request.values.birthDate?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        const inserted = await transaction.query(`INSERT INTO identity.people(tenant_id,contract_id,first_name,last_name,birth_date,gender_code,active)
          VALUES ($1::uuid,$2,$3,$4,$5::date,$6,$7) RETURNING id`, [this.play.context.tenantId, personId, request.values.firstName || null, request.values.lastName,
          birth ? `${birth[3]}-${birth[2]}-${birth[1]}` : null, request.values.gender ? Number(request.values.gender) : null, true]);
        await transaction.query("INSERT INTO identity.person_external_identifiers(tenant_id,person_id,provider,external_value) VALUES ($1::uuid,$2::uuid,'clubdesk',$3)", [this.play.context.tenantId, inserted.rows[0].id, request.externalId]);
        await this.applyPersonChanges(transaction, personId, request.values, principal);
        return { success: true, action: "create", personId };
      }).then(async (result) => { const person = this.cachedPerson(result.personId, true); return { ...result, fingerprint: person.fingerprint }; });
    }
    const current = this.cachedPerson(request.personId, true);
    if (current.fingerprint !== request.expectedFingerprint) throw new AppError("PERSON_CONFLICT", "Personendaten wurden geändert", 409, { currentFingerprint: current.fingerprint });
    if (request.action === "deactivate" && (current.values.admin === "1" || current.values.operator === "1")) throw new AppError("ROLE_PROTECTED", "Admin und Operator dürfen nicht deaktiviert werden", 409);
    const changes = request.action === "deactivate" ? { active: "" } : request.changes;
    return this.execute(principal, request.operationId, `person.reconcile.${request.action}`, { action: request.action, personId: request.personId, externalId: request.externalId || "none", fingerprint: request.expectedFingerprint, changes }, async (transaction) => {
      const internalId = await this.applyPersonChanges(transaction, request.personId, changes, principal);
      if (request.action === "update") {
        const currentExternal = await transaction.query("SELECT external_value FROM identity.person_external_identifiers WHERE tenant_id=$1::uuid AND person_id=$2::uuid AND provider='clubdesk' AND active FOR UPDATE", [this.play.context.tenantId, internalId]);
        if (currentExternal.rowCount && currentExternal.rows[0].external_value !== request.externalId) throw new AppError("EXTERNAL_ID_CONFLICT", "Bestehende CD-ID darf nicht neu zugeordnet werden", 409);
        if (!currentExternal.rowCount) await transaction.query("INSERT INTO identity.person_external_identifiers(tenant_id,person_id,provider,external_value) VALUES ($1::uuid,$2::uuid,'clubdesk',$3)", [this.play.context.tenantId, internalId, request.externalId]);
      }
      return { success: true, action: request.action, personId: request.personId };
    }).then(async (result) => ({ ...result, fingerprint: this.cachedPerson(request.personId, true).fingerprint }));
  }
}

module.exports = { PostgresPlayService };
