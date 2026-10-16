"use strict";

const crypto = require("crypto");
const { AppError } = require("../../errors.js");

const AUDIT_STATUS = new Set(["success", "failed", "unknown"]);
const ACTOR_TYPES = new Set(["anonymous", "user", "monitor", "system"]);
const CODE_PATTERN = /^[a-z][a-z0-9_.-]{1,126}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECTION_TYPES = new Set(["boolean", "controlled", "count", "epoch_ms", "id", "id_list", "monitor", "preference_target", "preference_targets", "revision", "status", "timestamp"]);

function preferenceTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const encoded = JSON.stringify(value);
  if (encoded.length > 512 || !new Set(["page", "overlay"]).has(value.type)) return false;
  if (value.targetId !== undefined && (typeof value.targetId !== "string" || !/^favorite-[A-Za-z0-9_-]{20,64}$/.test(value.targetId))) return false;
  if (value.type === "overlay") return Object.keys(value).every((key) => new Set(["type", "overlay", "targetId"]).has(key)) && /^[A-Za-z0-9_.:-]{1,32}$/.test(value.overlay);
  if (!/^[A-Za-z0-9_.:-]{1,32}$/.test(value.page) || Object.keys(value).some((key) => !new Set(["type", "page", "params", "targetId"]).has(key))) return false;
  if (value.params === undefined) return true;
  return value.params && typeof value.params === "object" && !Array.isArray(value.params)
    && Object.entries(value.params).every(([key, entry]) => new Set(["id", "history", "paarungslayout", "profil"]).has(key)
      && ((key === "paarungslayout" && Number.isInteger(entry) && entry >= 0 && entry <= 5)
        || (key !== "paarungslayout" && typeof entry === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(entry))));
}

function controlledProjectionValue(value, type) {
  if (value === null) return true;
  if (type === "boolean") return typeof value === "boolean";
  if (type === "count") return Number.isSafeInteger(value) && value >= 0;
  if (type === "controlled") return (typeof value === "boolean")
    || (Number.isSafeInteger(value) && value >= 0)
    || (typeof value === "string" && value.length <= 160 && /^[A-Za-z0-9ÄÖÜäöüß _./:?&=+,-]*$/.test(value));
  if (type === "epoch_ms") return Number.isSafeInteger(value) && value >= 0;
  if (type === "id") return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
  if (type === "id_list") return Array.isArray(value) && value.length <= 100 && value.every((entry) => typeof entry === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(entry));
  if (type === "monitor") return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => new Set(["monitorId", "label", "createdAt", "updatedAt", "revokedAt"]).has(key))
    && typeof value.monitorId === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value.monitorId)
    && (value.label === undefined || (typeof value.label === "string" && value.label.length <= 160))
    && ["createdAt", "updatedAt", "revokedAt"].every((key) => value[key] === undefined || Number.isSafeInteger(value[key]));
  if (type === "preference_target") return preferenceTarget(value);
  if (type === "preference_targets") return Array.isArray(value) && value.length <= 32 && value.every(preferenceTarget);
  if (type === "revision") return (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) || (Number.isSafeInteger(value) && value >= 0);
  if (type === "status") return typeof value === "string" && /^[a-z][a-z0-9_.-]{0,63}$/.test(value);
  if (type === "timestamp") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
  return false;
}

function plainProjection(value, field, contract) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error(`${field.toUpperCase()}_INVALID`), { code: `${field.toUpperCase()}_INVALID` });
  for (const [key, entry] of Object.entries(value)) {
    if (!contract.has(key)) throw Object.assign(new Error(`${field.toUpperCase()}_FIELD_INVALID`), { code: `${field.toUpperCase()}_FIELD_INVALID` });
    if (!controlledProjectionValue(entry, contract.get(key))) throw Object.assign(new Error(`${field.toUpperCase()}_VALUE_INVALID`), { code: `${field.toUpperCase()}_VALUE_INVALID` });
  }
  const encoded = JSON.stringify(value);
  if (encoded.length > 4096) throw Object.assign(new Error(`${field.toUpperCase()}_TOO_LARGE`), { code: `${field.toUpperCase()}_TOO_LARGE` });
  return value;
}

function uuid(value, field) {
  const normalized = String(value || "");
  if (!UUID_PATTERN.test(normalized)) throw Object.assign(new Error(`${field.toUpperCase()}_INVALID`), { code: `${field.toUpperCase()}_INVALID` });
  return normalized;
}

function code(value, field) {
  const normalized = String(value || "");
  if (!CODE_PATTERN.test(normalized)) throw Object.assign(new Error(`${field.toUpperCase()}_INVALID`), { code: `${field.toUpperCase()}_INVALID` });
  return normalized;
}

class OpsRepository {
  constructor({ database, context, sourceInstance = "devel", auditContracts = {}, idempotencyContracts = {}, log = () => {} }) {
    this.database = database;
    this.context = context;
    this.sourceInstance = String(sourceInstance || "");
    this.log = log;
    this.auditContracts = new Map();
    this.idempotencyContracts = new Map();
    if (!/^[a-z0-9_-]{1,32}$/i.test(this.sourceInstance)) throw Object.assign(new Error("SOURCE_INSTANCE_INVALID"), { code: "SOURCE_INSTANCE_INVALID" });
    for (const [action, contract] of Object.entries(auditContracts)) {
      const normalizedAction = code(action, "action");
      const before = new Map(Object.entries(contract?.before || {}));
      const after = new Map(Object.entries(contract?.after || {}));
      if ([...before, ...after].some(([key, type]) => !/^[a-z][A-Za-z0-9]{0,63}$/.test(key) || !PROJECTION_TYPES.has(type))) {
        throw Object.assign(new Error("AUDIT_CONTRACT_INVALID"), { code: "AUDIT_CONTRACT_INVALID" });
      }
      this.auditContracts.set(normalizedAction, Object.freeze({ before, after }));
    }
    for (const [command, response] of Object.entries(idempotencyContracts)) {
      const normalizedCommand = code(command, "command");
      const contract = new Map(Object.entries(response || {}));
      if ([...contract].some(([key, type]) => !/^[a-z][A-Za-z0-9]{0,63}$/.test(key) || !PROJECTION_TYPES.has(type))) {
        throw Object.assign(new Error("IDEMPOTENCY_CONTRACT_INVALID"), { code: "IDEMPOTENCY_CONTRACT_INVALID" });
      }
      this.idempotencyContracts.set(normalizedCommand, contract);
    }
  }

  auditContract(action) {
    const contract = this.auditContracts.get(action);
    if (!contract) throw Object.assign(new Error("AUDIT_ACTION_NOT_REGISTERED"), { code: "AUDIT_ACTION_NOT_REGISTERED" });
    return contract;
  }

  idempotencyContract(command) {
    const contract = this.idempotencyContracts.get(command);
    if (!contract) throw Object.assign(new Error("IDEMPOTENCY_COMMAND_NOT_REGISTERED"), { code: "IDEMPOTENCY_COMMAND_NOT_REGISTERED" });
    return contract;
  }

  async beginIdempotencyOn(target, { operationId, actorPersonId = null, command, requestHash }) {
    const normalizedOperationId = uuid(operationId, "operation_id");
    const normalizedCommand = code(command, "command");
    this.idempotencyContract(normalizedCommand);
    const hash = Buffer.from(requestHash || []);
    if (hash.length !== 32) throw Object.assign(new Error("REQUEST_HASH_INVALID"), { code: "REQUEST_HASH_INVALID" });
      const existing = await target.query(`
        SELECT operation.command, operation.request_hash AS "requestHash", operation.status,
               operation.response_projection AS response, operation.response_expires_at AS "responseExpiresAt",
               person.contract_id AS "actorPersonId"
          FROM ops.idempotency_operations operation
          LEFT JOIN identity.people person ON person.id=operation.actor_person_id
         WHERE operation.tenant_id=$1::uuid AND operation.operation_id=$2::uuid
         FOR UPDATE OF operation
      `, [this.context.tenantId, normalizedOperationId]);
      if (existing.rowCount) {
        const prior = existing.rows[0];
        const sameActor = (prior.actorPersonId || null) === (actorPersonId === null ? null : String(actorPersonId));
        if (prior.command !== normalizedCommand || !sameActor || !crypto.timingSafeEqual(prior.requestHash, hash)) {
          throw new AppError("IDEMPOTENCY_CONFLICT", "Operation-ID wurde bereits mit anderen Daten verwendet", 409);
        }
        return { repeated: true, status: prior.status, response: prior.response, responseExpiresAt: prior.responseExpiresAt };
      }
      const inserted = await target.query(`
        INSERT INTO ops.idempotency_operations(
          tenant_id, operation_id, actor_person_id, command, request_hash, status, started_at, expires_at
        )
        SELECT $1::uuid,$2::uuid,person.id,$3,$4,'started',clock_timestamp(),clock_timestamp()+interval '12 months'
          FROM (SELECT 1) seed
          LEFT JOIN identity.people person ON person.tenant_id=$1::uuid AND person.contract_id=$5
         WHERE $5::text IS NULL OR person.id IS NOT NULL
        RETURNING id
      `, [this.context.tenantId, normalizedOperationId, normalizedCommand, hash, actorPersonId === null ? null : String(actorPersonId)]);
      if (!inserted.rowCount) throw Object.assign(new Error("IDEMPOTENCY_ACTOR_NOT_FOUND"), { code: "IDEMPOTENCY_ACTOR_NOT_FOUND" });
      return { repeated: false, status: "started", response: null, responseExpiresAt: null };
  }

  async beginIdempotency(values) {
    return this.database.withTransaction("ops.idempotency.begin", (transaction) => this.beginIdempotencyOn(transaction, values));
  }

  async completeIdempotency(target, { operationId, command, status, response = null }) {
    const normalizedOperationId = uuid(operationId, "operation_id");
    const normalizedCommand = code(command, "command");
    const contract = this.idempotencyContract(normalizedCommand);
    if (!new Set(["success", "failed", "unknown"]).has(status)) throw Object.assign(new Error("IDEMPOTENCY_STATUS_INVALID"), { code: "IDEMPOTENCY_STATUS_INVALID" });
    const projection = response === null ? null : plainProjection(response, "response_projection", contract);
    if (status === "success" && projection === null) throw Object.assign(new Error("IDEMPOTENCY_RESPONSE_REQUIRED"), { code: "IDEMPOTENCY_RESPONSE_REQUIRED" });
    const result = await target.query(`
      UPDATE ops.idempotency_operations
         SET status=$4, response_projection=$5::jsonb,
             response_expires_at=CASE WHEN $5::jsonb IS NULL THEN NULL ELSE clock_timestamp()+interval '24 hours' END,
             completed_at=clock_timestamp()
       WHERE tenant_id=$1::uuid AND operation_id=$2::uuid AND command=$3 AND status='started'
       RETURNING id
    `, [this.context.tenantId, normalizedOperationId, normalizedCommand, status, projection === null ? null : JSON.stringify(projection)]);
    if (!result.rowCount) throw Object.assign(new Error("IDEMPOTENCY_OPERATION_NOT_OPEN"), { code: "IDEMPOTENCY_OPERATION_NOT_OPEN" });
  }

  async finalizeIdempotency(values) {
    return this.database.withTransaction("ops.idempotency.finish", (transaction) => this.completeIdempotency(transaction, values));
  }

  async idempotencyStatus(operationId, actorPersonId) {
    const result = await this.database.query(`
      SELECT operation.command AS endpoint, operation.status, operation.started_at AS "createdAt"
        FROM ops.idempotency_operations operation
        LEFT JOIN identity.people person ON person.id=operation.actor_person_id
       WHERE operation.tenant_id=$1::uuid AND operation.operation_id=$2::uuid
         AND person.contract_id=$3
    `, [this.context.tenantId, uuid(operationId, "operation_id"), String(actorPersonId || "")]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return { endpoint: row.endpoint, status: new Set(["started", "unknown"]).has(row.status) ? row.status : "completed", createdAt: row.createdAt };
  }

  async queueInvalidation(target, { operationId, projection, eventId }) {
    if (!UUID_PATTERN.test(String(operationId || ""))) throw Object.assign(new Error("OPERATION_ID_INVALID"), { code: "OPERATION_ID_INVALID" });
    if (!new Set(["identity", "play", "venue", "messaging"]).has(projection)) throw Object.assign(new Error("PROJECTION_INVALID"), { code: "PROJECTION_INVALID" });
    const id = String(eventId || operationId);
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) throw Object.assign(new Error("EVENT_ID_INVALID"), { code: "EVENT_ID_INVALID" });
    await target.query(`INSERT INTO ops.outbox(tenant_id,event_type,payload_version,payload,idempotency_key,status,available_at)
      VALUES ($1::uuid,'websocket.invalidate',1,jsonb_build_object('eventId',$2::text,'projection',$3::text),$4,'pending',clock_timestamp())
      ON CONFLICT (tenant_id,event_type,idempotency_key) DO NOTHING`, [this.context.tenantId, id, projection, `${projection}:${operationId}`]);
    await target.query("SELECT pg_notify('epiber_worker_wake','')");
  }

  async startAudit({
    operationId = crypto.randomUUID(), actorType = "anonymous", actorPersonId = null,
    actorName = null, role = null, action, subjectType = null, subjectId = null,
    subjectName = null, requestId = null, before = null, sourceIp = null, attemptedLogin = null,
  }) {
    const normalizedOperationId = uuid(operationId, "operation_id");
    if (!ACTOR_TYPES.has(actorType)) throw Object.assign(new Error("ACTOR_TYPE_INVALID"), { code: "ACTOR_TYPE_INVALID" });
    const normalizedAction = code(action, "action");
    const contract = this.auditContract(normalizedAction);
    const beforeProjection = plainProjection(before, "before_projection", contract.before);
    const startedAt = Date.now();
    try {
      const result = await this.database.withTransaction("ops.audit.start", async (transaction) => {
        const inserted = await transaction.query(`
          INSERT INTO ops.audit_operations(
            tenant_id, operation_id, actor_person_id, actor_type, actor_name_snapshot, role_snapshot,
            action, subject_type, subject_id, subject_name_snapshot, request_id, status, source_instance,
            before_projection, started_at, expires_at
          )
          SELECT $1::uuid, $2::uuid, person.id, $3, $4, $5, $6, $7, $8, $9, $10,
                 'started', $11, $12::jsonb, clock_timestamp(), clock_timestamp() + interval '12 months'
            FROM (SELECT 1) seed
            LEFT JOIN identity.people person ON person.tenant_id=$1::uuid AND person.contract_id=$13
           WHERE $13::text IS NULL OR person.id IS NOT NULL
          RETURNING id::text AS id, operation_id::text AS "operationId", started_at AS "startedAt"
        `, [
          this.context.tenantId, normalizedOperationId, actorType, actorName, role, normalizedAction,
          subjectType, subjectId, subjectName, requestId, this.sourceInstance,
          beforeProjection === null ? null : JSON.stringify(beforeProjection), actorPersonId === null ? null : String(actorPersonId),
        ]);
        if (!inserted.rowCount) throw Object.assign(new Error("AUDIT_ACTOR_NOT_FOUND"), { code: "AUDIT_ACTOR_NOT_FOUND" });
        await transaction.query(`
          INSERT INTO ops.audit_transitions(audit_operation_id, transition, occurred_at)
          VALUES ($1::uuid, 'started', $2)
        `, [inserted.rows[0].id, inserted.rows[0].startedAt]);
        if (sourceIp || attemptedLogin) {
          await transaction.query(`
            INSERT INTO ops.audit_security_context(audit_operation_id, source_ip, attempted_login)
            VALUES ($1::uuid, $2::inet, $3)
          `, [inserted.rows[0].id, sourceIp, attemptedLogin]);
        }
        return inserted.rows[0];
      });
      this.log("info", "postgres_audit_started", { action: normalizedAction, result: "success", durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      this.log("warn", "postgres_audit_started", { action: normalizedAction, result: "failed", errorCode: error.code || "AUDIT_START_FAILED", durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  async completeAudit(target, { operationId, action, status, after = null, errorCode = null }) {
    const normalizedOperationId = uuid(operationId, "operation_id");
    const normalizedAction = code(action, "action");
    const contract = this.auditContract(normalizedAction);
    if (!AUDIT_STATUS.has(status)) throw Object.assign(new Error("AUDIT_STATUS_INVALID"), { code: "AUDIT_STATUS_INVALID" });
    const afterProjection = plainProjection(after, "after_projection", contract.after);
    const result = await target.query(`
      WITH updated AS (
        UPDATE ops.audit_operations
           SET status=$3, after_projection=$4::jsonb, completed_at=clock_timestamp()
         WHERE tenant_id=$1::uuid AND operation_id=$2::uuid AND action=$6 AND status='started'
         RETURNING id, started_at, completed_at
      )
      INSERT INTO ops.audit_transitions(audit_operation_id, transition, occurred_at, error_code, duration_ms)
      SELECT id, $3, completed_at, $5,
             GREATEST(0, floor(extract(epoch FROM (completed_at-started_at))*1000))::bigint
        FROM updated
      RETURNING audit_operation_id::text AS id
    `, [
      this.context.tenantId, normalizedOperationId, status,
      afterProjection === null ? null : JSON.stringify(afterProjection), errorCode, normalizedAction,
    ]);
    if (!result.rowCount) throw Object.assign(new Error("AUDIT_OPERATION_NOT_OPEN"), { code: "AUDIT_OPERATION_NOT_OPEN" });
  }

  async executeAudited({ audit, transactionOperation, isolation = "read_committed", retries = 0 }, callback) {
    const startedAtMs = Date.now();
    const started = await this.startAudit(audit);
    const action = code(audit.action, "action");
    try {
      const result = await this.database.withTransaction(transactionOperation, async (transaction) => {
        const result = await callback(transaction, started);
        await this.completeAudit(transaction, { operationId: started.operationId, action, status: "success", after: result?.auditAfter || null });
        return result;
      }, { isolation, retries });
      this.log("info", "postgres_audit_completed", { action, result: "success", durationMs: Date.now() - startedAtMs });
      return result;
    } catch (error) {
      const status = error.code === "DB_COMMIT_OUTCOME_UNKNOWN" ? "unknown" : "failed";
      try {
        await this.database.withTransaction("ops.audit.finish", (transaction) => this.completeAudit(transaction, {
          operationId: started.operationId,
          action,
          status,
          errorCode: String(error.code || "OPERATION_FAILED").slice(0, 100),
        }));
      } catch (auditError) {
        this.log("error", "postgres_audit_completion_failed", {
          result: status,
          errorCode: auditError.code || "AUDIT_COMPLETION_FAILED",
        });
        if (status !== "unknown") throw Object.assign(new Error("AUDIT_COMPLETION_FAILED"), { code: "AUDIT_COMPLETION_FAILED", cause: error });
      }
      this.log(status === "unknown" ? "error" : "warn", "postgres_audit_completed", {
        action,
        result: status,
        errorCode: String(error.code || "OPERATION_FAILED").slice(0, 100),
        durationMs: Date.now() - startedAtMs,
      });
      throw error;
    }
  }
}

module.exports = { OpsRepository };
