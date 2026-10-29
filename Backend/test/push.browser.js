const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { hasSelectedProfile, launchSelectedBrowser, newProfilePage } = require("./browserProfiles");

const frontend = path.resolve(__dirname,"../../Frontend");
const chromium = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const deviceId = "00000000-0000-4000-8000-000000000001";
const testId = "00000000-0000-4000-8000-000000000002";
const key = crypto.createECDH("prime256v1"); key.generateKeys();
const publicKey = key.getPublicKey().toString("base64url");

test("Push-Pilot fuehrt Aktivierung, Test, Bestaetigung und Widerruf responsiv mit kontrollierten Fallbacks", {
  skip:!hasSelectedProfile() && !fs.existsSync(chromium),timeout:60000,
}, async () => {
  let snapshot = { enabled:true,publicKey,devices:[],tests:[] };
  const writes = [];
  const server = http.createServer(async (request,response) => {
    const url = new URL(request.url,"http://localhost");
    if (url.pathname === "/api/push-pilot") {
      response.setHeader("Content-Type","application/json");
      if (request.method === "GET") return response.end(JSON.stringify(snapshot));
      let text = ""; for await (const chunk of request) text += chunk;
      const body = JSON.parse(text); writes.push(body);
      let result = { success:true };
      if (body.action === "register") { snapshot.devices = [{ id:deviceId,revoked:false }]; result.deviceId = deviceId; }
      if (body.action === "test") { snapshot.tests = [{ id:testId,deviceId,status:"accepted",confirmed:false }]; result.testId = testId; }
      if (body.action === "confirm") snapshot.tests[0].confirmed = true;
      if (body.action === "revoke") snapshot.devices[0].revoked = true;
      return response.end(JSON.stringify(result));
    }
    const stubs = {
      "/JS/global.js":"",
      "/JS/diagnostics.js":"export const diagnostic = { error() {} };",
      "/JS/authClient.js":`export const ready = Promise.resolve(); export const getUser = () => window.__user; export function subscribeAuth(fn) { window.__auth = fn; queueMicrotask(() => fn(window.__user)); return () => {}; }`,
    };
    if (Object.hasOwn(stubs,url.pathname)) { response.setHeader("Content-Type","text/javascript"); return response.end(stubs[url.pathname]); }
    const file = path.resolve(frontend,`.${url.pathname}`);
    if (!file.startsWith(frontend + path.sep) || !fs.existsSync(file)) { response.writeHead(404); return response.end(); }
    response.setHeader("Content-Type",file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : "text/html");
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0,"127.0.0.1",resolve));
  const browser = await launchSelectedBrowser(chromium);
  try {
    const page = await newProfilePage(browser,{ viewport:{ width:390,height:844 } });
    const errors = [];
    page.on("pageerror",(error) => errors.push(error.message));
    await page.addInitScript(({ publicKey }) => {
      window.__user = { id:"1",role:"player" };
      window.__calls = [];
      function Notification() {}
      Notification.permission = "default";
      Notification.requestPermission = async () => { window.__calls.push("permission"); Notification.permission = "granted"; return "granted"; };
      Object.defineProperty(window,"Notification",{ configurable:true,value:Notification });
      Object.defineProperty(window,"PushManager",{ configurable:true,value:function () {} });
      const target = { options:{},toJSON:() => ({ endpoint:"https://fcm.googleapis.com/wp/browser-test",keys:{ p256dh:publicKey,auth:"A".repeat(22) } }),unsubscribe:async () => { window.__calls.push("unsubscribe"); return true; } };
      const registration = { pushManager:{ getSubscription:async () => null,subscribe:async () => { window.__calls.push("subscribe"); return target; } } };
      Object.defineProperty(navigator,"serviceWorker",{ configurable:true,value:{ register:async () => { window.__calls.push("register"); return registration; },ready:Promise.resolve(registration),getRegistration:async () => registration } });
    },{ publicKey });
    await page.goto(`http://127.0.0.1:${server.address().port}/push.html`);
    await page.waitForFunction(() => !document.getElementById("push-activate").disabled);
    assert.equal(writes.length,0,"no automatic activation");
    await page.locator("#push-activate").click();
    await page.waitForFunction(() => !document.getElementById("push-test").disabled);
    assert.deepEqual(await page.evaluate(() => window.__calls),["permission","register","subscribe"]);
    await page.locator("#push-test").click();
    await page.getByText("Vom Push-Dienst angenommen",{ exact:false }).last().waitFor();
    assert.equal(snapshot.tests[0].confirmed,false);
    await page.getByRole("button",{ name:"Ich habe diesen Test empfangen" }).click();
    await page.getByText("Empfang von dir bestätigt",{ exact:false }).waitFor();
    await page.getByRole("button",{ name:"Deaktivieren",exact:true }).click();
    await page.getByText("Gerät 1: deaktiviert",{ exact:true }).waitFor();
    assert.equal(await page.locator("#push-test").isDisabled(),true);
    assert.deepEqual(writes.map((row) => row.action),["register","test","confirm","revoke"]);
    assert.ok(writes.every((row) => row.accountId === "1"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),true);
    await page.evaluate(() => { Notification.permission = "denied"; });
    await page.locator("#push-refresh").click();
    await page.getByText("Benachrichtigungen sind blockiert.",{ exact:false }).waitFor();
    assert.equal(await page.locator("#push-activate").isDisabled(),true);
    await page.evaluate(() => { delete window.PushManager; });
    await page.locator("#push-refresh").click();
    await page.getByText("Push ist in diesem Browserkontext nicht verfügbar.",{ exact:false }).waitFor();
    await page.evaluate(() => { window.__user = null; window.__auth(null); });
    await page.getByText("Bitte zuerst anmelden.",{ exact:true }).waitFor();
    assert.equal(await page.locator("#push-tests li").count(),0);
    assert.equal(await page.locator("#push-devices li").count(),0);
    assert.equal(await page.locator("#push-refresh").isDisabled(),true);
    assert.deepEqual(errors,[]);
    await page.context().close();
    snapshot = { enabled:false,devices:[],tests:[] };
    const disabled = await newProfilePage(browser);
    await disabled.addInitScript(() => { window.__user = { id:"1",role:"player" }; });
    await disabled.goto(`http://127.0.0.1:${server.address().port}/push.html`);
    await disabled.getByText("Der Push-Pilot ist serverseitig noch nicht aktiviert.",{ exact:true }).waitFor();
    assert.equal(await disabled.locator("#push-activate").isDisabled(),true);
    await disabled.context().close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
