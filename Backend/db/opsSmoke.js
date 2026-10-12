"use strict";

const crypto = require("node:crypto");
const { Client } = require("pg");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function createOpsSmoke({ connectionConfig, tenantCode, operationId = crypto.randomUUID(), output = () => {} }) {
  const client = new Client(connectionConfig);
  await client.connect();
  output(JSON.stringify({ event: "db_ops_smoke_started", operationId }));
  try {
    const tenant = await client.query("SELECT id FROM core.tenants WHERE tenant_code=$1", [tenantCode]);
    if (tenant.rowCount !== 1) throw Object.assign(new Error("Smoke-Tenant fehlt"), { code: "OPS_SMOKE_TENANT_INVALID" });
    const existing = await client.query("SELECT 1 FROM ops.idempotency_operations WHERE tenant_id=$1 AND operation_id=$2", [tenant.rows[0].id, operationId]);
    if (existing.rowCount) throw Object.assign(new Error("Smoke-ID existiert bereits"), { code: "OPS_SMOKE_DUPLICATE" });
    const requestHash = crypto.createHash("sha256").update(`ops-smoke:${operationId}`).digest();
    await client.query("BEGIN");
    try {
      await client.query(`INSERT INTO ops.idempotency_operations
        (tenant_id,operation_id,command,request_hash,status,response_projection,response_expires_at,started_at,completed_at,expires_at)
        VALUES ($1,$2,'ops.smoke',$3,'success',$4,clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour')`,
      [tenant.rows[0].id, operationId, requestHash, JSON.stringify({ status: "committed" })]);
      await client.query(`INSERT INTO ops.outbox
        (tenant_id,event_type,payload_version,payload,idempotency_key,status,available_at)
        VALUES ($1,'websocket.invalidate',1,$2,$3,'pending',clock_timestamp())`,
      [tenant.rows[0].id, JSON.stringify({ projection: "identity", eventId: operationId }), `ops-smoke:${operationId}`]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    output(JSON.stringify({ event: "db_ops_smoke_committed", operationId, result: "success" }));
    return operationId;
  } finally {
    await client.end();
  }
}

async function waitForOpsSmoke({ connectionConfig, operationId, timeoutMs = 30_000 }) {
  const client = new Client(connectionConfig);
  await client.connect();
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await client.query(`SELECT operation.status AS operation_status,outbox.status AS outbox_status
        FROM ops.idempotency_operations operation
        JOIN ops.outbox outbox ON outbox.tenant_id=operation.tenant_id AND outbox.idempotency_key='ops-smoke:'||operation.operation_id::text
        WHERE operation.operation_id=$1`, [operationId]);
      if (result.rowCount === 1 && result.rows[0].operation_status === "success" && result.rows[0].outbox_status === "sent") return result.rows[0];
      if (result.rowCount === 1 && ["unknown", "failed"].includes(result.rows[0].outbox_status)) throw Object.assign(new Error("Smoke-Outbox ist fehlgeschlagen"), { code: "OPS_SMOKE_OUTBOX_FAILED" });
      await sleep(250);
    }
    throw Object.assign(new Error("Smoke-Workerzeit ueberschritten"), { code: "OPS_SMOKE_WORKER_TIMEOUT" });
  } finally {
    await client.end();
  }
}

async function cleanupOpsSmoke({ connectionConfig, operationId }) {
  const client = new Client(connectionConfig);
  await client.connect();
  try {
    await client.query("BEGIN");
    try {
      const outbox = await client.query("DELETE FROM ops.outbox WHERE idempotency_key=$1", [`ops-smoke:${operationId}`]);
      const operation = await client.query("DELETE FROM ops.idempotency_operations WHERE operation_id=$1 AND command='ops.smoke'", [operationId]);
      if (outbox.rowCount !== 1 || operation.rowCount !== 1) throw Object.assign(new Error("Smoke-Cleanup ist unvollstaendig"), { code: "OPS_SMOKE_CLEANUP_MISMATCH" });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function runOpsSmoke({ appConnectionConfig, cleanupConnectionConfig, tenantCode, output = () => {}, afterCommit = null }) {
  let operationId = null;
  try {
    operationId = await createOpsSmoke({ connectionConfig: appConnectionConfig, tenantCode, output });
    await afterCommit?.(operationId);
    await waitForOpsSmoke({ connectionConfig: appConnectionConfig, operationId });
    await cleanupOpsSmoke({ connectionConfig: cleanupConnectionConfig, operationId });
    output(JSON.stringify({ event: "db_ops_smoke_completed", operationId, result: "success", cleaned: true }));
    return { operationId, cleaned: true };
  } catch (error) {
    let cleaned = false;
    if (operationId) {
      try { await cleanupOpsSmoke({ connectionConfig: cleanupConnectionConfig, operationId }); cleaned = true; } catch {}
    }
    output(JSON.stringify({ event: "db_ops_smoke_completed", operationId, result: cleaned ? "failed" : "unknown", errorCode: error.code || "OPS_SMOKE_FAILED", cleaned }));
    throw Object.assign(error, { completionLogged: true });
  }
}

module.exports = { cleanupOpsSmoke, createOpsSmoke, runOpsSmoke, waitForOpsSmoke };
