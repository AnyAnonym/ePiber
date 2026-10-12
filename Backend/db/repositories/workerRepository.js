"use strict";

const crypto = require("crypto");
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

  async ensureMaintenanceJobs(now = new Date()) {
    const time = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(time.getTime())) throw Object.assign(new Error("MAINTENANCE_TIME_INVALID"), { code: "MAINTENANCE_TIME_INVALID" });
    const quarter = Math.floor(time.getTime() / 900000), hour = Math.floor(time.getTime() / 3600000);
    const day = time.toISOString().slice(0, 10), minuteOfDay = time.getUTCHours() * 60 + time.getUTCMinutes();
    const jobs = [
      ["retention.short", `quarter:${quarter}`],
      ["retention.hourly", `hour:${hour}`],
      ["hall_time.expire_waitlists", `quarter:${quarter}`],
      ...(minuteOfDay >= 135 ? [["retention.daily", `day:${day}`]] : []),
    ];
    for (const [type, key] of jobs) await this.database.query(`
      INSERT INTO ops.jobs(tenant_id,job_type,payload_version,payload,idempotency_key,status,available_at)
      VALUES ($1::uuid,$2,1,'{"batchSize":1000}'::jsonb,$3,'pending',clock_timestamp())
      ON CONFLICT (tenant_id,job_type,idempotency_key) DO NOTHING
    `, [this.context.tenantId, type, key]);
    if (jobs.length) await this.database.query("SELECT pg_notify('epiber_worker_wake','maintenance')");
    return { scheduled: jobs.length };
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

  async retentionShort(batchSize = 1000) {
    const limit = Math.max(1, Math.min(1000, Number(batchSize) || 1000));
    return this.database.withTransaction("ops.retention.short", async (transaction) => {
      const loginLimits = await transaction.query("DELETE FROM identity.login_rate_limits WHERE ctid IN (SELECT ctid FROM identity.login_rate_limits WHERE expires_at<clock_timestamp() LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING 1", [limit]);
      const sessions = await transaction.query(`DELETE FROM identity.sessions session WHERE session.id IN (SELECT candidate.id FROM identity.sessions candidate JOIN identity.user_accounts account ON account.id=candidate.account_id WHERE account.tenant_id=$1::uuid AND (candidate.expires_at<clock_timestamp() OR candidate.revoked_at<clock_timestamp()-interval '24 hours') LIMIT $2 FOR UPDATE OF candidate SKIP LOCKED) RETURNING 1`, [this.context.tenantId, limit]);
      const projections = await transaction.query("UPDATE ops.idempotency_operations SET response_projection=NULL,response_expires_at=NULL WHERE id IN (SELECT id FROM ops.idempotency_operations WHERE tenant_id=$1::uuid AND response_expires_at<clock_timestamp() LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING 1", [this.context.tenantId, limit]);
      return { loginLimits: loginLimits.rowCount, sessions: sessions.rowCount, idempotencyResponses: projections.rowCount };
    });
  }

  async retentionHourly(batchSize = 1000) {
    const limit = Math.max(1, Math.min(1000, Number(batchSize) || 1000));
    return this.database.withTransaction("ops.retention.hourly", async (transaction) => {
      const outbox = await transaction.query("DELETE FROM ops.outbox WHERE id IN (SELECT id FROM ops.outbox WHERE tenant_id=$1::uuid AND status='sent' AND completed_at<clock_timestamp()-interval '30 days' LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING 1", [this.context.tenantId, limit]);
      const jobs = await transaction.query("DELETE FROM ops.jobs WHERE id IN (SELECT id FROM ops.jobs WHERE tenant_id=$1::uuid AND status IN ('success','aborted') AND completed_at<clock_timestamp()-interval '90 days' LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING 1", [this.context.tenantId, limit]);
      const monitorCommands = await transaction.query(`DELETE FROM venue.monitor_commands command WHERE command.id IN (SELECT candidate.id FROM venue.monitor_commands candidate JOIN venue.monitor_devices monitor ON monitor.id=candidate.monitor_id WHERE monitor.tenant_id=$1::uuid AND candidate.acknowledged_at IS NOT NULL AND candidate.expires_at<clock_timestamp()-interval '30 days' LIMIT $2 FOR UPDATE OF candidate SKIP LOCKED) RETURNING 1`, [this.context.tenantId, limit]);
      return { outbox: outbox.rowCount, jobs: jobs.rowCount, monitorCommands: monitorCommands.rowCount };
    });
  }

  async retentionDaily(batchSize = 1000) {
    const limit = Math.max(1, Math.min(1000, Number(batchSize) || 1000));
    return this.database.withTransaction("ops.retention.daily", async (transaction) => {
      const audit = await transaction.query("DELETE FROM ops.audit_operations WHERE id IN (SELECT id FROM ops.audit_operations WHERE tenant_id=$1::uuid AND completed_at<clock_timestamp()-interval '12 months' AND status<>'started' LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING 1", [this.context.tenantId, limit]);
      const recipients = await transaction.query(`DELETE FROM messaging.event_recipients recipient WHERE recipient.id IN (SELECT candidate.id FROM messaging.event_recipients candidate JOIN messaging.events event ON event.id=candidate.event_id WHERE event.tenant_id=$1::uuid AND candidate.created_at<clock_timestamp()-interval '24 months' LIMIT $2 FOR UPDATE OF candidate SKIP LOCKED) RETURNING 1`, [this.context.tenantId, limit]);
      const roles = await transaction.query("DELETE FROM identity.tenant_role_assignments WHERE id IN (SELECT id FROM identity.tenant_role_assignments WHERE tenant_id=$1::uuid AND revoked_at<clock_timestamp()-interval '12 months' LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING 1", [this.context.tenantId, limit]);
      const credentials = await transaction.query(`DELETE FROM identity.credentials credential WHERE credential.id IN (SELECT candidate.id FROM identity.credentials candidate JOIN identity.user_accounts account ON account.id=candidate.account_id WHERE account.tenant_id=$1::uuid AND candidate.revoked_at<clock_timestamp()-interval '12 months' AND NOT candidate.active LIMIT $2 FOR UPDATE OF candidate SKIP LOCKED) RETURNING 1`, [this.context.tenantId, limit]);
      const deadJobs = await transaction.query("DELETE FROM ops.jobs WHERE id IN (SELECT id FROM ops.jobs WHERE tenant_id=$1::uuid AND status='dead' AND clarified_at<clock_timestamp()-interval '12 months' LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING 1", [this.context.tenantId, limit]);
      return { audit: audit.rowCount, recipients: recipients.rowCount, roles: roles.rowCount, credentials: credentials.rowCount, deadJobs: deadJobs.rowCount };
    });
  }

  async expireHallTimeWaitlists(batchSize = 1000) {
    const limit = Math.max(1, Math.min(1000, Number(batchSize) || 1000));
    return this.database.withTransaction("ops.hall_time.expire_waitlists", async (transaction) => {
      const expired = await transaction.query(`SELECT candidate.id,grid.id AS grid_id,slot.id AS slot_id,candidate.person_id,slot.starts_at,person.contract_id,concat_ws(' ',person.first_name,person.last_name) AS person_name
        FROM venue.hall_time_allocations candidate JOIN venue.hall_time_slots slot ON slot.id=candidate.slot_id
        JOIN venue.hall_time_grids grid ON grid.id=slot.grid_id JOIN core.sections section ON section.id=grid.section_id
        JOIN identity.people person ON person.id=candidate.person_id
        WHERE section.tenant_id=$1::uuid AND candidate.status='waiting' AND slot.ends_at<=clock_timestamp()
        ORDER BY slot.ends_at,candidate.id LIMIT $2 FOR UPDATE OF candidate SKIP LOCKED`, [this.context.tenantId, limit]);
      if (!expired.rowCount) return { expired: 0 };
      await transaction.query("DELETE FROM venue.hall_time_allocations WHERE id=ANY($1::uuid[])", [expired.rows.map(({ id }) => id)]);
      const groups = new Map(); for (const row of expired.rows) { if (!groups.has(row.grid_id)) groups.set(row.grid_id, []); groups.get(row.grid_id).push(row); }
      for (const [gridId, rows] of groups) {
        const history = await transaction.query(`INSERT INTO venue.hall_time_history(grid_id,operation_id,action_code,occurred_at,item_count)
          VALUES ($1::uuid,$2::uuid,'waitlist_expired',clock_timestamp(),$3) RETURNING id`, [gridId, crypto.randomUUID(), rows.length]);
        for (const [index, row] of rows.entries()) await transaction.query(`INSERT INTO venue.hall_time_history_items(history_id,item_no,slot_id,person_id,before_status,slot_starts_at_snapshot,person_contract_id_snapshot,person_name_snapshot)
          VALUES ($1::uuid,$2,$3::uuid,$4::uuid,'waiting',$5,$6,$7)`, [history.rows[0].id, index + 1, row.slot_id, row.person_id, row.starts_at, row.contract_id, row.person_name]);
        await transaction.query("UPDATE venue.hall_time_grids SET revision=revision+1,projection_revision=projection_revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [gridId]);
      }
      return { expired: expired.rowCount };
    });
  }
}

module.exports = { WorkerRepository };
