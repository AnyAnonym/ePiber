"use strict";

const crypto = require("crypto");

function publicId(value, field = "id") {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(normalized)) throw Object.assign(new Error(`${field.toUpperCase()}_INVALID`), { code: `${field.toUpperCase()}_INVALID` });
  return normalized;
}

class PlayRepository {
  constructor({ database, context }) {
    this.database = database;
    this.context = context;
  }

  async competitionTypes() {
    const result = await this.database.query(`
      SELECT ct.id::text AS "internalId", ct.contract_id AS id, ct.name, ct.active,
             ctv.id::text AS "versionId", ctv.version_no AS "versionNo",
             ctv.entry_list_available AS "entryListAvailable", ctv.bracket_size AS "bracketSize",
             ctv.round_robin AS "roundRobin", ctv.specific_code AS "specificCode"
        FROM play.competition_types ct
        JOIN LATERAL (
          SELECT * FROM play.competition_type_versions candidate
           WHERE candidate.competition_type_id=ct.id ORDER BY candidate.version_no DESC LIMIT 1
        ) ctv ON true
       WHERE ct.tenant_id=$1::uuid
       ORDER BY ct.contract_id
    `, [this.context.tenantId]);
    return result.rows;
  }

  async matchFormats() {
    const result = await this.database.query(`
      SELECT mf.id::text AS "internalId", mf.contract_id AS id, mf.name, mf.active,
             mfv.id::text AS "versionId", mfv.version_no AS "versionNo", mfv.sets_to_win AS "setsToWin",
             mfv.set_target_games AS "setTargetGames", mfv.set_tiebreak_at_games AS "setTiebreakAtGames",
             mfv.deciding_set_type AS "decidingSetType", mfv.no_ad AS "noAd"
        FROM play.match_formats mf
        JOIN LATERAL (
          SELECT * FROM play.match_format_versions candidate
           WHERE candidate.match_format_id=mf.id ORDER BY candidate.version_no DESC LIMIT 1
        ) mfv ON true
       WHERE mf.tenant_id=$1::uuid
       ORDER BY mf.contract_id::numeric
    `, [this.context.tenantId]);
    return result.rows;
  }

  async competitions() {
    const result = await this.database.query(`
      SELECT c.id::text AS "internalId", c.contract_id AS id, c.name, c.revision::text AS revision,
             ct.contract_id AS "competitionTypeId", ctv.version_no AS "competitionTypeVersion",
             mf.contract_id AS "defaultMatchFormatId", mfv.version_no AS "defaultMatchFormatVersion",
             c.entry_start_date::text AS "entryStartDate", c.entry_starts_at AS "entryStartsAt",
             c.entry_deadline_date::text AS "entryDeadlineDate", c.entry_deadline_at AS "entryDeadlineAt",
             c.competition_start_date::text AS "competitionStartDate", c.competition_starts_at AS "competitionStartsAt",
             c.competition_end_date::text AS "competitionEndDate", c.competition_ends_at AS "competitionEndsAt",
             c.minimum_age AS "minimumAge", c.maximum_age AS "maximumAge", c.sort_order AS "sortOrder",
             COALESCE(array_agg(g.gender_code ORDER BY g.gender_code) FILTER (WHERE g.gender_code IS NOT NULL), ARRAY[]::smallint[]) AS "genderCodes"
        FROM play.competitions c
        JOIN core.sections s ON s.id=c.section_id
        JOIN play.competition_type_versions ctv ON ctv.id=c.competition_type_version_id
        JOIN play.competition_types ct ON ct.id=ctv.competition_type_id
        LEFT JOIN play.match_format_versions mfv ON mfv.id=c.default_match_format_version_id
        LEFT JOIN play.match_formats mf ON mf.id=mfv.match_format_id
        LEFT JOIN play.competition_gender_eligibility g ON g.competition_id=c.id
       WHERE s.tenant_id=$1::uuid AND s.section_code='tennis'
       GROUP BY c.id, ct.contract_id, ctv.version_no, mf.contract_id, mfv.version_no
       ORDER BY c.sort_order NULLS LAST, c.contract_id
    `, [this.context.tenantId]);
    return result.rows;
  }

  async entries(competitionId, { includeWithdrawn = false } = {}) {
    const result = await this.database.query(`
      SELECT e.id::text AS "internalId", e.contract_id AS id, c.contract_id AS "competitionId",
             p.contract_id AS "personId", e.entered_at AS "enteredAt", e.status,
             e.withdrawn_at AS "withdrawnAt", e.legacy_fee_status AS "legacyFeeStatus", e.revision::text AS revision
        FROM play.competition_entries e
        JOIN play.competitions c ON c.id=e.competition_id
        JOIN core.sections s ON s.id=c.section_id
        JOIN identity.people p ON p.id=e.person_id
       WHERE s.tenant_id=$1::uuid AND c.contract_id=$2 AND ($3::boolean OR e.status='active')
       ORDER BY e.entered_at, e.contract_id
    `, [this.context.tenantId, publicId(competitionId, "competition_id"), Boolean(includeWithdrawn)]);
    return result.rows;
  }

  async matches(competitionId) {
    const result = await this.database.query(`
      SELECT m.id::text AS "internalId", m.contract_id AS id, c.contract_id AS "competitionId",
             m.round_code AS "roundCode", m.challenged_at AS "challengedAt", m.scheduled_at AS "scheduledAt",
             m.reserved_duration_minutes AS "reservedDurationMinutes", m.is_ignored AS "isIgnored",
             m.note, m.revision::text AS revision, status.status,
             mf.contract_id AS "matchFormatId", mfv.version_no AS "matchFormatVersion",
             m.format_binding_source AS "formatBindingSource",
             result.id::text AS "resultId", result.version_no AS "resultVersion", result.completion_type AS "completionType",
             result.winner_side_no AS "winnerSideNo", result.play_started_at AS "playStartedAt",
              result.play_ended_at AS "playEndedAt", result.first_captured_at AS "firstCapturedAt", result.walkover_at AS "walkoverAt",
              CASE WHEN result.winner_side_no=2 THEN result.entry_minimum_rank END AS "entryMinimumRank",
              CASE WHEN result.winner_side_no=2 THEN result.entry_expires_at END AS "entryExpiresAt",
             COALESCE(participants.items, '[]'::jsonb) AS participants,
             COALESCE(sets.items, '[]'::jsonb) AS sets
        FROM play.matches m
        JOIN play.competitions c ON c.id=m.competition_id
        JOIN core.sections section ON section.id=c.section_id
        JOIN play.match_status status ON status.match_id=m.id
        JOIN play.match_format_versions mfv ON mfv.id=m.match_format_version_id
        JOIN play.match_formats mf ON mf.id=mfv.match_format_id
        LEFT JOIN play.match_results result ON result.id=m.current_result_id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object(
                   'sideNo', side.side_no, 'positionNo', participant.position_no,
                   'type', participant.participant_type, 'personId', person.contract_id
                 ) ORDER BY side.side_no, participant.position_no) AS items
            FROM play.match_sides side
            JOIN play.match_participants participant ON participant.side_id=side.id
            LEFT JOIN identity.people person ON person.id=participant.person_id
           WHERE side.match_id=m.id
        ) participants ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object(
                   'setNo', set_row.set_no, 'sideOneGames', set_row.side_one_games,
                   'sideTwoGames', set_row.side_two_games, 'loserTiebreakPoints', set_row.loser_tiebreak_points,
                   'incomplete', set_row.incomplete
                 ) ORDER BY set_row.set_no) AS items
            FROM play.match_result_sets set_row
           WHERE set_row.result_id=m.current_result_id
        ) sets ON true
       WHERE section.tenant_id=$1::uuid AND c.contract_id=$2
       ORDER BY m.scheduled_at NULLS LAST, m.contract_id
    `, [this.context.tenantId, publicId(competitionId, "competition_id")]);
    return result.rows;
  }

  async rankings(competitionId) {
    const result = await this.database.query(`
      SELECT r.id::text AS "internalId", r.contract_id AS id, c.contract_id AS "competitionId",
             p.contract_id AS "personId", r.status, r.rank, r.last_active_rank AS "lastActiveRank",
             r.withdrawn_at AS "withdrawnAt", r.withdrawal_reason AS "withdrawalReason", r.revision::text AS revision
        FROM play.ranking_entries r
        JOIN play.competitions c ON c.id=r.competition_id
        JOIN core.sections s ON s.id=c.section_id
        JOIN identity.people p ON p.id=r.person_id
       WHERE s.tenant_id=$1::uuid AND c.contract_id=$2
       ORDER BY r.rank NULLS LAST, r.last_active_rank NULLS LAST, p.contract_id::numeric
    `, [this.context.tenantId, publicId(competitionId, "competition_id")]);
    return result.rows;
  }

  async addCompetitionEntry(target, { competitionId, personId, operationId, enteredAt = new Date() }) {
    const competition = publicId(competitionId, "competition_id");
    const person = publicId(personId, "person_id");
    if (!/^[0-9a-f-]{36}$/i.test(String(operationId || ""))) throw Object.assign(new Error("OPERATION_ID_INVALID"), { code: "OPERATION_ID_INVALID" });
    if (!(enteredAt instanceof Date) || !Number.isFinite(enteredAt.getTime())) throw Object.assign(new Error("ENTRY_TIME_INVALID"), { code: "ENTRY_TIME_INVALID" });
    const existing = await target.query(`
      SELECT entry.contract_id AS id, entry.status
        FROM play.competition_entries entry
        JOIN play.competitions competition ON competition.id=entry.competition_id
        JOIN core.sections section ON section.id=competition.section_id
        JOIN identity.people person ON person.id=entry.person_id
       WHERE section.tenant_id=$1::uuid AND competition.contract_id=$2 AND person.contract_id=$3 AND entry.status='active'
       FOR UPDATE OF entry
    `, [this.context.tenantId, competition, person]);
    if (existing.rowCount) return { id: existing.rows[0].id, alreadyPresent: true };
    const contract = `e-${crypto.createHash("sha256").update(`${person}:${operationId}`).digest("hex").slice(0, 32)}`;
    const inserted = await target.query(`
      INSERT INTO play.competition_entries(competition_id, person_id, contract_id, entered_at, status)
      SELECT competition.id, person.id, $4, $5, 'active'
        FROM play.competitions competition
        JOIN core.sections section ON section.id=competition.section_id
        JOIN identity.people person ON person.tenant_id=section.tenant_id AND person.contract_id=$3 AND person.active
       WHERE section.tenant_id=$1::uuid AND competition.contract_id=$2
      ON CONFLICT (competition_id, contract_id) DO NOTHING
      RETURNING contract_id AS id, revision::text
    `, [this.context.tenantId, competition, person, contract, enteredAt]);
    if (!inserted.rowCount) throw Object.assign(new Error("ENTRY_CONTEXT_NOT_FOUND"), { code: "ENTRY_CONTEXT_NOT_FOUND" });
    return { ...inserted.rows[0], alreadyPresent: false };
  }

  async withdrawCompetitionEntry(target, { competitionId, personId, withdrawnAt = new Date() }) {
    const result = await target.query(`
      UPDATE play.competition_entries entry
         SET status='withdrawn', withdrawn_at=$4, revision=entry.revision+1
        FROM play.competitions competition, core.sections section, identity.people person
       WHERE entry.competition_id=competition.id AND competition.section_id=section.id
         AND entry.person_id=person.id AND section.tenant_id=$1::uuid
         AND competition.contract_id=$2 AND person.contract_id=$3 AND entry.status='active'
      RETURNING entry.contract_id AS id, entry.revision::text
    `, [this.context.tenantId, publicId(competitionId, "competition_id"), publicId(personId, "person_id"), withdrawnAt]);
    return result.rows[0] || null;
  }
}

module.exports = { PlayRepository, publicId };
