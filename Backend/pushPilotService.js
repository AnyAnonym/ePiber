"use strict";

const crypto = require("node:crypto");
const { AppError } = require("./errors");
const { requestHash, PostgresCompetitionService } = require("./postgresCompetitionService");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function closed(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) throw new AppError("VALIDATION_ERROR", "Push-Eingabe ist ungueltig", 400);
}
function uuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new AppError("VALIDATION_ERROR", "Push-ID ist ungueltig", 400);
  return value;
}
function subscription(value) {
  closed(value, ["endpoint", "keys"]);
  closed(value.keys, ["p256dh", "auth"]);
  try {
    const url = new URL(value.endpoint);
    const allowed = url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com"
      || url.hostname.endsWith(".push.apple.com") || url.hostname.endsWith(".notify.windows.com");
    if (!allowed || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || value.endpoint.length > 2048
      || !/^[A-Za-z0-9_-]{87}$/.test(value.keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(value.keys.auth)) throw new Error();
    crypto.ECDH.convertKey(Buffer.from(value.keys.p256dh, "base64url"), "prime256v1");
    if (Buffer.from(value.keys.auth, "base64url").length !== 16) throw new Error();
    return { endpoint: url.href, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
  } catch { throw new AppError("PUSH_SUBSCRIPTION_INVALID", "Push-Registrierung wird nicht unterstuetzt", 400); }
}

class PushPilotService {
  constructor({ identity, ops, config, log = () => {} }) {
    this.database = identity.database;
    this.context = identity.context;
    this.ops = ops;
    this.config = config;
    this.log = log;
  }

  async status(personId) {
    const started = Date.now();
    let result = "failed";
    try {
      const status = await this.readStatus(personId);
      result = "success";
      return status;
    } finally {
      this.log("info", "push_pilot_status_completed", { result, durationMs: Date.now() - started });
    }
  }

  async readStatus(personId) {
    if (!this.config.enabled) return { enabled: false, devices: [], tests: [] };
    const result = await this.database.query(`SELECT device.id,device.created_at AS "createdAt",device.revoked_at IS NOT NULL AS revoked
      FROM messaging.push_devices device JOIN identity.people person ON person.id=device.person_id
      WHERE person.tenant_id=$1::uuid AND person.contract_id=$2 ORDER BY device.revoked_at NULLS FIRST,device.created_at DESC LIMIT 10`, [this.context.tenantId, personId]);
    const tests = await this.database.query(`SELECT test.id,test.device_id AS "deviceId",test.created_at AS "createdAt",
      CASE WHEN test.expires_at<=clock_timestamp() AND test.status='queued' THEN 'expired'
        WHEN test.expires_at<=clock_timestamp() AND test.status='sending' THEN 'unknown' ELSE test.status END AS status,
      test.confirmed_at IS NOT NULL AS confirmed
      FROM messaging.push_tests test JOIN identity.people person ON person.id=test.person_id
      WHERE person.tenant_id=$1::uuid AND person.contract_id=$2 ORDER BY test.created_at DESC LIMIT 10`, [this.context.tenantId, personId]);
    return { enabled: true, publicKey: this.config.publicKey, devices: result.rows, tests: tests.rows };
  }

  async execute(principal, body) {
    closed(body, ["operationId", "accountId", "action", "value"]);
    if (body.accountId !== principal.id) throw new AppError("AUTH_REQUIRED", "Anmeldung wurde geaendert", 401);
    const operationId = uuid(body.operationId);
    if (!new Set(["register", "revoke", "test", "confirm"]).has(body.action)) throw new AppError("VALIDATION_ERROR", "Push-Aktion ist ungueltig", 400);
    const value = body.action === "register" ? subscription(body.value) : uuid(body.value);
    const command = `push.${body.action}`;
    const started = Date.now();
    let outcome = "failed";
    let opened = false;
    try {
      const operation = await this.ops.beginIdempotency({ operationId, actorPersonId: principal.id, command, requestHash: requestHash({ action: body.action, value }) });
      const repeated = PostgresCompetitionService.prototype.repeatedResult(operation);
      if (repeated) { outcome = "success"; return repeated; }
      opened = true;
      const result = await this.ops.executeAudited({ audit: {
        operationId, actorType: "user", actorPersonId: principal.id, role: principal.role, action: command,
        subjectType: "push", subjectId: body.action === "register" ? principal.id : value, before: {},
      }, transactionOperation: command, isolation: "serializable", retries: 2 }, async (transaction) => {
        if (!this.config.enabled) throw new AppError("PUSH_DISABLED", "Push-Pilot ist noch nicht aktiviert", 503);
        const person = await transaction.query(`SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id=$2 AND active FOR UPDATE`, [this.context.tenantId, principal.id]);
        if (!person.rowCount) throw new AppError("AUTH_REQUIRED", "Aktive Anmeldung erforderlich", 401);
        const personId = person.rows[0].id;
        let response;
        if (body.action === "register") {
          const prior = await transaction.query("SELECT person_id,revoked_at FROM messaging.push_devices WHERE endpoint=$1 FOR UPDATE", [value.endpoint]);
          if (prior.rowCount && prior.rows[0].person_id !== personId) throw new AppError("PUSH_DEVICE_CONFLICT", "Dieses Browserprofil ist bereits einem anderen Konto zugeordnet. Dort zuerst deaktivieren.", 409);
          const count = await transaction.query("SELECT count(*)::int AS count FROM messaging.push_devices WHERE person_id=$1 AND revoked_at IS NULL", [personId]);
          if ((!prior.rowCount || prior.rows[0].revoked_at) && count.rows[0].count >= 10) throw new AppError("PUSH_DEVICE_LIMIT", "Hoechstens zehn Push-Geraete sind erlaubt", 409);
          const device = await transaction.query(`INSERT INTO messaging.push_devices(person_id,endpoint,p256dh,auth) VALUES ($1,$2,$3,$4)
            ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,revoked_at=NULL,updated_at=clock_timestamp() RETURNING id`, [personId,value.endpoint,value.keys.p256dh,value.keys.auth]);
          response = { success: true, deviceId: device.rows[0].id };
        } else if (body.action === "confirm") {
          const test = await transaction.query("UPDATE messaging.push_tests SET confirmed_at=COALESCE(confirmed_at,clock_timestamp()) WHERE id=$1 AND person_id=$2 RETURNING id", [value,personId]);
          if (!test.rowCount) throw new AppError("PUSH_NOT_FOUND", "Test wurde nicht gefunden", 404);
          response = { success: true, testId: value };
        } else {
          const device = await transaction.query("SELECT id FROM messaging.push_devices WHERE id=$1 AND person_id=$2 AND revoked_at IS NULL FOR UPDATE", [value,personId]);
          if (!device.rowCount) throw new AppError("PUSH_NOT_FOUND", "Aktives eigenes Geraet wurde nicht gefunden", 404);
          if (body.action === "revoke") {
            await transaction.query("UPDATE messaging.push_devices SET revoked_at=clock_timestamp() WHERE id=$1", [value]);
            await transaction.query("UPDATE messaging.push_tests SET status='cancelled' WHERE device_id=$1 AND status='queued'", [value]);
            response = { success: true, deviceId: value };
          } else {
            const recent = await transaction.query("SELECT 1 FROM messaging.push_tests WHERE person_id=$1 AND created_at > clock_timestamp()-interval '1 minute'", [personId]);
            if (recent.rowCount) throw new AppError("PUSH_TEST_RATE_LIMIT", "Bitte eine Minute bis zum naechsten Test warten", 429);
            const test = await transaction.query("INSERT INTO messaging.push_tests(device_id,person_id) VALUES ($1,$2) RETURNING id", [value,personId]);
            const testId = test.rows[0].id;
            await transaction.query(`INSERT INTO ops.outbox(tenant_id,event_type,payload_version,payload,idempotency_key,status,available_at)
              VALUES ($1,'push.pilot',1,$2::jsonb,$3,'pending',clock_timestamp())`, [this.context.tenantId,JSON.stringify({ testId }),`push:${testId}`]);
            await transaction.query("SELECT pg_notify('epiber_worker_wake','')");
            response = { success: true, testId };
          }
        }
        await this.ops.completeIdempotency(transaction,{ operationId,command,status:"success",response });
        return { ...response, auditAfter: { success: true } };
      });
      const { auditAfter, ...response } = result;
      outcome = "success";
      return response;
    } catch (error) {
      outcome = ["DB_COMMIT_OUTCOME_UNKNOWN","WRITE_OUTCOME_UNKNOWN"].includes(error.code) ? "unknown" : "failed";
      if (opened) await this.ops.finalizeIdempotency({ operationId,command,status:outcome }).catch(() => {});
      if (error instanceof AppError) throw error;
      throw new AppError(outcome === "unknown" ? "WRITE_OUTCOME_UNKNOWN" : "PUSH_OPERATION_FAILED", "Push-Aktion konnte nicht sicher abgeschlossen werden", 503);
    } finally { this.log("info","push_pilot_operation_completed",{ action:body.action,result:outcome,durationMs:Date.now()-started }); }
  }
}

module.exports = { PushPilotService, subscription, closed, uuid };
