const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { launchSelectedBrowser, newProfilePage } = require("./browserProfiles.js");

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const FRONTEND_ROOT = path.resolve(__dirname, "../../Frontend");

const authStub = `
export const ready = Promise.resolve();
export function getUser() { return { id: "operator-1", role: "operator" }; }
export const hasRole = (...roles) => roles.includes(getUser().role);
export function subscribeAuth(callback) { queueMicrotask(() => callback(getUser())); return () => {}; }
`;

const dataStub = `
const courts = {
  "1": { matchId: "m1", aktiv: 0, revision: 4, automaticActivation: { matchId: "m1", matchDate: "260924-1800", status: "pending" } },
  "2": { matchId: "m2", aktiv: 0, revision: 7, automaticActivation: { matchId: "m2", matchDate: "260924-1700", status: "finished" } },
};
export function createEndpoint(endpoint) {
  return async () => {
    if (endpoint === "navigator") return { data: { success: true, items: [{ id: "activation", label: "Platzaktivierung", action: { kind: "court.activation" } }] } };
    if (endpoint === "monitorList") return { data: { success: true, monitors: [] } };
    if (endpoint === "getScoreboardCourts") return { data: { success: true, courts: structuredClone(courts) } };
    return { data: { success: true } };
  };
}
export function getOperationId() { return "00000000-0000-4000-8000-000000000001"; }
export function releaseOperationId() {}
export function onConnectionState(callback) { queueMicrotask(() => callback({ state: "open", connected: true })); return () => {}; }
export function onResync() { return () => {}; }
export function subscribe() { return () => {}; }
export function subscribeInvalidations() { return () => {}; }
`;

const diagnosticsStub = `export const diagnostic = { debug() {}, info() {}, warn() {}, error() {} };`;

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function startServer({ role = "operator", data = dataStub } = {}) {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const stubs = {
      "/JS/authClient.js": authStub.replace('role: "operator"', `role: "${role}"`),
      "/JS/dataClient.js": data,
      "/JS/diagnostics.js": diagnosticsStub,
      "/JS/favorites.js": "",
      "/JS/navigatorScroll.js": "",
      "/JS/global.js": "",
    };
    if (Object.hasOwn(stubs, pathname)) {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(stubs[pathname]);
      return;
    }
    const relative = pathname.replace(/^\/+/, "");
    const filePath = path.resolve(FRONTEND_ROOT, relative || "navigator.html");
    if (!filePath.startsWith(`${FRONTEND_ROOT}${path.sep}`) || !fs.existsSync(filePath)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("Navigator zeigt den automatischen Courtstart responsiv", {
  skip: !process.env.PLAYWRIGHT_PROFILE && !fs.existsSync(CHROMIUM_PATH) && `Chromium fehlt unter ${CHROMIUM_PATH}`,
  timeout: 60000,
}, async () => {
  const server = await startServer();
  const browser = await launchSelectedBrowser(CHROMIUM_PATH);
  try {
    const page = await newProfilePage(browser);
    await page.goto(`http://127.0.0.1:${server.address().port}/navigator.html`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Platzaktivierung" }).click();
    const buttons = page.locator(".platz-aktivierung-btn");
    await buttons.first().waitFor({ state: "visible" });
    assert.equal(await buttons.nth(0).textContent(), "Platz 1: inaktivAutomatischer Start: 18:00");
    assert.equal(await buttons.nth(1).textContent(), "Platz 2: inaktivNach Ergebnis deaktiviert");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Navigator loescht nur widerrufene Monitore nach Bestaetigung und erhaelt neue Tokens", {
  skip: !process.env.PLAYWRIGHT_PROFILE && !fs.existsSync(CHROMIUM_PATH) && `Chromium fehlt unter ${CHROMIUM_PATH}`,
  timeout: 60000,
}, async () => {
  const data = dataStub.replace('if (endpoint === "monitorList") return { data: { success: true, monitors: [] } };', `
    if (endpoint === "monitorList") return { data: { success: true, monitors: structuredClone(window.testMonitors) } };
    if (endpoint === "monitorProvision") {
      const monitor = { monitorId: "new-monitor", label: params.label, revokedAt: null, token: "test-token" };
      window.testMonitors.push(monitor);
      return { data: { success: true, monitor } };
    }
    if (endpoint === "monitorDelete") {
      window.deleteCalls.push(params);
      if (window.failDelete) return { data: { success: false, error: { code: "MONITOR_NOT_REVOKED", message: "Monitor muss vor dem Loeschen widerrufen werden" } } };
      window.testMonitors = window.testMonitors.filter(({ monitorId }) => monitorId !== params.monitorId);
      return { data: { success: true, monitorId: params.monitorId, deleted: true } };
    }
  `).replace("return async () =>", "return async (params = {}) =>");
  const server = await startServer({ role: "admin", data });
  const browser = await launchSelectedBrowser(CHROMIUM_PATH);
  try {
    const page = await newProfilePage(browser);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.testMonitors = [
        { monitorId: "veranda", label: "Veranda", revokedAt: 1 },
        { monitorId: "active-monitor", label: "Aktiver Monitor", revokedAt: null },
      ];
      window.deleteCalls = [];
      window.failDelete = false;
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/navigator.html`, { waitUntil: "domcontentloaded" });
    const veranda = page.locator(".admin-monitor-row").filter({ hasText: "Veranda" });
    await veranda.getByRole("button", { name: "Löschen", exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.locator(".admin-monitor-row").filter({ hasText: "Aktiver Monitor" }).getByRole("button", { name: "Löschen", exact: true }).count(), 0);
    page.once("dialog", (dialog) => dialog.dismiss());
    await veranda.getByRole("button", { name: "Löschen", exact: true }).click();
    assert.equal(await page.evaluate(() => window.deleteCalls.length), 0);
    await page.getByLabel("Bezeichnung", { exact: true }).fill("Neuer Monitor");
    await page.getByRole("button", { name: "Monitor anlegen", exact: true }).click();
    await page.locator("#monitor-token-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator("#monitor-token").textContent(), "test-token");
    await page.evaluate(() => { window.failDelete = true; });
    page.once("dialog", (dialog) => dialog.accept());
    await veranda.getByRole("button", { name: "Löschen", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#admin-monitor-status").dataset.type === "error");
    assert.equal(await veranda.count(), 1);
    await page.evaluate(() => { window.failDelete = false; });
    page.once("dialog", (dialog) => dialog.accept());
    await veranda.getByRole("button", { name: "Löschen", exact: true }).click();
    await veranda.waitFor({ state: "detached" });
    assert.equal(await page.locator(".admin-monitor-row").count(), 2);
    assert.equal(await page.locator("#monitor-token-panel").isVisible(), true);
    assert.equal(await page.locator("#monitor-token").textContent(), "test-token");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
