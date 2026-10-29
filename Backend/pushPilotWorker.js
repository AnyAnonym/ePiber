"use strict";

const webpush = require("web-push");
const { subscription, uuid, closed } = require("./pushPilotService");

function createPushPilotWorker({ repository, config, send = (target, payload, options) => webpush.sendNotification(target, payload, options), log = () => {} }) {
  const { database, context } = repository;
  async function deliver({ payload, attempt = 1 }) {
    closed(payload, ["testId"]);
    const testId = uuid(payload.testId);
    const started = Date.now();
    let status = "unknown";
    try {
      const result = await database.withTransaction("push.claim", async (transaction) => {
        const found = await transaction.query(`SELECT test.id,test.status,test.expires_at<=clock_timestamp() AS expired,
          GREATEST(0,EXTRACT(EPOCH FROM test.expires_at-clock_timestamp())::integer) AS ttl,
          device.endpoint,device.p256dh,device.auth,device.revoked_at IS NOT NULL OR NOT person.active AS revoked
          FROM messaging.push_tests test JOIN messaging.push_devices device ON device.id=test.device_id
          JOIN identity.people person ON person.id=test.person_id
          WHERE test.id=$1 AND person.tenant_id=$2 FOR UPDATE OF test`, [testId,context.tenantId]);
        const row = found.rows[0];
        if (!row) return null;
        // A previous process may have sent before crashing. Never resend blindly.
        if (row.status === "sending") {
          await transaction.query("UPDATE messaging.push_tests SET status='unknown',error_code='PUSH_OUTCOME_UNKNOWN' WHERE id=$1", [testId]);
          status = "unknown";
          return null;
        }
        if (row.status !== "queued") { status = row.status; return null; }
        status = row.expired ? "expired" : row.revoked ? "cancelled" : !config.enabled ? "failed" : "sending";
        await transaction.query("UPDATE messaging.push_tests SET status=$2 WHERE id=$1", [testId,status]);
        return status === "sending" ? row : null;
      });
      if (!result) {
        if (status === "unknown") throw Object.assign(new Error("Unklarer Versand"), { code:"WRITE_OUTCOME_UNKNOWN" });
        return;
      }
      const target = subscription({ endpoint:result.endpoint, keys:{ p256dh:result.p256dh,auth:result.auth } });
      let errorCode = null;
      let retry = false;
      try {
        await send(target, JSON.stringify({ version:1,type:"push-pilot",testId }), {
          TTL:result.ttl,urgency:"normal",timeout:10000,
          vapidDetails:{ subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey },
        });
        status = "accepted";
      } catch (error) {
        const code = Number(error.statusCode);
        status = code === 404 || code === 410 ? "expired" : code === 429 || code >= 500 ? (attempt < 5 ? "queued" : "failed") : code >= 400 && code < 500 ? "failed" : "unknown";
        errorCode = status === "unknown" ? "PUSH_OUTCOME_UNKNOWN" : status === "expired" ? "PUSH_SUBSCRIPTION_EXPIRED" : status === "queued" ? "PUSH_PROVIDER_RETRY" : "PUSH_PROVIDER_REJECTED";
        retry = status === "queued";
      }
      await database.withTransaction("push.complete", async (transaction) => {
        await transaction.query("UPDATE messaging.push_tests SET status=$2,error_code=$3 WHERE id=$1", [testId,status,errorCode]);
        if (status === "expired") await transaction.query(`UPDATE messaging.push_devices SET revoked_at=clock_timestamp()
          WHERE id=(SELECT device_id FROM messaging.push_tests WHERE id=$1)`, [testId]);
      });
      if (retry) throw Object.assign(new Error("Push-Dienst voruebergehend nicht verfuegbar"), { code:"PUSH_PROVIDER_RETRY" });
      if (status === "unknown") throw Object.assign(new Error("Unklarer Versand"), { code:"WRITE_OUTCOME_UNKNOWN" });
    } catch (error) {
      // Never propagate provider payloads, endpoint URLs or encryption keys.
      throw Object.assign(new Error("Push-Test konnte nicht abgeschlossen werden"), { code:error.code === "PUSH_PROVIDER_RETRY" ? error.code : "WRITE_OUTCOME_UNKNOWN" });
    } finally {
      log(status === "unknown" || status === "failed" ? "warn" : "info","push_pilot_delivery_completed",{ result:status,durationMs:Date.now()-started });
    }
  }
  async function cleanup() {
    if (context.generation < 9) return;
    await database.withTransaction("push.retention", async (transaction) => {
      const tests = await transaction.query(`DELETE FROM messaging.push_tests WHERE id IN (
        SELECT test.id FROM messaging.push_tests test JOIN identity.people person ON person.id=test.person_id
        WHERE person.tenant_id=$1 AND test.created_at<clock_timestamp()-interval '30 days' ORDER BY test.created_at LIMIT 1000)`, [context.tenantId]);
      const devices = await transaction.query(`DELETE FROM messaging.push_devices WHERE id IN (
        SELECT device.id FROM messaging.push_devices device JOIN identity.people person ON person.id=device.person_id
        WHERE person.tenant_id=$1 AND COALESCE(device.revoked_at,device.updated_at)<clock_timestamp()-interval '90 days'
        ORDER BY device.updated_at LIMIT 1000)`, [context.tenantId]);
      log("info","push_pilot_retention_completed",{ result:"success",testCount:tests.rowCount,deviceCount:devices.rowCount });
    });
  }
  return { deliver,cleanup };
}

module.exports = { createPushPilotWorker };
