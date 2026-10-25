const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { hasSelectedProfile, launchSelectedBrowser, newProfilePage } = require("./browserProfiles");

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const FRONTEND_ROOT = path.resolve(__dirname, "../../Frontend");

const authStub = `
let user = { id: "admin-1", role: "admin", login: "admin" };
let listener = null;
export const ready = Promise.resolve(user);
export const hasRole = (...roles) => Boolean(user) && roles.some((role) => (user.roles || [user.role]).includes(role));
export function subscribeAuth(callback) {
  listener = callback;
  queueMicrotask(() => callback(user, { status: "authenticated" }));
  return () => {};
}
window.__loseServiceAuth = () => {
  user = null;
  listener?.(null, { status: "anonymous" });
};
`;

const dataClientStub = `
let refreshCount = 0;
let statusCount = 0;
let resolveRefresh = null;
let rejectRefresh = null;
let statusFailure = false;
const status = {
  success: true,
  lastSuccessfulRefreshAt: "2026-08-28T10:00:00.000Z",
  dataAgeMs: 65000,
  inProgress: null,
  lastControlledFailure: {
    at: "2026-08-28T09:00:00.000Z",
    message: "Kontrolliert <img src=x onerror=alert(1)>",
    supportId: "support-safe-1",
  },
};
export function createEndpoint(name) {
  if (name === "projectionStatus") return async () => {
    statusCount += 1;
    if (statusFailure) throw Object.assign(new Error("Status vorübergehend nicht erreichbar"), { code: "DATA_NOT_READY" });
    return { data: status };
  };
  if (name === "refreshProjections") return async (params) => {
    refreshCount += 1;
    window.__lastRefreshParams = params;
    return new Promise((resolve, reject) => { resolveRefresh = resolve; rejectRefresh = reject; });
  };
  throw new Error("unexpected endpoint " + name);
}
export const getOperationId = () => "00000000-0000-4000-8000-000000000001";
export const releaseOperationId = () => {};
window.__serviceRefreshCount = () => refreshCount;
window.__serviceStatusCount = () => statusCount;
window.__setServiceStatus = (update) => Object.assign(status, update);
window.__setServiceStatusFailure = (value) => { statusFailure = value; };
window.__resolveServiceRefresh = () => {
  Object.assign(status, { lastSuccessfulRefreshAt: Date.now(), dataAgeMs: 0, lastControlledFailure: null, inProgress: null });
  resolveRefresh?.({ data: { success: true, tableCount: 8, changedTableCount: 0 } });
};
window.__rejectServiceRefresh = () => rejectRefresh?.(Object.assign(new Error("Projektionen konnten nicht neu geladen werden"), { code: "DATA_REFRESH_FAILED", supportId: "refresh-failure-1" }));
`;

function contentType(filename) {
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/javascript; charset=utf-8";
}

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/JS/servicebereich.js") {
      const source = fs.readFileSync(path.join(FRONTEND_ROOT, "JS/servicebereich.js"), "utf8")
        .replace('"./authClient.js"', '"/test/authClient.js"')
        .replace('"./dataClient.js"', '"/test/dataClient.js"')
        .replace('"./diagnostics.js"', '"/test/diagnostics.js"');
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(source);
      return;
    }
    if (pathname === "/test/authClient.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(authStub);
      return;
    }
    if (pathname === "/test/dataClient.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(dataClientStub);
      return;
    }
    if (pathname === "/test/diagnostics.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end("window.__serviceDiagnostics = []; export const diagnostic = { error(event, error) { window.__serviceDiagnostics.push({ event, code: error.code, supportId: error.supportId }); } };\n");
      return;
    }
    if (["/JS/navbar.js", "/JS/modals.js", "/JS/global.js", "/JS/footer.js"].includes(pathname)) {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end();
      return;
    }
    const relative = pathname.replace(/^\/+/, "") || "servicebereich.html";
    const filename = path.resolve(FRONTEND_ROOT, relative);
    if (!filename.startsWith(`${FRONTEND_ROOT}${path.sep}`) || !fs.existsSync(filename)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(filename) });
    response.end(fs.readFileSync(filename));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("Servicebereich rendert kontrolliert und sperrt Refresh bei Authverlust", {
  skip: !hasSelectedProfile() && !fs.existsSync(CHROMIUM_PATH) && `Chromium fehlt unter ${CHROMIUM_PATH}`,
  timeout: 30000,
}, async () => {
  const server = await startServer();
  const browser = await launchSelectedBrowser(CHROMIUM_PATH);
  try {
    const page = await newProfilePage(browser);
    await page.goto(`http://127.0.0.1:${server.address().port}/servicebereich.html`, { waitUntil: "domcontentloaded" });
    const button = page.getByRole("button", { name: "Projektionen neu laden", exact: true });
    await button.waitFor({ state: "visible" });
    await page.locator("#service-state-badge").filter({ hasText: "Letzter gültiger Stand" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

    assert.equal(await page.locator("#service-failure img").count(), 0);
    assert.match(await page.locator("#service-failure-message").textContent(), /<img src=x/);
    assert.equal(await page.locator("#service-failure-support").textContent(), "Support-ID: support-safe-1");

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await page.waitForFunction(() => window.__serviceStatusCount() === 2);

    await button.dblclick();
    assert.equal(await page.evaluate(() => window.__serviceRefreshCount()), 1);
    assert.equal(await button.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.__lastRefreshParams), {
      operationId: "00000000-0000-4000-8000-000000000001",
    });

    await page.evaluate(() => window.__loseServiceAuth());
    await page.evaluate(() => window.__resolveServiceRefresh());
    await page.locator("#service-access").waitFor({ state: "visible" });
    assert.equal(await page.locator("#service-app").isHidden(), true);
    assert.doesNotMatch(await page.locator("#service-feedback").textContent(), /erfolgreich/);
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Servicebereich zeigt Reload-Erfolg, kontrollierte Fehler und unbekannten Status ohne automatische Wiederholung", {
  skip: !hasSelectedProfile() && !fs.existsSync(CHROMIUM_PATH) && `Chromium fehlt unter ${CHROMIUM_PATH}`,
  timeout: 30000,
}, async () => {
  const server = await startServer();
  const browser = await launchSelectedBrowser(CHROMIUM_PATH);
  try {
    const page = await newProfilePage(browser);
    await page.goto(`http://127.0.0.1:${server.address().port}/servicebereich.html`, { waitUntil: "domcontentloaded" });
    const button = page.getByRole("button", { name: "Projektionen neu laden", exact: true });
    await button.waitFor({ state: "visible" });
    await page.locator("#service-state-badge").filter({ hasText: "Letzter gültiger Stand" }).waitFor();

    await button.click();
    await page.evaluate(() => window.__resolveServiceRefresh());
    await page.locator("#service-feedback").filter({ hasText: "erfolgreich neu geladen" }).waitFor();
    assert.equal(await page.locator("#service-failure").isHidden(), true);
    assert.equal(await page.locator("#service-state-badge").textContent(), "Bereit");
    assert.equal(await page.evaluate(() => window.__serviceRefreshCount()), 1);

    await button.click();
    await page.evaluate(() => window.__rejectServiceRefresh());
    await page.locator("#service-feedback").filter({ hasText: "refresh-failure-1" }).waitFor();
    assert.equal(await button.isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__serviceRefreshCount()), 2);
    assert.equal(await page.evaluate(() => window.__serviceDiagnostics.at(-1).event), "projection_refresh_failed");

    await page.evaluate(() => window.__setServiceStatusFailure(true));
    await button.click();
    await page.evaluate(() => window.__resolveServiceRefresh());
    await page.locator("#service-feedback").filter({ hasText: "Datenstatus konnte nicht abgefragt" }).waitFor();
    assert.equal(await page.locator("#service-feedback").getAttribute("data-state"), "error");
    assert.equal(await page.evaluate(() => window.__serviceDiagnostics.at(-1).event), "projection_status_load_failed");
    assert.equal(await page.evaluate(() => window.__serviceRefreshCount()), 3);

    await page.evaluate(() => {
      window.__setServiceStatusFailure(false);
      window.__setServiceStatus({ inProgress: { startedAt: Date.now() } });
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await page.locator("#service-progress").waitFor({ state: "visible" });
    assert.equal(await button.isDisabled(), true);
    await page.evaluate(() => window.__setServiceStatus({ inProgress: null }));
    await page.locator("#service-progress").waitFor({ state: "hidden" });
    assert.equal(await button.isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__serviceRefreshCount()), 3);
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
