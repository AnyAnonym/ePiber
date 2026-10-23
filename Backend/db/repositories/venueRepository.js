"use strict";

const crypto = require("crypto");

const PUBLIC_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCORE_KEYS = Object.freeze([
  "sideOneSetOne", "sideTwoSetOne", "sideOneSetTwo", "sideTwoSetTwo",
  "sideOneSetThree", "sideTwoSetThree", "sideOnePoints", "sideTwoPoints",
]);

function publicId(value, field) {
  const normalized = String(value || "").trim();
  if (!PUBLIC_ID.test(normalized)) throw Object.assign(new Error(`${field.toUpperCase()}_INVALID`), { code: `${field.toUpperCase()}_INVALID` });
  return normalized;
}

function scoreProjection(score) {
  if (!score || typeof score !== "object" || Array.isArray(score) || Object.keys(score).length !== SCORE_KEYS.length) {
    throw Object.assign(new Error("SCORE_INVALID"), { code: "SCORE_INVALID" });
  }
  const projected = {};
  for (const key of SCORE_KEYS) {
    const value = String(score[key] ?? "");
    if (!/^[A-Za-z0-9+-]{1,8}$/.test(value)) throw Object.assign(new Error("SCORE_VALUE_INVALID"), { code: "SCORE_VALUE_INVALID" });
    projected[key] = value;
  }
  return projected;
}

class VenueRepository {
  constructor({ database, context, sourceInstance = "devel" }) {
    this.database = database;
    this.context = context;
    this.sourceInstance = String(sourceInstance);
    if (!/^[a-z0-9_-]{1,32}$/i.test(this.sourceInstance)) throw Object.assign(new Error("SOURCE_INSTANCE_INVALID"), { code: "SOURCE_INSTANCE_INVALID" });
  }

  async courts() {
    const result = await this.database.query(`
      SELECT court.id::text AS "internalId", site.site_code AS "siteCode", court.court_code AS id,
             court.display_name AS name, court.active, court.epoch::text, court.revision::text,
             state.active AS "scoreActive", state.awaiting_baseline AS "awaitingBaseline",
              state.source_state AS "sourceState", state.last_source_at AS "lastSourceAt",
              state.revision::text AS "stateRevision", match.contract_id AS "matchId",
              competition.contract_id AS "competitionId",assignment.competition_name_snapshot AS "competitionName",
              format.contract_id AS "matchFormatId",assignment.round_code_snapshot AS "roundCode",
               assignment.id::text AS "assignmentId",assignment.scheduled_at_snapshot AS "scheduledAt",assignment.automation_status AS "automationStatus",
              COALESCE(participants.home_ids,ARRAY[]::text[]) AS "homePlayerIds",
              COALESCE(participants.guest_ids,ARRAY[]::text[]) AS "guestPlayerIds",
              COALESCE(participants.home_names,ARRAY[]::text[]) AS "homePlayerNames",
              COALESCE(participants.guest_names,ARRAY[]::text[]) AS "guestPlayerNames",
              CASE WHEN format_version.id IS NULL THEN NULL ELSE jsonb_build_object('winningSets',format_version.sets_to_win,'setTarget',format_version.set_target_games,
                'setTiebreak',format_version.set_tiebreak_at_games::text||'-'||format_version.set_tiebreak_at_games::text,
                'decidingSet',CASE format_version.deciding_set_type WHEN 'full_set' THEN 'vollstaendiger Satz' WHEN 'match_tiebreak_10' THEN 'MT10' ELSE 'MT7' END) END AS "displayRules",
             jsonb_build_object(
               'sideOneSetOne', state.side_one_set_one, 'sideTwoSetOne', state.side_two_set_one,
               'sideOneSetTwo', state.side_one_set_two, 'sideTwoSetTwo', state.side_two_set_two,
               'sideOneSetThree', state.side_one_set_three, 'sideTwoSetThree', state.side_two_set_three,
               'sideOnePoints', state.side_one_points, 'sideTwoPoints', state.side_two_points
              ) AS score,state.updated_at AS "updatedAt"
        FROM venue.courts court
        JOIN venue.sites site ON site.id=court.site_id
        JOIN core.sections section ON section.id=site.section_id
        LEFT JOIN venue.court_live_state state ON state.court_id=court.id
        LEFT JOIN venue.court_assignments assignment ON assignment.id=state.assignment_id
        LEFT JOIN play.matches match ON match.id=assignment.match_id
        LEFT JOIN play.competitions competition ON competition.id=assignment.competition_id
        LEFT JOIN play.match_format_versions format_version ON format_version.id=assignment.match_format_version_id
        LEFT JOIN play.match_formats format ON format.id=format_version.match_format_id
        LEFT JOIN LATERAL (
          SELECT
            array_agg(person.contract_id ORDER BY participant.position_no) FILTER (WHERE participant.side_no=1) AS home_ids,
            array_agg(person.contract_id ORDER BY participant.position_no) FILTER (WHERE participant.side_no=2) AS guest_ids,
            array_agg(concat_ws(' ',participant.first_name_snapshot,participant.last_name_snapshot) ORDER BY participant.position_no) FILTER (WHERE participant.side_no=1) AS home_names,
            array_agg(concat_ws(' ',participant.first_name_snapshot,participant.last_name_snapshot) ORDER BY participant.position_no) FILTER (WHERE participant.side_no=2) AS guest_names
          FROM venue.court_assignment_participants participant
          JOIN identity.people person ON person.id=participant.person_id
          WHERE participant.assignment_id=assignment.id
        ) participants ON true
       WHERE section.tenant_id=$1::uuid AND section.section_code='tennis'
       ORDER BY site.site_code, court.court_code
    `, [this.context.tenantId]);
    return result.rows;
  }

  async appendScoreEvent({ eventId, courtId, score, sourceOccurredAt = null, sourceSequence = null, sourceKey = null, sourceSha256 = null }) {
    if (!UUID.test(String(eventId || ""))) throw Object.assign(new Error("SCORE_EVENT_ID_INVALID"), { code: "SCORE_EVENT_ID_INVALID" });
    const normalizedCourtId = publicId(courtId, "court_id");
    const value = scoreProjection(score);
    if (sourceSequence !== null && (!Number.isSafeInteger(sourceSequence) || sourceSequence < 0)) throw Object.assign(new Error("SOURCE_SEQUENCE_INVALID"), { code: "SOURCE_SEQUENCE_INVALID" });
    const sourceHash = sourceSha256 === null ? null : Buffer.from(sourceSha256);
    if (sourceHash !== null && sourceHash.length !== 32) throw Object.assign(new Error("SOURCE_HASH_INVALID"), { code: "SOURCE_HASH_INVALID" });
    return this.database.withTransaction("venue.score.accept", async (transaction) => {
      const existing = await transaction.query(`
        SELECT event.court_sequence::text AS sequence, court.court_code AS "courtId",
               event.side_one_set_one AS "sideOneSetOne", event.side_two_set_one AS "sideTwoSetOne",
               event.side_one_set_two AS "sideOneSetTwo", event.side_two_set_two AS "sideTwoSetTwo",
               event.side_one_set_three AS "sideOneSetThree", event.side_two_set_three AS "sideTwoSetThree",
               event.side_one_points AS "sideOnePoints", event.side_two_points AS "sideTwoPoints",
               event.source_sequence AS "sourceSequence", event.source_key AS "sourceKey"
          FROM venue.score_events event
          JOIN venue.courts court ON court.id=event.court_id
          JOIN venue.sites site ON site.id=court.site_id
          JOIN core.sections section ON section.id=site.section_id
         WHERE section.tenant_id=$1::uuid AND event.event_id=$2::uuid
      `, [this.context.tenantId, eventId]);
      if (existing.rowCount) {
        const prior = existing.rows[0];
        const same = prior.courtId === normalizedCourtId
          && SCORE_KEYS.every((key) => prior[key] === value[key])
          && (prior.sourceSequence === null ? null : Number(prior.sourceSequence)) === sourceSequence
          && prior.sourceKey === sourceKey;
        if (!same) throw Object.assign(new Error("SCORE_EVENT_CONFLICT"), { code: "SCORE_EVENT_CONFLICT" });
        return { duplicate: true, courtSequence: prior.sequence };
      }
      const locked = await transaction.query(`
        SELECT court.id AS court_id, state.assignment_id, state.source_id, state.active,
               state.awaiting_baseline, state.revision, court.epoch
          FROM venue.courts court
          JOIN venue.sites site ON site.id=court.site_id
          JOIN core.sections section ON section.id=site.section_id
          JOIN venue.court_live_state state ON state.court_id=court.id
         WHERE section.tenant_id=$1::uuid AND court.court_code=$2
         FOR UPDATE OF state, court
      `, [this.context.tenantId, normalizedCourtId]);
      if (!locked.rowCount) throw Object.assign(new Error("COURT_NOT_FOUND"), { code: "COURT_NOT_FOUND" });
      const court = locked.rows[0];
      if (!court.active || !court.source_id) throw Object.assign(new Error("COURT_NOT_ACTIVE"), { code: "COURT_NOT_ACTIVE" });
      if (court.awaiting_baseline) throw Object.assign(new Error("COURT_AWAITING_BASELINE"), { code: "COURT_AWAITING_BASELINE" });
      const sequence = await transaction.query("SELECT COALESCE(max(court_sequence), 0)+1 AS value FROM venue.score_events WHERE court_id=$1::uuid", [court.court_id]);
      const revision = BigInt(court.revision) + 1n;
      await transaction.query(`
        INSERT INTO venue.score_events(
          event_id, court_id, assignment_id, source_id, court_sequence, source_occurred_at, accepted_at,
          side_one_set_one, side_two_set_one, side_one_set_two, side_two_set_two,
          side_one_set_three, side_two_set_three, side_one_points, side_two_points,
          court_revision, source_instance, source_sequence, source_key, source_sha256
        ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,clock_timestamp(),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      `, [
        eventId, court.court_id, court.assignment_id, court.source_id, sequence.rows[0].value, sourceOccurredAt,
        value.sideOneSetOne, value.sideTwoSetOne, value.sideOneSetTwo, value.sideTwoSetTwo,
        value.sideOneSetThree, value.sideTwoSetThree, value.sideOnePoints, value.sideTwoPoints,
        revision.toString(), this.sourceInstance, sourceSequence, sourceKey, sourceHash,
      ]);
      await transaction.query(`
        UPDATE venue.court_live_state
           SET side_one_set_one=$2, side_two_set_one=$3, side_one_set_two=$4, side_two_set_two=$5,
               side_one_set_three=$6, side_two_set_three=$7, side_one_points=$8, side_two_points=$9,
               source_state='ready', last_source_at=COALESCE($10, clock_timestamp()), revision=$11, updated_at=clock_timestamp()
         WHERE court_id=$1::uuid
      `, [court.court_id, value.sideOneSetOne, value.sideTwoSetOne, value.sideOneSetTwo, value.sideTwoSetTwo,
        value.sideOneSetThree, value.sideTwoSetThree, value.sideOnePoints, value.sideTwoPoints,
        sourceOccurredAt, revision.toString()]);
      return { duplicate: false, courtSequence: String(sequence.rows[0].value), revision: revision.toString() };
    }, { isolation: "serializable", retries: 2 });
  }

  async acceptScoreBaseline(courtId, score, sourceSha256 = null) {
    const normalizedCourtId = publicId(courtId, "court_id");
    const value = scoreProjection(score);
    const hash = sourceSha256 === null ? crypto.createHash("sha256").update(JSON.stringify(value)).digest() : Buffer.from(sourceSha256);
    if (hash.length !== 32) throw Object.assign(new Error("SOURCE_HASH_INVALID"), { code: "SOURCE_HASH_INVALID" });
    const result = await this.database.query(`
      UPDATE venue.court_live_state state
         SET awaiting_baseline=false,baseline_sha256=$3,source_state='ready',last_source_at=clock_timestamp(),updated_at=clock_timestamp()
        FROM venue.courts court,venue.sites site,core.sections section
       WHERE state.court_id=court.id AND court.site_id=site.id AND site.section_id=section.id
         AND section.tenant_id=$1::uuid AND court.court_code=$2 AND court.active AND state.active
      RETURNING state.revision::text AS revision
    `, [this.context.tenantId, normalizedCourtId, hash]);
    if (!result.rowCount) throw Object.assign(new Error("COURT_NOT_ACTIVE"), { code: "COURT_NOT_ACTIVE" });
    return { baseline: true, revision: result.rows[0].revision };
  }

  async latestScoreByMatchAndCourt(matchId, courtId) {
    const result = await this.database.query(`
      SELECT event.court_sequence::text AS sequence,event.accepted_at AS "occurredAt",
             concat_ws('/',event.side_one_set_one||'-'||event.side_two_set_one,event.side_one_set_two||'-'||event.side_two_set_two,
               event.side_one_set_three||'-'||event.side_two_set_three,event.side_one_points||'-'||event.side_two_points) AS score
        FROM venue.score_events event
        JOIN venue.courts court ON court.id=event.court_id
        JOIN venue.sites site ON site.id=court.site_id JOIN core.sections section ON section.id=site.section_id
        JOIN play.matches match ON match.id=(SELECT assignment.match_id FROM venue.court_assignments assignment WHERE assignment.id=event.assignment_id)
       WHERE section.tenant_id=$1::uuid AND court.court_code=$2 AND match.contract_id=$3
       ORDER BY event.court_sequence DESC LIMIT 1
    `, [this.context.tenantId, publicId(courtId, "court_id"), publicId(matchId, "match_id")]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return { ...row, occurredAt: row.occurredAt instanceof Date ? row.occurredAt.getTime() : Number(row.occurredAt) };
  }

  async hallTimeGrid(gridId) {
    const result = await this.database.query(`
      SELECT grid.id::text AS "internalId", grid.contract_id AS id, grid.name, grid.description, grid.mode,
             grid.active, grid.public_join_enabled AS "publicJoinEnabled", grid.capacity,
             grid.waiting_list_enabled AS "waitingListEnabled", grid.waiting_limit_per_person AS "waitingLimitPerPerson",
             grid.fair_use_enabled AS "fairUseEnabled", grid.fair_use_open_days AS "fairUseOpenDays",
             grid.revision::text, grid.projection_revision::text AS "projectionRevision",
             COALESCE(participants.items, '[]'::jsonb) AS participants,
             COALESCE(slots.items, '[]'::jsonb) AS slots
        FROM venue.hall_time_grids grid
        JOIN core.sections section ON section.id=grid.section_id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object('personId', person.contract_id, 'joinedAt', member.joined_at, 'leftAt', member.left_at)
                           ORDER BY person.contract_id::numeric) AS items
            FROM venue.hall_time_grid_participants member
            JOIN identity.people person ON person.id=member.person_id
           WHERE member.grid_id=grid.id
        ) participants ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object(
                   'id', slot.id::text, 'startsAt', slot.starts_at, 'endsAt', slot.ends_at,
                   'capacity', slot.capacity, 'revision', slot.slot_revision::text, 'active', slot.active,
                   'allocations', COALESCE(allocation.items, '[]'::jsonb)
                 ) ORDER BY slot.starts_at) AS items
            FROM venue.hall_time_slots slot
            LEFT JOIN LATERAL (
              SELECT jsonb_agg(jsonb_build_object(
                       'id', entry.id::text, 'personId', person.contract_id, 'status', entry.status,
                       'queuedAt', entry.queued_at, 'assignedAt', entry.assigned_at
                     ) ORDER BY entry.status, entry.queued_at, entry.id) AS items
                FROM venue.hall_time_allocations entry
                JOIN identity.people person ON person.id=entry.person_id
               WHERE entry.slot_id=slot.id
            ) allocation ON true
           WHERE slot.grid_id=grid.id
        ) slots ON true
       WHERE section.tenant_id=$1::uuid AND grid.contract_id=$2
    `, [this.context.tenantId, publicId(gridId, "grid_id")]);
    return result.rows[0] || null;
  }

  async hallTimeGridsDetailed(gridId = null) {
    const grids = await this.database.query(`
      SELECT grid.id::text AS "internalId",grid.contract_id AS id,grid.name,COALESCE(grid.description,'') AS description,
             CASE grid.mode WHEN 'reservation' THEN 'fair_use' ELSE 'equal' END AS mode,grid.capacity,
             grid.waiting_list_enabled AS "waitlistEnabled",COALESCE(grid.waiting_limit_per_person,0) AS "maxWaitlistEntries",
             grid.public_join_enabled AS "publicJoinable",grid.fair_use_base AS "fairUseBase",
             grid.fair_use_extended_days AS "fairUseExtendedDays",grid.fair_use_percent AS "fairUsePercent",
             COALESCE(grid.fair_use_open_days,0) AS "fairUseOpenDays",grid.active,grid.revision::text,
             grid.created_at AS "createdAt",grid.updated_at AS "updatedAt"
        FROM venue.hall_time_grids grid JOIN core.sections section ON section.id=grid.section_id
       WHERE section.tenant_id=$1::uuid AND ($2::text IS NULL OR grid.contract_id=$2)
       ORDER BY lower(grid.name),grid.contract_id
    `, [this.context.tenantId, gridId === null ? null : publicId(gridId, "grid_id")]);
    const values = [];
    for (const grid of grids.rows) {
      const participants = await this.database.query(`
        SELECT person.contract_id AS id,person.first_name AS "firstName",person.last_name AS "lastName",
               concat_ws(' ',person.first_name,person.last_name) AS name
          FROM venue.hall_time_grid_participants member JOIN identity.people person ON person.id=member.person_id
         WHERE member.grid_id=$1::uuid AND member.left_at IS NULL ORDER BY lower(person.last_name),lower(person.first_name),person.contract_id
      `, [grid.internalId]);
      const slots = await this.database.query(`
        SELECT id::text AS id,to_char(starts_at AT TIME ZONE 'Europe/Vienna','YYYY-MM-DD') AS date,
               to_char(starts_at AT TIME ZONE 'Europe/Vienna','HH24:MI') AS start,
               to_char(ends_at AT TIME ZONE 'Europe/Vienna','HH24:MI') AS end,active
          FROM venue.hall_time_slots WHERE grid_id=$1::uuid ORDER BY starts_at,id
      `, [grid.internalId]);
      const entries = await this.database.query(`
        SELECT allocation.slot_id::text AS "slotId",person.contract_id AS "personId",allocation.status,
               extract(epoch FROM allocation.queued_at)*1000 AS "queuedAt"
          FROM venue.hall_time_allocations allocation JOIN venue.hall_time_slots slot ON slot.id=allocation.slot_id
          JOIN identity.people person ON person.id=allocation.person_id
         WHERE slot.grid_id=$1::uuid AND slot.active ORDER BY slot.starts_at,allocation.queued_at,allocation.id
      `, [grid.internalId]);
      const constraints = await this.database.query(`
        SELECT person.contract_id AS "personId",value.slot_id::text AS "slotId",value.constraint_type AS kind
          FROM venue.hall_time_constraints value JOIN identity.people person ON person.id=value.person_id
         WHERE value.grid_id=$1::uuid ORDER BY value.slot_id,person.contract_id
      `, [grid.internalId]);
      values.push({
        ...grid,
        revision: Number(grid.revision), createdAt: new Date(grid.createdAt).getTime(), updatedAt: new Date(grid.updatedAt).getTime(),
        fairUse: { base: grid.fairUseBase, extendedDays: grid.fairUseExtendedDays, percent: grid.fairUsePercent, openDays: grid.fairUseOpenDays },
        participants: participants.rows, slots: slots.rows.filter(({ active }) => active).map(({ active: _active, ...slot }) => slot),
        entries: entries.rows.map((entry) => ({ ...entry, status: entry.status === 'waiting' ? 'waitlist' : entry.status, queuedAt: Number(entry.queuedAt) })),
        constraints: constraints.rows,
      });
    }
    return values;
  }

  async hallTimeGridSummaries(personId, gridId = null) {
    const result = await this.database.query(`
      SELECT grid.contract_id AS id,grid.name,grid.active,grid.public_join_enabled AS "publicJoinable",
             CASE grid.mode WHEN 'reservation' THEN 'fair_use' ELSE 'equal' END AS mode,grid.revision::text,
             EXISTS(SELECT 1 FROM venue.hall_time_grid_participants member JOIN identity.people p ON p.id=member.person_id
                     WHERE member.grid_id=grid.id AND member.left_at IS NULL AND p.contract_id=$2 AND p.tenant_id=$1::uuid) AS joined
        FROM venue.hall_time_grids grid JOIN core.sections section ON section.id=grid.section_id
       WHERE section.tenant_id=$1::uuid AND ($3::text IS NULL OR grid.contract_id=$3)
       ORDER BY lower(grid.name),grid.contract_id
    `, [this.context.tenantId, String(personId || ""), gridId === null ? null : publicId(gridId, "grid_id")]);
    return result.rows.map((row) => ({ ...row, revision: Number(row.revision) }));
  }

  async monitorByToken(token) {
    const value = String(token || "");
    if (value.length < 32 || value.length > 256) return null;
    const result = await this.database.query(`
      UPDATE venue.monitor_devices
         SET last_seen_at=clock_timestamp()
       WHERE tenant_id=$1::uuid AND token_hash=$2 AND revoked_at IS NULL
       RETURNING contract_id AS "monitorId", label, target_type AS "targetType", page_key AS "pageKey",
                target_path AS "targetPath",target_command_id::text AS "targetCommandId",target_issued_at AS "targetIssuedAt",
                revision::text, created_at AS "createdAt", updated_at AS "updatedAt", last_seen_at AS "lastSeenAt"
    `, [this.context.tenantId, crypto.createHash("sha256").update(value).digest()]);
    return result.rows[0] ? this.monitorProjection(result.rows[0]) : null;
  }

  monitorProjection(row) {
    const timestamp = (value) => value instanceof Date ? value.getTime() : value === null || value === undefined ? null : Number(value);
    return {
      ...row,
      ...(row.createdAt === undefined ? {} : { createdAt: timestamp(row.createdAt) }),
      ...(row.updatedAt === undefined ? {} : { updatedAt: timestamp(row.updatedAt) }),
      ...(row.lastSeenAt === undefined ? {} : { lastSeenAt: timestamp(row.lastSeenAt) }),
      ...(row.revokedAt === undefined ? {} : { revokedAt: timestamp(row.revokedAt) }),
      ...(row.targetIssuedAt === undefined ? {} : { targetIssuedAt: timestamp(row.targetIssuedAt) }),
    };
  }

  async listMonitors() {
    const result = await this.database.query(`
       SELECT contract_id AS "monitorId", label, revision::text, created_at AS "createdAt",
              updated_at AS "updatedAt", last_seen_at AS "lastSeenAt", revoked_at AS "revokedAt",
              target_path AS "targetPath",target_command_id::text AS "targetCommandId",target_issued_at AS "targetIssuedAt"
        FROM venue.monitor_devices WHERE tenant_id=$1::uuid ORDER BY lower(label), contract_id
    `, [this.context.tenantId]);
    return result.rows.map((row) => this.monitorProjection(row));
  }

  async monitorTarget(monitorId) {
    const result = await this.database.query(`
      SELECT contract_id AS "monitorId",target_path AS path,target_command_id::text AS "commandId",
             extract(epoch FROM target_issued_at)*1000 AS "issuedAt",revision::text
        FROM venue.monitor_devices WHERE tenant_id=$1::uuid AND contract_id=$2 AND revoked_at IS NULL
    `, [this.context.tenantId, publicId(monitorId, "monitor_id")]);
    if (!result.rowCount) throw Object.assign(new Error("MONITOR_NOT_FOUND"), { code: "MONITOR_NOT_FOUND" });
    const row = result.rows[0];
    return { ...row, issuedAt: row.issuedAt === null ? null : Number(row.issuedAt) };
  }

  async createNavigationCommand(target, { monitorId, commandId, operationId, path }) {
    const result = await target.query(`
      WITH locked AS (
        SELECT id,revision FROM venue.monitor_devices
         WHERE tenant_id=$1::uuid AND contract_id=$2 AND revoked_at IS NULL FOR UPDATE
      ), updated AS (
        UPDATE venue.monitor_devices monitor SET target_path=$5,target_command_id=$3::uuid,target_issued_at=clock_timestamp(),
               revision=monitor.revision+1,updated_at=clock_timestamp()
          FROM locked WHERE monitor.id=locked.id
        RETURNING monitor.id,monitor.revision,monitor.target_issued_at
      ), command AS (
        INSERT INTO venue.monitor_commands(monitor_id,command_id,command_type,operation_id,target_revision,target_path,status,created_at,expires_at)
        SELECT id,$3::uuid,'navigate',$4::uuid,revision,$5,'queued',target_issued_at,target_issued_at+interval '20 seconds' FROM updated
        RETURNING command_id
      )
      SELECT $2::text AS "monitorId",$3::text AS "commandId",$5::text AS path,
             extract(epoch FROM updated.target_issued_at)*1000 AS "issuedAt",updated.revision::text
        FROM updated,command
    `, [this.context.tenantId, publicId(monitorId, "monitor_id"), commandId, operationId, path]);
    if (!result.rowCount) throw Object.assign(new Error("MONITOR_NOT_FOUND"), { code: "MONITOR_NOT_FOUND" });
    return { ...result.rows[0], issuedAt: Number(result.rows[0].issuedAt) };
  }

  async updateMonitorCommand(monitorId, commandId, status, errorCode = null) {
    const result = await this.database.query(`
      UPDATE venue.monitor_commands command SET status=$4,error_code=$5,updated_at=clock_timestamp(),
             acknowledged_at=CASE WHEN $4 IN ('loaded','applied','failed') THEN clock_timestamp() ELSE acknowledged_at END
        FROM venue.monitor_devices monitor
       WHERE command.monitor_id=monitor.id AND monitor.tenant_id=$1::uuid AND monitor.contract_id=$2
         AND command.command_id=$3::uuid
      RETURNING command.command_type AS type,command.status,command.target_path AS path,
                command.stream_sequence::text AS sequence,command.error_code AS "errorCode"
    `, [this.context.tenantId, publicId(monitorId, "monitor_id"), commandId, status, errorCode]);
    if (!result.rowCount) throw Object.assign(new Error("STALE_COMMAND"), { code: "STALE_COMMAND" });
    return result.rows[0];
  }

  async createScrollCommand(target, { monitorId, commandId, operationId, streamId, sequence, deltaY, expiresAt }) {
    const result = await target.query(`
      INSERT INTO venue.monitor_commands(
        monitor_id,command_id,command_type,operation_id,stream_id,stream_sequence,delta_y,status,created_at,expires_at
      )
      SELECT monitor.id,$3::uuid,'scroll',$4::uuid,$5::uuid,$6::bigint,$7,'queued',clock_timestamp(),$8
        FROM venue.monitor_devices monitor
       WHERE monitor.tenant_id=$1::uuid AND monitor.contract_id=$2 AND monitor.revoked_at IS NULL
      RETURNING command_id::text AS "commandId",stream_sequence::text AS sequence,
                extract(epoch FROM expires_at)*1000 AS "expiresAt"
    `, [this.context.tenantId, publicId(monitorId, "monitor_id"), commandId, operationId, streamId, sequence, deltaY, new Date(expiresAt)]);
    if (!result.rowCount) throw Object.assign(new Error("MONITOR_NOT_FOUND"), { code: "MONITOR_NOT_FOUND" });
    return { ...result.rows[0], sequence: Number(result.rows[0].sequence), expiresAt: Number(result.rows[0].expiresAt) };
  }

  async replaceCourtAssignment(target, { courtId, expectedRevision, actorPersonId, assignment }) {
    const locked = await target.query(`
      SELECT court.id,state.assignment_id,court.active,court.revision
        FROM venue.courts court JOIN venue.sites site ON site.id=court.site_id
        JOIN core.sections section ON section.id=site.section_id
        JOIN venue.court_live_state state ON state.court_id=court.id
       WHERE section.tenant_id=$1::uuid AND court.court_code=$2 FOR UPDATE OF court,state
    `, [this.context.tenantId, publicId(courtId, "court_id")]);
    if (!locked.rowCount) throw Object.assign(new Error("COURT_NOT_FOUND"), { code: "COURT_NOT_FOUND" });
    if (Number(locked.rows[0].revision) !== expectedRevision) throw Object.assign(new Error("REVISION_CONFLICT"), { code: "REVISION_CONFLICT" });
    const court = locked.rows[0];
    const actor = await target.query("SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id=$2", [this.context.tenantId, publicId(actorPersonId, "actor_person_id")]);
    if (!actor.rowCount) throw Object.assign(new Error("PERSON_NOT_FOUND"), { code: "PERSON_NOT_FOUND" });
    await target.query("UPDATE venue.court_assignments SET released_at=clock_timestamp(),released_by_person_id=$2::uuid WHERE court_id=$1::uuid AND released_at IS NULL", [court.id, actor.rows[0].id]);
    let assignmentId = null;
    if (assignment) {
      if (assignment.matchId) {
        const inserted = await target.query(`
          INSERT INTO venue.court_assignments(
            court_id,assignment_type,match_id,competition_id,match_format_version_id,competition_name_snapshot,
            round_code_snapshot,scheduled_at_snapshot,automation_status,assigned_at,assigned_by_person_id
          )
          SELECT $1::uuid,'match',match.id,competition.id,match.match_format_version_id,competition.name,
                 match.round_code,match.scheduled_at,'pending',clock_timestamp(),$4::uuid
            FROM play.matches match JOIN play.competitions competition ON competition.id=match.competition_id
            JOIN core.sections section ON section.id=competition.section_id
           WHERE section.tenant_id=$2::uuid AND match.contract_id=$3
          RETURNING id
        `, [court.id, this.context.tenantId, publicId(assignment.matchId, "match_id"), actor.rows[0].id]);
        if (!inserted.rowCount) throw Object.assign(new Error("MATCH_NOT_FOUND"), { code: "MATCH_NOT_FOUND" });
        assignmentId = inserted.rows[0].id;
        await target.query(`
          INSERT INTO venue.court_assignment_participants(assignment_id,side_no,position_no,person_id,first_name_snapshot,last_name_snapshot)
          SELECT $1::uuid,side.side_no,participant.position_no,person.id,person.first_name,person.last_name
            FROM play.match_participants participant JOIN play.match_sides side ON side.id=participant.side_id
            JOIN identity.people person ON person.id=participant.person_id
            JOIN venue.court_assignments assignment ON assignment.id=$1::uuid
           WHERE participant.match_id=assignment.match_id AND participant.participant_type='person'
        `, [assignmentId]);
      } else {
        const inserted = await target.query(`INSERT INTO venue.court_assignments(court_id,assignment_type,competition_name_snapshot,assigned_at,assigned_by_person_id)
          VALUES ($1::uuid,'manual','Individual',clock_timestamp(),$2::uuid) RETURNING id`, [court.id, actor.rows[0].id]);
        assignmentId = inserted.rows[0].id;
        for (const [sideNo, ids] of [[1, assignment.homePlayerIds], [2, assignment.guestPlayerIds]]) {
          for (let index = 0; index < ids.length; index++) {
            const participant = await target.query(`
              INSERT INTO venue.court_assignment_participants(assignment_id,side_no,position_no,person_id,first_name_snapshot,last_name_snapshot)
              SELECT $1::uuid,$2,$3,id,first_name,last_name FROM identity.people
               WHERE tenant_id=$4::uuid AND contract_id=$5 AND active RETURNING person_id
            `, [assignmentId, sideNo, index + 1, this.context.tenantId, publicId(ids[index], "person_id")]);
            if (!participant.rowCount) throw Object.assign(new Error("PERSON_NOT_FOUND"), { code: "PERSON_NOT_FOUND" });
          }
        }
      }
    }
    const revision = expectedRevision + 1;
    await target.query("UPDATE venue.courts SET revision=$2 WHERE id=$1::uuid", [court.id, revision]);
    await target.query(`UPDATE venue.court_live_state SET assignment_id=$2::uuid,awaiting_baseline=active,
      side_one_set_one='0',side_two_set_one='0',side_one_set_two='0',side_two_set_two='0',side_one_set_three='0',side_two_set_three='0',
      side_one_points='0',side_two_points='0',source_state='unknown',revision=revision+1,updated_at=clock_timestamp() WHERE court_id=$1::uuid`, [court.id, assignmentId]);
    await target.query(`INSERT INTO venue.court_state_events(court_id,assignment_id,actor_person_id,event_type,resulting_revision,occurred_at)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,clock_timestamp())`, [court.id, assignmentId, actor.rows[0].id, assignmentId ? "assignment_started" : "assignment_ended", revision]);
    return { revision, active: court.active };
  }

  async setCourtActive(target, { courtId, expectedRevision, actorPersonId, active }) {
    const result = await target.query(`
      WITH actor AS (SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id=$4),
      updated AS (
        UPDATE venue.courts court SET active=$3,revision=court.revision+1
         FROM venue.sites site,core.sections section
         WHERE court.site_id=site.id AND site.section_id=section.id AND section.tenant_id=$1::uuid
           AND court.court_code=$2 AND court.revision=$5::bigint
         RETURNING court.id,court.revision
      ), live AS (
        UPDATE venue.court_live_state state SET active=$3,awaiting_baseline=CASE WHEN $3 THEN true ELSE false END,
          revision=state.revision+1,updated_at=clock_timestamp() FROM updated WHERE state.court_id=updated.id RETURNING state.assignment_id
      )
      INSERT INTO venue.court_state_events(court_id,assignment_id,actor_person_id,event_type,resulting_revision,occurred_at)
      SELECT updated.id,live.assignment_id,actor.id,CASE WHEN $3 THEN 'activated' ELSE 'deactivated' END,updated.revision,clock_timestamp()
        FROM updated,live,actor RETURNING resulting_revision::text AS revision
    `, [this.context.tenantId, publicId(courtId, "court_id"), Boolean(active), publicId(actorPersonId, "actor_person_id"), expectedRevision]);
    if (!result.rowCount) throw Object.assign(new Error("REVISION_CONFLICT"), { code: "REVISION_CONFLICT" });
    return { revision: Number(result.rows[0].revision), active: Boolean(active) };
  }

  async updateCourtAutomation(target, { courtId, expectedRevision, active, automationStatus }) {
    const result = await target.query(`
      WITH updated AS (
        UPDATE venue.courts court SET active=COALESCE($3,court.active),revision=court.revision+1
          FROM venue.sites site,core.sections section
         WHERE court.site_id=site.id AND site.section_id=section.id AND section.tenant_id=$1::uuid
           AND court.court_code=$2 AND court.revision=$4::bigint
         RETURNING court.id,court.active,court.revision
      ), assignment AS (
        UPDATE venue.court_assignments value SET automation_status=$5
          FROM updated,venue.court_live_state state
         WHERE state.court_id=updated.id AND value.id=state.assignment_id
         RETURNING value.id
      ), live AS (
        UPDATE venue.court_live_state state SET active=updated.active,
          awaiting_baseline=CASE WHEN updated.active<>state.active AND updated.active THEN true ELSE state.awaiting_baseline END,
          revision=state.revision+1,updated_at=clock_timestamp()
          FROM updated WHERE state.court_id=updated.id RETURNING state.assignment_id
      )
      SELECT updated.revision::text AS revision,updated.active FROM updated,live
    `, [this.context.tenantId, publicId(courtId, "court_id"), active === null ? null : Boolean(active), expectedRevision, automationStatus]);
    if (!result.rowCount) throw Object.assign(new Error("REVISION_CONFLICT"), { code: "REVISION_CONFLICT" });
    return { revision: Number(result.rows[0].revision), active: result.rows[0].active };
  }

  async provisionMonitorOn(target, label, monitorId) {
    const normalizedLabel = String(label || "").trim();
    if (!normalizedLabel || normalizedLabel.length > 160) throw Object.assign(new Error("MONITOR_LABEL_INVALID"), { code: "MONITOR_LABEL_INVALID" });
    const id = publicId(monitorId, "monitor_id");
    const token = crypto.randomBytes(32).toString("base64url");
    const result = await target.query(`
      INSERT INTO venue.monitor_devices(tenant_id, contract_id, label, token_hash, target_type, page_key)
      VALUES ($1::uuid,$2,$3,$4,'page','index')
      RETURNING contract_id AS "monitorId", label, created_at AS "createdAt"
    `, [this.context.tenantId, id, normalizedLabel, crypto.createHash("sha256").update(token).digest()]);
    return { ...this.monitorProjection(result.rows[0]), token };
  }

  provisionMonitor(label, monitorId) { return this.provisionMonitorOn(this.database, label, monitorId); }

  async rotateMonitorTokenOn(target, monitorId) {
    const id = publicId(monitorId, "monitor_id");
    const token = crypto.randomBytes(32).toString("base64url");
    const result = await target.query(`
      UPDATE venue.monitor_devices SET token_hash=$3, revoked_at=NULL, revision=revision+1, updated_at=clock_timestamp()
       WHERE tenant_id=$1::uuid AND contract_id=$2
       RETURNING contract_id AS "monitorId", updated_at AS "updatedAt"
    `, [this.context.tenantId, id, crypto.createHash("sha256").update(token).digest()]);
    if (!result.rowCount) throw Object.assign(new Error("MONITOR_NOT_FOUND"), { code: "MONITOR_NOT_FOUND" });
    return { ...this.monitorProjection(result.rows[0]), token };
  }

  rotateMonitorToken(monitorId) { return this.rotateMonitorTokenOn(this.database, monitorId); }

  async revokeMonitorOn(target, monitorId) {
    const result = await target.query(`
      UPDATE venue.monitor_devices SET revoked_at=clock_timestamp(), revision=revision+1, updated_at=clock_timestamp()
       WHERE tenant_id=$1::uuid AND contract_id=$2
       RETURNING contract_id AS "monitorId", revoked_at AS "revokedAt"
    `, [this.context.tenantId, publicId(monitorId, "monitor_id")]);
    if (!result.rowCount) throw Object.assign(new Error("MONITOR_NOT_FOUND"), { code: "MONITOR_NOT_FOUND" });
    return this.monitorProjection(result.rows[0]);
  }
  revokeMonitor(monitorId) { return this.revokeMonitorOn(this.database, monitorId); }

  async deleteMonitorOn(target, monitorId) {
    const id = publicId(monitorId, "monitor_id");
    const current = await target.query(`
      SELECT revoked_at FROM venue.monitor_devices
       WHERE tenant_id=$1::uuid AND contract_id=$2 FOR UPDATE
    `, [this.context.tenantId, id]);
    if (!current.rowCount) throw Object.assign(new Error("MONITOR_NOT_FOUND"), { code: "MONITOR_NOT_FOUND" });
    if (current.rows[0].revoked_at === null) throw Object.assign(new Error("MONITOR_NOT_REVOKED"), { code: "MONITOR_NOT_REVOKED" });
    await target.query(`
      DELETE FROM venue.monitor_devices WHERE tenant_id=$1::uuid AND contract_id=$2 AND revoked_at IS NOT NULL
    `, [this.context.tenantId, id]);
    return { monitorId: id, deleted: true };
  }

  async navigationPresets(profileCode = "1") {
    const profile = profileCode === null ? null : String(profileCode || "").trim();
    if (profile !== null && (!profile || profile.length > 64)) throw Object.assign(new Error("PROFILE_CODE_INVALID"), { code: "PROFILE_CODE_INVALID" });
    const result = await this.database.query(`
      SELECT COALESCE(preset.contract_id, preset.id::text) AS id, preset.profile_code AS "profileCode", preset.label, preset.target_type AS "targetType", preset.page_key AS "pageKey",
             competition.contract_id AS "competitionId", grid.contract_id AS "hallTimeGridId",
              preset.enabled, preset.problem_code AS "problemCode", preset.sort_order AS "sortOrder",
              preset.legacy_target AS "legacyTarget", competition_type.round_robin AS "roundRobin"
        FROM venue.navigation_presets preset
         LEFT JOIN play.competitions competition ON competition.id=preset.competition_id
         LEFT JOIN play.competition_type_versions competition_type ON competition_type.id=competition.competition_type_version_id
        LEFT JOIN venue.hall_time_grids grid ON grid.id=preset.hall_time_grid_id
       WHERE preset.tenant_id=$1::uuid AND ($2::text IS NULL OR preset.profile_code=$2)
       ORDER BY preset.profile_code, preset.sort_order NULLS LAST, preset.label
    `, [this.context.tenantId, profile]);
    return result.rows;
  }
}

module.exports = { SCORE_KEYS, VenueRepository, scoreProjection };
