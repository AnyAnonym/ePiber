"use strict";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_ID = /^[a-z0-9][a-z0-9_.:-]{2,126}$/i;

function workerId(value) {
  const normalized = String(value || "");
  if (!WORKER_ID.test(normalized)) throw Object.assign(new Error("WORKER_ID_INVALID"), { code: "WORKER_ID_INVALID" });
  return normalized;
}

function leaseDuration(value) {
  if (!Number.isInteger(value) || value < 1_000 || value > 15 * 60_000) throw Object.assign(new Error("LEASE_DURATION_INVALID"), { code: "LEASE_DURATION_INVALID" });
  return value;
}

function recordId(value, field) {
  const normalized = String(value || "");
  if (!UUID.test(normalized)) throw Object.assign(new Error(`${field.toUpperCase()}_INVALID`), { code: `${field.toUpperCase()}_INVALID` });
  return normalized;
}

class WorkerRepository {
  constructor({ database, context }) {
    this.database = database;
    this.context = context;
  }

  async claimJob(owner, leaseMs = 60_000) {
    return this.database.withTransaction("ops.job.claim", async (transaction) => {
      const result = await transaction.query(`
        WITH candidate AS (
          SELECT id FROM ops.jobs
           WHERE tenant_id=$1::uuid
             AND ((status IN ('pending','retrying') AND available_at<=clock_timestamp())
               OR (status='leased' AND lease_until<=clock_timestamp()))
           ORDER BY available_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        UPDATE ops.jobs job
           SET status='leased', lease_owner=$2, lease_until=clock_timestamp()+($3::bigint*interval '1 millisecond'),
               attempt_count=attempt_count+1, last_error_code=NULL
          FROM candidate WHERE job.id=candidate.id
        RETURNING job.id::text AS id, job.job_type AS type, job.payload_version AS "payloadVersion",
                  job.payload, job.idempotency_key AS "idempotencyKey", job.attempt_count AS "attemptCount",
                  job.lease_until AS "leaseUntil"
      `, [this.context.tenantId, workerId(owner), leaseDuration(leaseMs)]);
      return result.rows[0] || null;
    });
  }

  async retryJob(id, owner, errorCode, delayMs) {
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 24 * 60 * 60_000) throw Object.assign(new Error("RETRY_DELAY_INVALID"), { code: "RETRY_DELAY_INVALID" });
    const result = await this.database.query(`
      UPDATE ops.jobs SET status='retrying', available_at=clock_timestamp()+($4::bigint*interval '1 millisecond'),
             lease_owner=NULL, lease_until=NULL, last_error_code=$3
       WHERE tenant_id=$1::uuid AND id=$2::uuid AND status='leased' AND lease_owner=$5
       RETURNING id
    `, [this.context.tenantId, recordId(id, "job_id"), String(errorCode || "JOB_FAILED").slice(0, 100), delayMs, workerId(owner)]);
    if (!result.rowCount) throw Object.assign(new Error("JOB_LEASE_LOST"), { code: "JOB_LEASE_LOST" });
  }

  async completeJob(id, owner, status, errorCode = null) {
    if (!new Set(["success", "aborted", "dead", "unknown"]).has(status)) throw Object.assign(new Error("JOB_STATUS_INVALID"), { code: "JOB_STATUS_INVALID" });
    const result = await this.database.query(`
      UPDATE ops.jobs SET status=$3, lease_owner=NULL, lease_until=NULL, completed_at=clock_timestamp(),
             last_error_code=$4, clarified_at=CASE WHEN $3 IN ('aborted','dead') THEN clock_timestamp() ELSE clarified_at END
       WHERE tenant_id=$1::uuid AND id=$2::uuid AND status='leased' AND lease_owner=$5
       RETURNING id
    `, [this.context.tenantId, recordId(id, "job_id"), status, errorCode ? String(errorCode).slice(0, 100) : null, workerId(owner)]);
    if (!result.rowCount) throw Object.assign(new Error("JOB_LEASE_LOST"), { code: "JOB_LEASE_LOST" });
  }

  async claimOutbox(owner, leaseMs = 60_000) {
    return this.database.withTransaction("ops.outbox.claim", async (transaction) => {
      const result = await transaction.query(`
        WITH candidate AS (
          SELECT id FROM ops.outbox
           WHERE tenant_id=$1::uuid
             AND ((status IN ('pending','failed') AND available_at<=clock_timestamp())
               OR (status='leased' AND lease_until<=clock_timestamp()))
           ORDER BY available_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        UPDATE ops.outbox item
           SET status='leased', lease_owner=$2, lease_until=clock_timestamp()+($3::bigint*interval '1 millisecond'),
               attempt_count=attempt_count+1, last_error_code=NULL
          FROM candidate WHERE item.id=candidate.id
        RETURNING item.id::text AS id, item.event_type AS type, item.payload_version AS "payloadVersion",
                  item.payload, item.idempotency_key AS "idempotencyKey", item.attempt_count AS "attemptCount",
                  item.lease_until AS "leaseUntil"
      `, [this.context.tenantId, workerId(owner), leaseDuration(leaseMs)]);
      return result.rows[0] || null;
    });
  }

  async completeOutbox(id, owner, status, errorCode = null, delayMs = 0) {
    if (!new Set(["sent", "failed", "unknown"]).has(status)) throw Object.assign(new Error("OUTBOX_STATUS_INVALID"), { code: "OUTBOX_STATUS_INVALID" });
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 24 * 60 * 60_000) throw Object.assign(new Error("RETRY_DELAY_INVALID"), { code: "RETRY_DELAY_INVALID" });
    const result = await this.database.query(`
      UPDATE ops.outbox SET status=$3, lease_owner=NULL, lease_until=NULL,
             completed_at=CASE WHEN $3='sent' THEN clock_timestamp() ELSE NULL END,
             available_at=CASE WHEN $3='failed' THEN clock_timestamp()+($5::bigint*interval '1 millisecond') ELSE available_at END,
             last_error_code=$4
       WHERE tenant_id=$1::uuid AND id=$2::uuid AND status='leased' AND lease_owner=$6
       RETURNING id
    `, [this.context.tenantId, recordId(id, "outbox_id"), status, errorCode ? String(errorCode).slice(0, 100) : null, delayMs, workerId(owner)]);
    if (!result.rowCount) throw Object.assign(new Error("OUTBOX_LEASE_LOST"), { code: "OUTBOX_LEASE_LOST" });
  }

  async publishInvalidation({ eventId, projection }) {
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(String(eventId || "")) || !new Set(["messaging", "play", "venue", "identity"]).has(projection)) {
      throw Object.assign(new Error("INVALIDATION_PAYLOAD_INVALID"), { code: "INVALIDATION_PAYLOAD_INVALID" });
    }
    const payload = JSON.stringify({ eventId, projection });
    await this.database.query("SELECT pg_notify('epiber_app_invalidate', $1)", [payload]);
  }
}

module.exports = { WorkerRepository };
