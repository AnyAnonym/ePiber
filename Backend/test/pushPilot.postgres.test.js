"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { startPostgresTestCluster } = require("./postgresTestCluster");
const { runMigrations } = require("../db/migrationRunner");
const { applyTechnicalSeed, applyFullDevelSeed } = require("../db/seedRunner");
const { createRuntimeRepositories } = require("../db/createRuntimeRepositories");
const { AUDIT_CONTRACTS, IDEMPOTENCY_CONTRACTS } = require("../postgresRuntimeContracts");
const { PushPilotService } = require("../pushPilotService");
const { createPushPilotWorker } = require("../pushPilotWorker");
const { applyBootstrap, applyExistingDatabaseGrants } = require("../db/bootstrap");
const { Client } = require("pg");

async function fixture(t) {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig:cluster.connectionConfig,command:"up",targetGeneration:6,output:() => {} });
  await applyTechnicalSeed({ connectionConfig:cluster.connectionConfig,asOf:"2026-10-11T00:00:00.000Z",output:() => {} });
  await applyFullDevelSeed({ connectionConfig:cluster.connectionConfig,asOf:"2026-10-11T00:00:00.000Z",output:() => {} });
  await runMigrations({ connectionConfig:cluster.connectionConfig,command:"up",targetGeneration:9,output:() => {} });
  const logs = [];
  const log = (level,event,fields) => logs.push({ level,event,fields });
  const runtime = createRuntimeRepositories({ connectionConfig:cluster.connectionConfig,expectedTenantCode:"devel-epiber",auditContracts:AUDIT_CONTRACTS,idempotencyContracts:IDEMPOTENCY_CONTRACTS,log });
  t.after(() => runtime.close());
  const repositories = await runtime.connect();
  const config = { enabled:true,publicKey:"public",privateKey:"private",subject:"https://example.test" };
  const service = new PushPilotService({ ...repositories,config,log });
  const key = crypto.createECDH("prime256v1"); key.generateKeys();
  const subscription = { endpoint:"https://fcm.googleapis.com/wp/private-endpoint", keys:{ p256dh:key.getPublicKey().toString("base64url"),auth:crypto.randomBytes(16).toString("base64url") } };
  const principal = { id:"1",role:"admin" };
  const execute = (action,value,actor = principal,operationId = crypto.randomUUID()) => service.execute(actor,{ operationId,accountId:actor.id,action,value });
  const worker = (send) => createPushPilotWorker({ repository:repositories.ops,config,send,log });
  return { cluster,database:repositories.identity.database,repositories,service,logs,subscription,execute,worker,principal };
}

test("Push-Pilot persistiert Registrierung, Testauftrag und ausdruecklichen Empfang auditierbar ohne Inbox-Aenderung", { timeout:30000 }, async (t) => {
  const f = await fixture(t);
  const before = (await f.database.query("SELECT count(*) FROM messaging.event_recipients")).rows;
  const operationId = crypto.randomUUID();
  const device = await f.execute("register",f.subscription,f.principal,operationId);
  assert.equal((await f.execute("register",f.subscription,f.principal,operationId)).deviceId,device.deviceId);
  const queued = await f.execute("test",device.deviceId);
  const outbox = await f.database.query("SELECT payload FROM ops.outbox WHERE event_type='push.pilot'");
  assert.deepEqual(outbox.rows[0].payload,{ testId:queued.testId });
  let sent = 0;
  await f.worker(async (target,payload,options) => {
    sent++;
    assert.deepEqual(target,f.subscription);
    assert.deepEqual(JSON.parse(payload),{ version:1,type:"push-pilot",testId:queued.testId });
    assert.ok(options.TTL > 0 && options.TTL <= 600);
  }).deliver({ payload:{ testId:queued.testId } });
  await f.worker(() => { sent++; }).deliver({ payload:{ testId:queued.testId } });
  assert.equal(sent,1);
  let status = await f.service.status("1");
  assert.equal(status.tests[0].status,"accepted");
  assert.equal(status.tests[0].confirmed,false);
  await f.execute("confirm",queued.testId);
  status = await f.service.status("1");
  assert.equal(status.tests[0].confirmed,true);
  assert.equal(JSON.stringify(status).includes(f.subscription.endpoint),false);
  const audit = await f.database.query("SELECT action,status,before_projection,after_projection FROM ops.audit_operations WHERE action LIKE 'push.%'");
  assert.deepEqual(audit.rows.map((r) => r.action).sort(),["push.confirm","push.register","push.test"]);
  assert.ok(audit.rows.every((r) => r.status === "success"));
  assert.deepEqual((await f.database.query("SELECT count(*) FROM messaging.event_recipients")).rows,before);
  assert.equal(JSON.stringify(f.logs).includes("private-endpoint"),false);
});

test("Push-Pilot isoliert Konten, blockiert fremde Bestaetigung und widerruft nur eigene Geraete", { timeout:30000 }, async (t) => {
  const f = await fixture(t);
  const device = await f.execute("register",f.subscription);
  const actor = { id:"2",role:"player" };
  await assert.rejects(f.execute("register",f.subscription,actor),{ code:"PUSH_DEVICE_CONFLICT" });
  await assert.rejects(f.execute("revoke",device.deviceId,actor),{ code:"PUSH_NOT_FOUND" });
  const queued = await f.execute("test",device.deviceId);
  await assert.rejects(f.execute("confirm",queued.testId,actor),{ code:"PUSH_NOT_FOUND" });
  await assert.rejects(f.execute("test",device.deviceId),{ code:"PUSH_TEST_RATE_LIMIT" });
  assert.equal((await f.service.status("2")).devices.length,0);
  await f.execute("revoke",device.deviceId);
  let sent = false;
  await f.worker(() => { sent = true; }).deliver({ payload:{ testId:queued.testId } });
  assert.equal(sent,false);
  assert.equal((await f.service.status("1")).tests[0].status,"cancelled");
  assert.equal((await f.service.status("1")).devices[0].revoked,true);
  const transitions = await f.database.query("SELECT transition FROM ops.audit_transitions");
  assert.ok(transitions.rows.some((r) => r.transition === "failed"));
});

test("Push-Worker behandelt Providerfehler, Retrygrenze, Ablauf und Crash ohne blinden Doppelversand", { timeout:30000 }, async (t) => {
  const f = await fixture(t);
  const device = await f.execute("register",f.subscription);
  const queued = await f.execute("test",device.deviceId);
  const payload = { testId:queued.testId };
  const deliver = (code,attempt) => f.worker(async () => { throw Object.assign(new Error(`secret ${f.subscription.endpoint}`),code ? { statusCode:code } : {}); }).deliver({ payload,attempt });
  await assert.rejects(deliver(503,1),{ code:"PUSH_PROVIDER_RETRY" });
  assert.equal((await f.service.status("1")).tests[0].status,"queued");
  await deliver(429,5);
  assert.equal((await f.service.status("1")).tests[0].status,"failed");
  await f.database.query("UPDATE messaging.push_tests SET status='queued' WHERE id=$1",[queued.testId]);
  await assert.rejects(deliver(null,1),{ code:"WRITE_OUTCOME_UNKNOWN" });
  assert.equal((await f.service.status("1")).tests[0].status,"unknown");
  await f.database.query("UPDATE messaging.push_tests SET status='sending' WHERE id=$1",[queued.testId]);
  let sent = false;
  await assert.rejects(f.worker(() => { sent = true; }).deliver({ payload }),{ code:"WRITE_OUTCOME_UNKNOWN" });
  assert.equal(sent,false);
  assert.equal((await f.service.status("1")).tests[0].status,"unknown");
  await f.database.query("UPDATE messaging.push_tests SET status='queued' WHERE id=$1",[queued.testId]);
  await deliver(410,1);
  assert.equal((await f.service.status("1")).devices[0].revoked,true);
  await f.execute("register",f.subscription);
  await f.database.query("UPDATE messaging.push_tests SET status='queued',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[queued.testId]);
  await f.worker(() => { sent = true; }).deliver({ payload });
  assert.equal(sent,false);
  assert.equal((await f.service.status("1")).tests[0].status,"expired");
  assert.equal(JSON.stringify(f.logs).includes("private-endpoint"),false);
  await f.database.query("UPDATE messaging.push_tests SET created_at=clock_timestamp()-interval '31 days'");
  await f.worker().cleanup();
  assert.equal((await f.service.status("1")).tests.length,0);
});

test("Push-Pilot funktioniert mit echten App-/Worker-Grants; Read-only liest keine Subscription-Geheimnisse", { timeout:30000 }, async (t) => {
  const f = await fixture(t);
  const prefix = "push_test";
  const passwords = Object.fromEntries(["migrator","app","worker","monitor","backup","refresh","app_readonly"].map((role) => [role,"test-only"]));
  await applyBootstrap({ adminConnectionConfig:f.cluster.connectionConfig,prefix,database:"postgres",passwords,output:() => {} });
  await applyExistingDatabaseGrants({ adminConnectionConfig:f.cluster.connectionConfig,prefix,database:"postgres",output:() => {} });
  const app = createRuntimeRepositories({ connectionConfig:{ ...f.cluster.connectionConfig,user:`${prefix}_app` },expectedTenantCode:"devel-epiber",auditContracts:AUDIT_CONTRACTS,idempotencyContracts:IDEMPOTENCY_CONTRACTS });
  t.after(() => app.close());
  const repositories = await app.connect();
  const service = new PushPilotService({ ...repositories,config:{ enabled:true,publicKey:"public" } });
  const execute = (action,value) => service.execute(f.principal,{ operationId:crypto.randomUUID(),accountId:"1",action,value });
  const device = await execute("register",f.subscription);
  const queued = await execute("test",device.deviceId);
  const worker = new Client({ ...f.cluster.connectionConfig,user:`${prefix}_worker` });
  await worker.connect();
  try {
    assert.equal((await worker.query("SELECT endpoint FROM messaging.push_devices WHERE id=$1",[device.deviceId])).rowCount,1);
    await worker.query("UPDATE messaging.push_tests SET status='accepted' WHERE id=$1",[queued.testId]);
    await worker.query("UPDATE messaging.push_devices SET revoked_at=clock_timestamp() WHERE id=$1",[device.deviceId]);
    await worker.query("DELETE FROM messaging.push_tests WHERE id=$1",[queued.testId]);
  } finally { await worker.end(); }
  const readonly = new Client({ ...f.cluster.connectionConfig,user:`${prefix}_app_readonly` });
  await readonly.connect();
  try { await assert.rejects(readonly.query("SELECT endpoint,auth FROM messaging.push_devices"),{ code:"42501" }); }
  finally { await readonly.end(); }
});
