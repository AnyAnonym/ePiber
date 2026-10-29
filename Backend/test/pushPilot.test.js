"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { pushConfig } = require("../pushConfig");
const { subscription } = require("../pushPilotService");

test("Push-Konfiguration bleibt ohne Opt-in aus und validiert geschuetzte VAPID-Schluesselpaare", (t) => {
  assert.deepEqual(pushConfig({}),{ enabled:false });
  assert.throws(() => pushConfig({ PUSH_PILOT_ENABLED:"true" }),{ code:"PUSH_CONFIG_INVALID" });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"epiber-push-key-"));
  t.after(() => { fs.unlinkSync(path.join(directory,"key")); fs.rmdirSync(directory); });
  const key = crypto.createECDH("prime256v1"); key.generateKeys();
  fs.writeFileSync(path.join(directory,"key"),key.getPrivateKey().toString("base64url"),{ mode:0o600 });
  const env = { PUSH_PILOT_ENABLED:"true",PUSH_VAPID_PRIVATE_KEY_FILE:path.join(directory,"key"),PUSH_VAPID_PUBLIC_KEY:key.getPublicKey().toString("base64url"),PUSH_VAPID_SUBJECT:"https://example.test" };
  assert.equal(pushConfig(env).enabled,true);
  assert.throws(() => pushConfig({ ...env,PUSH_VAPID_PUBLIC_KEY:"A".repeat(87) }),{ code:"PUSH_CONFIG_INVALID" });
});

test("Push-Registrierung verwirft SSRF, falsche Schluessel und freie Zusatzfelder", () => {
  const key = crypto.createECDH("prime256v1"); key.generateKeys();
  const value = { endpoint:"https://fcm.googleapis.com/wp/test",keys:{ p256dh:key.getPublicKey().toString("base64url"),auth:crypto.randomBytes(16).toString("base64url") } };
  assert.deepEqual(subscription(value),value);
  for (const endpoint of ["http://fcm.googleapis.com/wp/test","https://127.0.0.1/test","https://fcm.googleapis.com.evil.test/test","https://fcm.googleapis.com:8443/test","https://user@fcm.googleapis.com/test","https://evil.test/?to=https://fcm.googleapis.com"]) {
    assert.throws(() => subscription({ ...value,endpoint }),{ code:"PUSH_SUBSCRIPTION_INVALID" });
  }
  assert.throws(() => subscription({ ...value,extra:"payload" }),{ code:"VALIDATION_ERROR" });
  assert.throws(() => subscription({ ...value,keys:{ ...value.keys,p256dh:"A".repeat(87) } }),{ code:"PUSH_SUBSCRIPTION_INVALID" });
});

test("Push-Service-Worker zeigt neutralen Test, navigiert nur intern und bestaetigt nie automatisch", async () => {
  const events = new Map();
  const shown = [];
  const opened = [];
  const context = { URL,self:{ location:{ origin:"https://example.test" },addEventListener:(type,fn) => events.set(type,fn),registration:{ showNotification:async (...args) => shown.push(args) },clients:{ openWindow:async (url) => opened.push(url) } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../../Frontend/push-worker.js"),"utf8"),context);
  let pending;
  const testId = crypto.randomUUID();
  events.get("push")({ data:{ json:() => ({ version:1,type:"push-pilot",testId,url:"https://evil.test" }) },waitUntil:(p) => { pending = p; } });
  await pending;
  assert.equal(shown.length,1);
  assert.equal(shown[0][1].body.includes("bestätige"),true);
  events.get("push")({ data:{ json:() => ({ version:1,type:"push-pilot",testId:"invalid" }) },waitUntil:() => assert.fail("Invalid payload") });
  events.get("notificationclick")({ notification:{ close() {} },waitUntil:(p) => { pending = p; } });
  await pending;
  assert.deepEqual(opened,["https://example.test/push.html"]);
  assert.deepEqual([...events.keys()],["push","notificationclick"]);
});
