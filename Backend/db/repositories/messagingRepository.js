"use strict";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTRACT_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const CODE = /^[a-z][a-z0-9_.-]{1,126}$/;

function identifier(value, field, pattern = CONTRACT_ID) {
  const normalized = String(value || "").trim();
  if (!pattern.test(normalized)) throw Object.assign(new Error(`${field.toUpperCase()}_INVALID`), { code: `${field.toUpperCase()}_INVALID` });
  return normalized;
}

function parameterValue(value, type) {
  if (value === null) return true;
  if (type === "boolean") return typeof value === "boolean";
  if (type === "count") return Number.isSafeInteger(value) && value >= 0;
  if (type === "id") return typeof value === "string" && CONTRACT_ID.test(value);
  if (type === "status") return typeof value === "string" && /^[a-z][a-z0-9_.-]{0,63}$/.test(value);
  if (type === "timestamp") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
  return false;
}

function parameters(value, contract) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("MESSAGE_PARAMETERS_INVALID"), { code: "MESSAGE_PARAMETERS_INVALID" });
  for (const [key, entry] of Object.entries(value)) {
    const type = contract.get(key);
    if (!type) throw Object.assign(new Error("MESSAGE_PARAMETER_UNKNOWN"), { code: "MESSAGE_PARAMETER_UNKNOWN" });
    if (!parameterValue(entry, type)) throw Object.assign(new Error("MESSAGE_PARAMETER_INVALID"), { code: "MESSAGE_PARAMETER_INVALID" });
  }
  if (JSON.stringify(value).length > 4096) throw Object.assign(new Error("MESSAGE_PARAMETERS_TOO_LARGE"), { code: "MESSAGE_PARAMETERS_TOO_LARGE" });
  return value;
}

function canonicalParameters(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function optionalText(value, field, max, pattern = null) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) throw Object.assign(new Error(`${field.toUpperCase()}_INVALID`), { code: `${field.toUpperCase()}_INVALID` });
  return normalized;
}

class PostgresMessagingRepository {
  constructor({ database, context, eventContracts = {}, log = () => {} }) {
    this.database = database;
    this.context = context;
    this.log = log;
    this.eventContracts = new Map();
    for (const [eventType, definition] of Object.entries(eventContracts)) {
      const type = identifier(eventType, "event_type", CODE);
      const templateKey = identifier(definition?.templateKey, "template_key", CODE);
      const templateVersion = definition?.templateVersion;
      if (!Number.isInteger(templateVersion) || templateVersion < 1) throw Object.assign(new Error("MESSAGE_TEMPLATE_VERSION_INVALID"), { code: "MESSAGE_TEMPLATE_VERSION_INVALID" });
      const parameterContract = new Map(Object.entries(definition?.parameters || {}));
      if ([...parameterContract].some(([key, value]) => !/^[a-z][A-Za-z0-9]{0,63}$/.test(key) || !new Set(["boolean", "count", "id", "status", "timestamp"]).has(value))) {
        throw Object.assign(new Error("MESSAGE_PARAMETER_CONTRACT_INVALID"), { code: "MESSAGE_PARAMETER_CONTRACT_INVALID" });
      }
      this.eventContracts.set(type, Object.freeze({ templateKey, templateVersion, parameters: parameterContract }));
    }
  }

  eventContract(eventType) {
    const type = identifier(eventType, "event_type", CODE);
    const contract = this.eventContracts.get(type);
    if (!contract) throw Object.assign(new Error("MESSAGE_EVENT_NOT_REGISTERED"), { code: "MESSAGE_EVENT_NOT_REGISTERED" });
    return { type, contract };
  }

  async inbox(personId, { limit = 20, before = null } = {}) {
    const id = identifier(personId, "person_id");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error("MESSAGE_LIMIT_INVALID"), { code: "MESSAGE_LIMIT_INVALID" });
    if (before !== null && !UUID.test(String(before))) throw Object.assign(new Error("MESSAGE_CURSOR_INVALID"), { code: "MESSAGE_CURSOR_INVALID" });
    if (before !== null) {
      const cursor = await this.database.query(`
        SELECT 1 FROM messaging.event_recipients recipient
        JOIN messaging.events event ON event.id=recipient.event_id
        JOIN identity.people person ON person.id=recipient.person_id
        WHERE event.tenant_id=$1::uuid AND person.contract_id=$2 AND recipient.id=$3::uuid
      `, [this.context.tenantId, id, before]);
      if (!cursor.rowCount) throw Object.assign(new Error("MESSAGE_CURSOR_INVALID"), { code: "MESSAGE_CURSOR_INVALID" });
    }
    const result = await this.database.query(`
       WITH cursor_row AS (
         SELECT recipient.created_at,recipient.id,(receipt.acknowledged_at IS NOT NULL) AS acknowledged
           FROM messaging.event_recipients recipient
           JOIN messaging.events event ON event.id=recipient.event_id
           JOIN identity.people person ON person.id=recipient.person_id
           LEFT JOIN messaging.receipts receipt ON receipt.recipient_id=recipient.id
          WHERE event.tenant_id=$1::uuid AND person.contract_id=$2 AND recipient.id=$3::uuid
       )
       SELECT recipient.id::text AS id, event.contract_id AS "eventId", event.event_type AS "eventType",
              recipient.template_key AS "templateKey", recipient.template_version AS "templateVersion",
              recipient.template_parameters AS parameters, recipient.legacy_subject AS "legacySubject",
              recipient.legacy_body AS "legacyBody", recipient.created_at AS "createdAt",
              receipt.read_at AS "readAt", receipt.acknowledged_at AS "acknowledgedAt", receipt.revision::text AS revision,
              competition.contract_id AS "competitionId", event.source_type AS source,event.source_contract_id AS "sourceId",
              event.actor_name_snapshot AS "actorName",event.summary_snapshot AS summary,event.detail_snapshot AS detail,
              event.result_snapshot AS result
         FROM messaging.event_recipients recipient
         JOIN messaging.events event ON event.id=recipient.event_id
         JOIN identity.people person ON person.id=recipient.person_id
         LEFT JOIN play.competitions competition ON competition.id=event.competition_id
         LEFT JOIN messaging.receipts receipt ON receipt.recipient_id=recipient.id
        WHERE event.tenant_id=$1::uuid AND person.contract_id=$2
          AND ($3::uuid IS NULL OR
            (receipt.acknowledged_at IS NOT NULL)>(SELECT acknowledged FROM cursor_row)
            OR ((receipt.acknowledged_at IS NOT NULL)=(SELECT acknowledged FROM cursor_row)
              AND (recipient.created_at<(SELECT created_at FROM cursor_row)
                OR (recipient.created_at=(SELECT created_at FROM cursor_row) AND recipient.id<(SELECT id FROM cursor_row)))))
        ORDER BY (receipt.acknowledged_at IS NOT NULL), recipient.created_at DESC, recipient.id DESC
        LIMIT $4
    `, [this.context.tenantId, id, before, limit]);
    return result.rows;
  }

  async inboxPage(personId, options = {}) {
    const limit = options.limit || 20;
    const rows = await this.inbox(personId, { ...options, limit: limit + 1 });
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit);
    return { messages, nextCursor: hasMore ? messages.at(-1).id : null };
  }

  async inboxMessage(personId, messageId) {
    if (!UUID.test(String(messageId))) throw Object.assign(new Error("MESSAGE_ID_INVALID"), { code: "MESSAGE_ID_INVALID" });
    const result = await this.database.query(`
      SELECT recipient.id::text AS id,event.contract_id AS "eventId",event.event_type AS "eventType",
             recipient.template_key AS "templateKey",recipient.template_version AS "templateVersion",
             recipient.template_parameters AS parameters,recipient.legacy_subject AS "legacySubject",
             recipient.legacy_body AS "legacyBody",recipient.created_at AS "createdAt",
             receipt.read_at AS "readAt",receipt.acknowledged_at AS "acknowledgedAt",receipt.revision::text AS revision,
             competition.contract_id AS "competitionId",event.source_type AS source,event.source_contract_id AS "sourceId",
             event.actor_name_snapshot AS "actorName",event.summary_snapshot AS summary,event.detail_snapshot AS detail,
             event.result_snapshot AS result
        FROM messaging.event_recipients recipient
        JOIN messaging.events event ON event.id=recipient.event_id
        JOIN identity.people person ON person.id=recipient.person_id
        LEFT JOIN play.competitions competition ON competition.id=event.competition_id
        LEFT JOIN messaging.receipts receipt ON receipt.recipient_id=recipient.id
       WHERE event.tenant_id=$1::uuid AND person.contract_id=$2 AND recipient.id=$3::uuid
    `, [this.context.tenantId, identifier(personId, "person_id"), messageId]);
    return result.rows[0] || null;
  }

  async summary(personId) {
    const result = await this.database.query(`
      SELECT count(recipient.id) FILTER (WHERE receipt.read_at IS NULL)::integer AS "unreadCount",
             count(recipient.id)::integer AS "messageCount",
             COALESCE(revision.revision, 0)::text AS revision
        FROM identity.people person
        LEFT JOIN messaging.event_recipients recipient ON recipient.person_id=person.id
        LEFT JOIN messaging.receipts receipt ON receipt.recipient_id=recipient.id
        LEFT JOIN messaging.user_revisions revision ON revision.person_id=person.id
       WHERE person.tenant_id=$1::uuid AND person.contract_id=$2
       GROUP BY revision.revision
    `, [this.context.tenantId, identifier(personId, "person_id")]);
    return result.rows[0] || null;
  }

  async historyRevision() {
    const result = await this.database.query("SELECT revision::text AS revision FROM messaging.history_revision WHERE singleton=true");
    return result.rows[0]?.revision || "0";
  }

  historyInteractionRevision() { return this.historyRevision(); }

  async competitionHistory(competitionId = null, { cursor = null, limit = 50 } = {}) {
    const competition = competitionId === null ? null : identifier(competitionId, "competition_id");
    if (cursor !== null) identifier(cursor, "history_cursor");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error("HISTORY_LIMIT_INVALID"), { code: "HISTORY_LIMIT_INVALID" });
    if (cursor !== null) {
      const valid = await this.database.query(`
        SELECT 1 FROM messaging.events event LEFT JOIN play.competitions competition ON competition.id=event.competition_id
         WHERE event.tenant_id=$1::uuid AND event.contract_id=$2 AND ($3::text IS NULL OR competition.contract_id=$3)
      `, [this.context.tenantId, cursor, competition]);
      if (!valid.rowCount) throw Object.assign(new Error("COMPETITION_HISTORY_CURSOR_INVALID"), { code: "COMPETITION_HISTORY_CURSOR_INVALID" });
    }
    const result = await this.database.query(`
      WITH cursor_row AS (
        SELECT created_at, id FROM messaging.events WHERE tenant_id=$1::uuid AND contract_id=$3
      )
      SELECT event.contract_id AS id, competition.contract_id AS "competitionId",
             event.event_type AS type, event.source_type AS source, event.source_contract_id AS "sourceId",
             extract(epoch FROM event.created_at)*1000 AS "createdAt", event.summary_snapshot AS summary,
             event.detail_snapshot AS detail, event.result_snapshot AS result, event.actor_name_snapshot AS "actorName",
             COALESCE(jsonb_agg(jsonb_build_object(
               'participantRole',participant.participant_role,
               'displayName',concat_ws(' ',participant.first_name_snapshot,participant.last_name_snapshot)
             ) ORDER BY participant.participant_role,participant.contract_id_snapshot)
               FILTER (WHERE participant.event_id IS NOT NULL),'[]'::jsonb) AS participants
        FROM messaging.events event
        LEFT JOIN play.competitions competition ON competition.id=event.competition_id
        LEFT JOIN messaging.event_participants participant ON participant.event_id=event.id
       WHERE event.tenant_id=$1::uuid AND ($2::text IS NULL OR competition.contract_id=$2)
         AND ($3::text IS NULL OR (event.created_at,event.id)<(SELECT created_at,id FROM cursor_row))
       GROUP BY event.id,competition.contract_id
       ORDER BY event.created_at DESC,event.id DESC
       LIMIT $4
    `, [this.context.tenantId, competition, cursor, limit + 1]);
    const hasMore = result.rows.length > limit;
    const events = result.rows.slice(0, limit).map((event) => ({ ...event, createdAt: Number(event.createdAt) }));
    return { events, nextCursor: hasMore ? events.at(-1).id : null };
  }

  async comments(eventId, { cursor = null, limit = 30 } = {}) {
    const event = identifier(eventId, "event_id");
    if (cursor !== null && !UUID.test(String(cursor))) throw Object.assign(new Error("COMMENT_CURSOR_INVALID"), { code: "COMMENT_CURSOR_INVALID" });
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error("COMMENT_LIMIT_INVALID"), { code: "COMMENT_LIMIT_INVALID" });
    if (cursor !== null) {
      const valid = await this.database.query(`
        SELECT 1 FROM messaging.comments comment JOIN messaging.events event ON event.id=comment.event_id
         WHERE event.tenant_id=$1::uuid AND event.contract_id=$2 AND comment.id=$3::uuid
      `, [this.context.tenantId, event, cursor]);
      if (!valid.rowCount) throw Object.assign(new Error("COMPETITION_HISTORY_COMMENT_CURSOR_INVALID"), { code: "COMPETITION_HISTORY_COMMENT_CURSOR_INVALID" });
    }
    const result = await this.database.query(`
      WITH cursor_row AS (SELECT created_at,id FROM messaging.comments WHERE id=$3::uuid)
      SELECT comment.id::text AS id, event.contract_id AS "eventId", person.contract_id AS "authorId",
             concat_ws(' ',comment.author_first_name_snapshot,comment.author_last_name_snapshot) AS "authorName",
             comment.body, comment.moderation_status AS status,
             extract(epoch FROM comment.created_at)*1000 AS "createdAt",
             extract(epoch FROM COALESCE(comment.updated_at,comment.created_at))*1000 AS "updatedAt"
        FROM messaging.comments comment
        JOIN messaging.events event ON event.id=comment.event_id
        LEFT JOIN identity.people person ON person.id=comment.author_person_id
       WHERE event.tenant_id=$1::uuid AND event.contract_id=$2 AND comment.deleted_at IS NULL
         AND ($3::uuid IS NULL OR (comment.created_at,comment.id)<(SELECT created_at,id FROM cursor_row))
       ORDER BY comment.created_at DESC,comment.id DESC LIMIT $4
    `, [this.context.tenantId, event, cursor, limit + 1]);
    const hasMore = result.rows.length > limit;
    const comments = result.rows.slice(0, limit).map((comment) => ({ ...comment, createdAt: Number(comment.createdAt), updatedAt: Number(comment.updatedAt) }));
    return { comments, nextCursor: hasMore ? comments.at(-1).id : null };
  }

  async interactionSummaries(eventIds, personId) {
    if (!Array.isArray(eventIds) || eventIds.length > 100) throw Object.assign(new Error("EVENT_IDS_INVALID"), { code: "EVENT_IDS_INVALID" });
    if (!eventIds.length) return new Map();
    const ids = eventIds.map((value) => identifier(value, "event_id"));
    const result = await this.database.query(`
      SELECT event.contract_id AS id,
             (SELECT count(*)::integer FROM messaging.comments comment WHERE comment.event_id=event.id AND comment.deleted_at IS NULL) AS "commentCount",
             (SELECT count(*)::integer FROM messaging.reactions reaction WHERE reaction.event_id=event.id) AS "reactionTotal",
             COALESCE((SELECT jsonb_agg(jsonb_build_object('key',grouped.reaction_key,'count',grouped.count) ORDER BY grouped.reaction_key)
                         FROM (SELECT reaction_key,count(*)::integer AS count FROM messaging.reactions WHERE event_id=event.id GROUP BY reaction_key) grouped),'[]'::jsonb) AS reactions,
             (SELECT reaction.reaction_key FROM messaging.reactions reaction JOIN identity.people person ON person.id=reaction.person_id
               WHERE reaction.event_id=event.id AND person.contract_id=$3) AS "myReaction"
        FROM messaging.events event WHERE event.tenant_id=$1::uuid AND event.contract_id=ANY($2::text[])
    `, [this.context.tenantId, ids, identifier(personId, "person_id")]);
    return new Map(result.rows.map((row) => [row.id, row]));
  }

  async commentReactionSummaries(commentIds, personId) {
    if (!Array.isArray(commentIds) || commentIds.length > 100 || commentIds.some((value) => !UUID.test(String(value)))) throw Object.assign(new Error("COMMENT_IDS_INVALID"), { code: "COMMENT_IDS_INVALID" });
    if (!commentIds.length) return new Map();
    const result = await this.database.query(`
      SELECT comment.id::text AS id,
             count(reaction.id)::integer AS "reactionTotal",
             COALESCE(jsonb_agg(jsonb_build_object('key',reaction.reaction_key,'count',reaction.group_count) ORDER BY reaction.reaction_key)
               FILTER (WHERE reaction.reaction_key IS NOT NULL),'[]'::jsonb) AS reactions,
             max(reaction.reaction_key) FILTER (WHERE person.contract_id=$2) AS "myReaction"
        FROM messaging.comments comment
        LEFT JOIN (
          SELECT reaction.*,count(*) OVER (PARTITION BY reaction.comment_id,reaction.reaction_key)::integer AS group_count
            FROM messaging.reactions reaction WHERE reaction.comment_id=ANY($1::uuid[])
        ) reaction ON reaction.comment_id=comment.id
        LEFT JOIN identity.people person ON person.id=reaction.person_id
       WHERE comment.id=ANY($1::uuid[])
       GROUP BY comment.id
    `, [commentIds, identifier(personId, "person_id")]);
    return new Map(result.rows.map((row) => [row.id, { ...row, reactions: row.reactions.filter((entry, index, values) => values.findIndex((other) => other.key === entry.key) === index) }]));
  }

  async interactionPerson(target, personId) {
    const result = await target.query("SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id=$2 AND active", [this.context.tenantId, identifier(personId, "person_id")]);
    if (!result.rowCount) throw Object.assign(new Error("PERSON_NOT_FOUND"), { code: "PERSON_NOT_FOUND" });
    return result.rows[0].id;
  }

  async interactionEvent(target, eventId) {
    const result = await target.query(`
      SELECT event.id, event.contract_id AS "eventId", competition.contract_id AS "competitionId"
        FROM messaging.events event
        LEFT JOIN play.competitions competition ON competition.id=event.competition_id
       WHERE event.tenant_id=$1::uuid AND event.contract_id=$2
       FOR UPDATE OF event
    `, [this.context.tenantId, identifier(eventId, "event_id")]);
    if (!result.rowCount) throw Object.assign(new Error("COMPETITION_HISTORY_EVENT_NOT_FOUND"), { code: "COMPETITION_HISTORY_EVENT_NOT_FOUND" });
    return result.rows[0];
  }

  async bumpHistory(target, operationId, eventId) {
    const revision = await target.query(`
      INSERT INTO messaging.history_revision(singleton, revision) VALUES (true,1)
      ON CONFLICT (singleton) DO UPDATE SET revision=messaging.history_revision.revision+1,updated_at=clock_timestamp()
      RETURNING revision::text
    `);
    await this.queueInvalidation(target, operationId, eventId);
    return revision.rows[0].revision;
  }

  async queueInvalidation(target, operationId, eventId) {
    await target.query(`
      INSERT INTO ops.outbox(tenant_id,event_type,payload_version,payload,idempotency_key,status,available_at)
      VALUES ($1::uuid,'websocket.invalidate',1,jsonb_build_object('eventId',$2::text,'projection','messaging'),$3,'pending',clock_timestamp())
    `, [this.context.tenantId, eventId, `interaction:${operationId}`]);
    await target.query("SELECT pg_notify('epiber_worker_wake','')");
  }

  async addComment(target, { operationId, personId, personName, eventId, body }) {
    if (!UUID.test(String(operationId))) throw Object.assign(new Error("OPERATION_ID_INVALID"), { code: "OPERATION_ID_INVALID" });
    const [event, authorId] = await Promise.all([this.interactionEvent(target, eventId), this.interactionPerson(target, personId)]);
    const name = String(personName || "").trim().split(/\s+/);
    await target.query(`
      INSERT INTO messaging.comments(
        id,event_id,author_person_id,author_contract_id_snapshot,author_first_name_snapshot,author_last_name_snapshot,
        body,created_at,moderation_status
      ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,clock_timestamp(),'visible')
    `, [operationId, event.id, authorId, String(personId), name.length > 1 ? name.slice(0, -1).join(" ") : null, name.at(-1) || String(personId), body]);
    await this.bumpHistory(target, operationId, event.eventId);
    return { success: true, changed: true, commentId: operationId, eventId: event.eventId, competitionId: event.competitionId };
  }

  async comment(target, commentId, { lock = false } = {}) {
    if (!UUID.test(String(commentId))) throw Object.assign(new Error("COMMENT_ID_INVALID"), { code: "COMMENT_ID_INVALID" });
    const result = await target.query(`
      SELECT comment.id::text AS id,event.contract_id AS "eventId",competition.contract_id AS "competitionId",
             person.contract_id AS "authorId",concat_ws(' ',comment.author_first_name_snapshot,comment.author_last_name_snapshot) AS "authorName",
             comment.body,comment.moderation_status AS status,
             extract(epoch FROM comment.created_at)*1000 AS "createdAt",
             extract(epoch FROM COALESCE(comment.updated_at,comment.created_at))*1000 AS "updatedAt"
        FROM messaging.comments comment
        JOIN messaging.events event ON event.id=comment.event_id
        LEFT JOIN play.competitions competition ON competition.id=event.competition_id
        LEFT JOIN identity.people person ON person.id=comment.author_person_id
       WHERE event.tenant_id=$1::uuid AND comment.id=$2::uuid AND comment.deleted_at IS NULL
       ${lock ? "FOR UPDATE OF comment" : ""}
    `, [this.context.tenantId, commentId]);
    if (!result.rowCount) throw Object.assign(new Error("COMPETITION_HISTORY_COMMENT_NOT_FOUND"), { code: "COMPETITION_HISTORY_COMMENT_NOT_FOUND" });
    const row = result.rows[0];
    return { ...row, createdAt: Number(row.createdAt), updatedAt: Number(row.updatedAt) };
  }

  async editComment(target, { operationId, personId, commentId, body }) {
    const comment = await this.comment(target, commentId, { lock: true });
    if (comment.authorId !== String(personId)) throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    const changed = comment.body !== body;
    if (changed) {
      await target.query("UPDATE messaging.comments SET body=$2,updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1::uuid", [commentId, body]);
      await this.bumpHistory(target, operationId, comment.eventId);
    }
    return { success: true, changed, commentId, eventId: comment.eventId, competitionId: comment.competitionId };
  }

  async deleteComment(target, { operationId, personId, admin, commentId }) {
    const comment = await this.comment(target, commentId, { lock: true });
    if (comment.authorId !== String(personId) && !admin) throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    await target.query("DELETE FROM messaging.reactions WHERE comment_id=$1::uuid", [commentId]);
    await target.query(`
      UPDATE messaging.comments SET author_person_id=NULL,author_contract_id_snapshot=NULL,
        author_first_name_snapshot=NULL,author_last_name_snapshot=NULL,body=NULL,deleted_at=clock_timestamp(),
        deletion_status=$2,updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1::uuid
    `, [commentId, admin && comment.authorId !== String(personId) ? "deleted_by_admin" : "deleted_by_author"]);
    await this.bumpHistory(target, operationId, comment.eventId);
    return { success: true, changed: true, commentId, eventId: comment.eventId, competitionId: comment.competitionId };
  }

  async moderateComment(target, { operationId, personId, commentId, status }) {
    const comment = await this.comment(target, commentId, { lock: true });
    const changed = comment.status !== status;
    if (changed) {
      const moderatorId = await this.interactionPerson(target, personId);
      await target.query(`UPDATE messaging.comments SET moderation_status=$2,moderated_at=clock_timestamp(),moderated_by_person_id=$3::uuid,
        updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1::uuid`, [commentId, status, moderatorId]);
      await this.bumpHistory(target, operationId, comment.eventId);
    }
    return { success: true, changed, commentId, eventId: comment.eventId, competitionId: comment.competitionId, status };
  }

  async setReaction(target, { operationId, personId, eventId = null, commentId = null, reactionKey }) {
    const personInternalId = await this.interactionPerson(target, personId);
    let context;
    if (eventId) context = await this.interactionEvent(target, eventId);
    else {
      const comment = await this.comment(target, commentId, { lock: true });
      context = { eventId: comment.eventId, competitionId: comment.competitionId, commentId, status: comment.status };
    }
    const column = eventId ? "event_id" : "comment_id";
    const targetId = eventId ? context.id : commentId;
    const existing = await target.query(`SELECT reaction_key FROM messaging.reactions WHERE ${column}=$1::uuid AND person_id=$2::uuid FOR UPDATE`, [targetId, personInternalId]);
    const prior = existing.rows[0]?.reaction_key || null;
    const changed = prior !== reactionKey;
    if (changed && reactionKey === null) await target.query(`DELETE FROM messaging.reactions WHERE ${column}=$1::uuid AND person_id=$2::uuid`, [targetId, personInternalId]);
    if (changed && reactionKey !== null) {
      await target.query(`
        INSERT INTO messaging.reactions(${column},person_id,reaction_key,created_at) VALUES ($1::uuid,$2::uuid,$3,clock_timestamp())
        ON CONFLICT (${column},person_id) WHERE ${column} IS NOT NULL DO UPDATE SET reaction_key=excluded.reaction_key,created_at=excluded.created_at
      `, [targetId, personInternalId, reactionKey]);
    }
    if (changed) await this.bumpHistory(target, operationId, context.eventId);
    return {
      success: true, changed, ...(eventId ? { eventId } : { commentId }), eventId: context.eventId,
      competitionId: context.competitionId, myReaction: reactionKey,
    };
  }

  async eventReactionDetails(eventId) {
    const event = await this.interactionEvent(this.database, eventId);
    const result = await this.database.query(`
      SELECT reaction.reaction_key AS key,person.contract_id AS "userId",
             concat_ws(' ',person.first_name,person.last_name) AS "userName",
             extract(epoch FROM reaction.created_at)*1000 AS "createdAt"
        FROM messaging.reactions reaction
        JOIN identity.people person ON person.id=reaction.person_id
       WHERE reaction.event_id=$1::uuid ORDER BY reaction.reaction_key,lower(person.last_name),lower(person.first_name),person.contract_id::numeric
    `, [event.id]);
    return { event, reactions: result.rows.map((row) => ({ ...row, createdAt: Number(row.createdAt) })) };
  }

  async commentReactionDetails(commentId) {
    const comment = await this.comment(this.database, commentId);
    const result = await this.database.query(`
      SELECT reaction.reaction_key AS key,person.contract_id AS "userId",
             concat_ws(' ',person.first_name,person.last_name) AS "userName",
             extract(epoch FROM reaction.created_at)*1000 AS "createdAt"
        FROM messaging.reactions reaction
        JOIN identity.people person ON person.id=reaction.person_id
       WHERE reaction.comment_id=$1::uuid ORDER BY reaction.reaction_key,lower(person.last_name),lower(person.first_name),person.contract_id::numeric
    `, [commentId]);
    return { comment, reactions: result.rows.map((row) => ({ ...row, createdAt: Number(row.createdAt) })) };
  }

  async acknowledgeOn(transaction, personId, recipientId) {
    if (!UUID.test(String(recipientId || ""))) throw Object.assign(new Error("MESSAGE_ID_INVALID"), { code: "MESSAGE_ID_INVALID" });
      const target = await transaction.query(`
        SELECT recipient.id, recipient.person_id, receipt.acknowledged_at AS "acknowledgedAt",
               COALESCE(receipt.revision, 0)::text AS revision
          FROM messaging.event_recipients recipient
          JOIN messaging.events event ON event.id=recipient.event_id
          JOIN identity.people person ON person.id=recipient.person_id
          LEFT JOIN messaging.receipts receipt ON receipt.recipient_id=recipient.id
         WHERE event.tenant_id=$1::uuid AND person.contract_id=$2 AND recipient.id=$3::uuid
         FOR UPDATE OF recipient
      `, [this.context.tenantId, identifier(personId, "person_id"), recipientId]);
      if (!target.rowCount) throw Object.assign(new Error("MESSAGE_NOT_FOUND"), { code: "MESSAGE_NOT_FOUND" });
      if (target.rows[0].acknowledgedAt) {
        const revision = await transaction.query("SELECT revision::text AS revision FROM messaging.user_revisions WHERE person_id=$1::uuid", [target.rows[0].person_id]);
        return { revision: target.rows[0].revision, userRevision: revision.rows[0]?.revision || "0", acknowledgedAt: target.rows[0].acknowledgedAt.getTime(), duplicate: true, changed: false };
      }
      const receipt = await transaction.query(`
        INSERT INTO messaging.receipts(recipient_id, read_at, acknowledged_at)
        VALUES ($1::uuid, clock_timestamp(), clock_timestamp())
        ON CONFLICT (recipient_id) DO UPDATE
          SET read_at=COALESCE(messaging.receipts.read_at, EXCLUDED.read_at),
              acknowledged_at=EXCLUDED.acknowledged_at,
              revision=messaging.receipts.revision+1
        RETURNING revision::text,acknowledged_at AS "acknowledgedAt"
      `, [target.rows[0].id]);
      const bumped = await transaction.query(`
        INSERT INTO messaging.user_revisions(person_id, revision)
        VALUES ($1::uuid, 1)
        ON CONFLICT (person_id) DO UPDATE SET revision=messaging.user_revisions.revision+1, updated_at=clock_timestamp()
        RETURNING revision::text
      `, [target.rows[0].person_id]);
      return { revision: receipt.rows[0].revision, userRevision: bumped.rows[0].revision, acknowledgedAt: receipt.rows[0].acknowledgedAt.getTime(), duplicate: false, changed: true };
  }

  async acknowledge(personId, recipientId) {
    return this.database.withTransaction("messaging.acknowledge", (transaction) => this.acknowledgeOn(transaction, personId, recipientId));
  }

  async acknowledgeAllOn(transaction, personId) {
    const person = await transaction.query("SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id=$2 FOR UPDATE", [this.context.tenantId, identifier(personId, "person_id")]);
    if (!person.rowCount) throw Object.assign(new Error("PERSON_NOT_FOUND"), { code: "PERSON_NOT_FOUND" });
    const updated = await transaction.query(`
      INSERT INTO messaging.receipts(recipient_id,read_at,acknowledged_at)
      SELECT recipient.id,clock_timestamp(),clock_timestamp()
        FROM messaging.event_recipients recipient
        LEFT JOIN messaging.receipts receipt ON receipt.recipient_id=recipient.id
       WHERE recipient.person_id=$1::uuid AND receipt.acknowledged_at IS NULL
      ON CONFLICT (recipient_id) DO UPDATE SET
        read_at=COALESCE(messaging.receipts.read_at,excluded.read_at),acknowledged_at=excluded.acknowledged_at,
        revision=messaging.receipts.revision+1
      RETURNING recipient_id
    `, [person.rows[0].id]);
    let revision;
    if (updated.rowCount) {
      const bumped = await transaction.query(`
        INSERT INTO messaging.user_revisions(person_id,revision) VALUES ($1::uuid,1)
        ON CONFLICT (person_id) DO UPDATE SET revision=messaging.user_revisions.revision+1,updated_at=clock_timestamp()
        RETURNING revision::text
      `, [person.rows[0].id]);
      revision = bumped.rows[0].revision;
    } else {
      const current = await transaction.query("SELECT revision::text FROM messaging.user_revisions WHERE person_id=$1::uuid", [person.rows[0].id]);
      revision = current.rows[0]?.revision || "0";
    }
    const summary = await transaction.query(`
      SELECT count(recipient.id) FILTER (WHERE receipt.read_at IS NULL)::integer AS "unreadCount",
             count(recipient.id)::integer AS "messageCount"
        FROM messaging.event_recipients recipient LEFT JOIN messaging.receipts receipt ON receipt.recipient_id=recipient.id
       WHERE recipient.person_id=$1::uuid
    `, [person.rows[0].id]);
    return { changed: updated.rowCount > 0, changedCount: updated.rowCount, ...summary.rows[0], revision };
  }

  async createEvent({
    contractId, eventType, operationId, templateParameters = {}, competitionId = null, matchId = null,
    participants = [], recipients = [], readPersonIds = [], createdAt = new Date(), sourceType = null,
    sourceId = null, actorPersonId = null, actorName = null, summary = null, detail = null, result = null,
  }, existingTransaction = null) {
    const { type, contract } = this.eventContract(eventType);
    const messageId = identifier(contractId, "message_id");
    const competition = competitionId === null ? null : identifier(competitionId, "competition_id");
    const match = matchId === null ? null : identifier(matchId, "match_id");
    if (match !== null && competition === null) throw Object.assign(new Error("MESSAGE_COMPETITION_REQUIRED"), { code: "MESSAGE_COMPETITION_REQUIRED" });
    if (!UUID.test(String(operationId || ""))) throw Object.assign(new Error("MESSAGE_OPERATION_ID_INVALID"), { code: "MESSAGE_OPERATION_ID_INVALID" });
    const controlledParameters = parameters(templateParameters, contract.parameters);
    if (!Array.isArray(participants) || !Array.isArray(recipients) || !recipients.length) throw Object.assign(new Error("MESSAGE_RECIPIENTS_INVALID"), { code: "MESSAGE_RECIPIENTS_INVALID" });
    const participantRows = participants.map((entry) => ({ personId: identifier(entry.personId, "person_id"), role: identifier(entry.role, "participant_role", CODE) }));
    const recipientIds = [...new Set(recipients.map((value) => identifier(value, "person_id")))];
    const readIds = new Set(readPersonIds.map((value) => identifier(value, "person_id")));
    const timestamp = createdAt instanceof Date && Number.isFinite(createdAt.getTime()) ? createdAt : null;
    if (!timestamp) throw Object.assign(new Error("MESSAGE_CREATED_AT_INVALID"), { code: "MESSAGE_CREATED_AT_INVALID" });
    const controlledHistory = {
      sourceType: optionalText(sourceType, "message_source_type", 63, /^[a-z][a-z0-9_.-]{0,62}$/),
      sourceId: optionalText(sourceId, "message_source_id", 160),
      actorPersonId: actorPersonId === null ? null : identifier(actorPersonId, "actor_person_id"),
      actorName: optionalText(actorName, "actor_name", 200),
      summary: optionalText(summary, "message_summary", 2000),
      detail: optionalText(detail, "message_detail", 16000),
      result: optionalText(result, "message_result", 500),
    };
    const startedAt = Date.now();
    try {
      const persist = async (transaction) => {
        const existing = await transaction.query(`
          SELECT event.contract_id AS id, event.event_type AS "eventType", event.template_key AS "templateKey",
                 event.template_version AS "templateVersion", event.template_parameters AS parameters,
                  competition.contract_id AS "competitionId", match.contract_id AS "matchId",
                  event.source_type AS "sourceType", event.source_contract_id AS "sourceId",
                  actor.contract_id AS "actorPersonId", event.actor_name_snapshot AS "actorName",
                  event.summary_snapshot AS summary, event.detail_snapshot AS detail, event.result_snapshot AS result,
                 ARRAY(SELECT person.contract_id FROM messaging.event_recipients recipient
                       JOIN identity.people person ON person.id=recipient.person_id
                       WHERE recipient.event_id=event.id ORDER BY person.contract_id) AS recipients,
                 ARRAY(SELECT participant.participant_role || ':' || participant.contract_id_snapshot
                       FROM messaging.event_participants participant
                       WHERE participant.event_id=event.id ORDER BY participant.participant_role, participant.contract_id_snapshot) AS participants
            FROM messaging.events event
            LEFT JOIN play.competitions competition ON competition.id=event.competition_id
            LEFT JOIN play.matches match ON match.id=event.match_id
            LEFT JOIN identity.people actor ON actor.id=event.actor_person_id
           WHERE event.tenant_id=$1::uuid AND event.source_operation_id=$2::uuid AND event.event_type=$3
        `, [this.context.tenantId, operationId, type]);
        if (existing.rowCount) {
          const prior = existing.rows[0];
          const expectedRecipients = [...recipientIds].sort();
          const expectedParticipants = participantRows.map((entry) => `${entry.role}:${entry.personId}`).sort();
          const same = prior.id === messageId
            && prior.templateKey === contract.templateKey
            && prior.templateVersion === contract.templateVersion
            && canonicalParameters(prior.parameters) === canonicalParameters(controlledParameters)
            && prior.competitionId === competition
            && prior.matchId === match
            && prior.sourceType === controlledHistory.sourceType
            && prior.sourceId === controlledHistory.sourceId
            && prior.actorPersonId === controlledHistory.actorPersonId
            && prior.actorName === controlledHistory.actorName
            && prior.summary === controlledHistory.summary
            && prior.detail === controlledHistory.detail
            && prior.result === controlledHistory.result
            && JSON.stringify(prior.recipients) === JSON.stringify(expectedRecipients)
            && JSON.stringify(prior.participants) === JSON.stringify(expectedParticipants);
          if (!same) throw Object.assign(new Error("MESSAGE_OPERATION_CONFLICT"), { code: "MESSAGE_OPERATION_CONFLICT" });
          return { id: messageId, duplicate: true };
        }
        const event = await transaction.query(`
          INSERT INTO messaging.events(
            tenant_id, contract_id, event_type, template_key, template_version, template_parameters,
            competition_id, match_id, source_type, source_contract_id, actor_person_id,
            actor_contract_id_snapshot, actor_name_snapshot, summary_snapshot, detail_snapshot, result_snapshot,
            source_operation_id, created_at
          )
          SELECT $1::uuid,$2,$3,$4,$5,$6::jsonb,competition.id,match.id,$11,$12,actor.id,
                 actor.contract_id,$13,$14,$15,$16,$9::uuid,$10
            FROM (SELECT 1) seed
            LEFT JOIN play.competitions competition ON competition.section_id IN (SELECT id FROM core.sections WHERE tenant_id=$1::uuid) AND competition.contract_id=$7
            LEFT JOIN play.matches match ON match.competition_id=competition.id AND match.contract_id=$8
            LEFT JOIN identity.people actor ON actor.tenant_id=$1::uuid AND actor.contract_id=$17
           WHERE ($7::text IS NULL OR competition.id IS NOT NULL) AND ($8::text IS NULL OR match.id IS NOT NULL)
             AND ($17::text IS NULL OR actor.id IS NOT NULL)
          RETURNING id
        `, [this.context.tenantId, messageId, type, contract.templateKey, contract.templateVersion,
          JSON.stringify(controlledParameters), competition, match, operationId, timestamp,
          controlledHistory.sourceType, controlledHistory.sourceId, controlledHistory.actorName,
          controlledHistory.summary, controlledHistory.detail, controlledHistory.result, controlledHistory.actorPersonId]);
        if (!event.rowCount) throw Object.assign(new Error("MESSAGE_CONTEXT_NOT_FOUND"), { code: "MESSAGE_CONTEXT_NOT_FOUND" });
        for (const participant of participantRows) {
          const inserted = await transaction.query(`
            INSERT INTO messaging.event_participants(
              event_id, person_id, participant_role, contract_id_snapshot, first_name_snapshot, last_name_snapshot
            )
            SELECT $1::uuid, id, $2, contract_id, first_name, last_name
              FROM identity.people WHERE tenant_id=$3::uuid AND contract_id=$4
            RETURNING event_id
          `, [event.rows[0].id, participant.role, this.context.tenantId, participant.personId]);
          if (!inserted.rowCount) throw Object.assign(new Error("MESSAGE_PARTICIPANT_NOT_FOUND"), { code: "MESSAGE_PARTICIPANT_NOT_FOUND" });
        }
        for (const personId of recipientIds) {
          const inserted = await transaction.query(`
            INSERT INTO messaging.event_recipients(
              event_id, person_id, template_key, template_version, template_parameters, created_at
            )
            SELECT $1::uuid, id, $2, $3, $4::jsonb, $5
              FROM identity.people WHERE tenant_id=$6::uuid AND contract_id=$7
            RETURNING id, person_id
          `, [event.rows[0].id, contract.templateKey, contract.templateVersion, JSON.stringify(controlledParameters), timestamp, this.context.tenantId, personId]);
          if (!inserted.rowCount) throw Object.assign(new Error("MESSAGE_RECIPIENT_NOT_FOUND"), { code: "MESSAGE_RECIPIENT_NOT_FOUND" });
          await transaction.query(`
            INSERT INTO messaging.receipts(recipient_id, read_at, acknowledged_at)
            VALUES ($1::uuid, $2, NULL)
          `, [inserted.rows[0].id, readIds.has(personId) ? timestamp : null]);
          await transaction.query(`
            INSERT INTO messaging.user_revisions(person_id, revision)
            VALUES ($1::uuid, 1)
            ON CONFLICT (person_id) DO UPDATE SET revision=messaging.user_revisions.revision+1, updated_at=clock_timestamp()
          `, [inserted.rows[0].person_id]);
        }
        await transaction.query(`
          INSERT INTO messaging.history_revision(singleton, revision)
          VALUES (true, 1)
          ON CONFLICT (singleton) DO UPDATE SET revision=messaging.history_revision.revision+1, updated_at=clock_timestamp()
        `);
        await transaction.query(`
          INSERT INTO ops.outbox(tenant_id, event_type, payload_version, payload, idempotency_key, status, available_at)
          VALUES ($1::uuid, 'websocket.invalidate', 1,
                  jsonb_build_object('eventId',$2::text,'projection','messaging'), $3, 'pending', clock_timestamp())
        `, [this.context.tenantId, messageId, `messaging:${operationId}`]);
        await transaction.query("SELECT pg_notify('epiber_worker_wake', '')");
        return { id: messageId, duplicate: false, recipients: recipientIds.length };
      };
      const result = existingTransaction
        ? await persist(existingTransaction)
        : await this.database.withTransaction("messaging.event.create", persist);
      this.log("info", "postgres_messaging_event_completed", { eventType: type, result: "success", duplicate: result.duplicate, recipients: result.recipients || 0, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      this.log("warn", "postgres_messaging_event_completed", { eventType: type, result: error.code === "DB_COMMIT_OUTCOME_UNKNOWN" ? "unknown" : "failed", errorCode: error.code || "MESSAGING_EVENT_FAILED", durationMs: Date.now() - startedAt });
      throw error;
    }
  }
}

module.exports = { PostgresMessagingRepository };
