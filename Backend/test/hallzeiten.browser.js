const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { hasSelectedProfile, launchSelectedBrowser, newProfilePage } = require("./browserProfiles.js");

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const FRONTEND_ROOT = path.resolve(__dirname, "../../Frontend");
const authStub = `
const admin = location.pathname.includes("Verwalten");
const user = admin ? { id: "admin-1", name: "Admin", role: "admin" } : { id: "p1", name: "Spieler Eins", role: "player" };
export const ready = Promise.resolve(user);
export const getUser = () => user;
export const hasRole = (...roles) => roles.includes(user.role);
export function subscribeAuth(callback) { queueMicrotask(() => callback(user, { status: "authenticated" })); return () => {}; }
`;
const favoritesStub = "export function refreshFavoriteButtons() {}\n";
const diagnosticsStub = "export const diagnostic = { error() {} };\n";
const dataClientStub = `
let revision = 1;
let grid = {
  id: "grid-1", name: "Donnerstag Doppel", description: "Regel <img src=x onerror=alert(1)>", mode: "equal", capacity: 1,
  waitlistEnabled: true, fairUse: { base: 2, extendedDays: 7, percent: 50, openDays: 2 }, active: true,
  currentPersonId: "p1", canAdminister: false, revision: 1,
  participants: [{ id: "p1", name: "Spieler Eins" }, { id: "p2", name: "Spieler Zwei" }],
  slots: [{ id: "slot-1", date: "2099-10-30", start: "19:00", end: "21:00" }],
  entries: [{ slotId: "slot-1", personId: "p1", status: "confirmed" }, { slotId: "slot-1", personId: "p2", status: "waitlist", waitlistPosition: 1 }],
};
let adminGrids = [];
let lastSave = null;
let distributionCount = 0;
const history = [{ id: "h1", at: Date.now(), action: "booking_added", actorName: "Spieler Eins", personName: "Spieler Eins", slotId: "slot-1", slot: grid.slots[0] }];
export function createEndpoint(name) { return async (params = {}) => {
  if (name === "hallTimeGrid") return { data: { success: true, grid: structuredClone(grid) } };
  if (name === "hallTimeHistory") return { data: { success: true, entries: structuredClone(history) } };
  if (name === "setHallTimeBooking") {
    grid.entries = [{ slotId: "slot-1", personId: "p2", status: "confirmed" }]; revision += 1; grid.revision = revision;
    return { data: { success: true, grid: structuredClone(grid), revision } };
  }
  if (name === "adminHallTimeGrids") return { data: { success: true, grids: structuredClone(adminGrids), revision } };
  if (name === "memberDirectory") return { data: { success: true, values: [["ID", "Vorname", "Nachname", "Aktiv"], ["p1", "Spieler", "Eins", "1"], ["p2", "Spieler", "Zwei", "1"]] } };
  if (name === "adminSaveHallTimeGrid") { lastSave = structuredClone(params); revision += 1; const saved = { ...params, id: "grid-new", participants: params.participantIds.map((id) => ({ id, name: id })), entries: [], history: [], createdAt: 1, updatedAt: 1 }; delete saved.operationId; delete saved.expectedRevision; delete saved.gridId; delete saved.participantIds; adminGrids = [saved]; return { data: { success: true, grid: structuredClone(saved), revision } }; }
  if (name === "adminDistributeHallTimeGrid") { distributionCount += 1; revision += 1; return { data: { success: true, revision } }; }
  throw new Error("unexpected endpoint " + name);
}; }
export const getOperationId = () => "00000000-0000-4000-8000-000000000001";
export const releaseOperationId = () => {};
export const subscribe = () => () => {};
window.__lastHallTimeSave = () => lastSave;
window.__hallTimeDistributionCount = () => distributionCount;
`;

function type(filename) { if (filename.endsWith(".html")) return "text/html; charset=utf-8"; if (filename.endsWith(".css")) return "text/css; charset=utf-8"; return "text/javascript; charset=utf-8"; }
function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (["/JS/hallzeiten.js", "/JS/hallzeitenVerwalten.js"].includes(pathname)) {
      const source = fs.readFileSync(path.join(FRONTEND_ROOT, pathname), "utf8")
        .replace('"./authClient.js"', '"/test/authClient.js"').replace('"./dataClient.js"', '"/test/dataClient.js"')
        .replace('"./diagnostics.js"', '"/test/diagnostics.js"').replace('"./favorites.js"', '"/test/favorites.js"');
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }); response.end(source); return;
    }
    if (pathname === "/test/authClient.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(authStub); return; }
    if (pathname === "/test/dataClient.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(dataClientStub); return; }
    if (pathname === "/test/diagnostics.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(diagnosticsStub); return; }
    if (pathname === "/test/favorites.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(favoritesStub); return; }
    if (["/JS/navbar.js", "/JS/modals.js", "/JS/favorites.js", "/JS/global.js", "/JS/footer.js"].includes(pathname)) { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(); return; }
    const relative = pathname.replace(/^\/+/, "") || "hallzeiten.html";
    const filename = path.resolve(FRONTEND_ROOT, relative);
    if (!filename.startsWith(`${FRONTEND_ROOT}${path.sep}`) || !fs.existsSync(filename)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": type(filename) }); response.end(fs.readFileSync(filename));
  });
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server)); });
}

test("Hallenzeiten-Raster zeigt kompakte Summen, sichere Regeln und rueckt die Warteliste nach", { skip: !hasSelectedProfile() && !fs.existsSync(CHROMIUM_PATH), timeout: 30000 }, async () => {
  const server = await startServer(); const browser = await launchSelectedBrowser(CHROMIUM_PATH);
  try {
    const page = await newProfilePage(browser, { viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/hallzeiten.html?id=grid-1`);
    await page.getByRole("heading", { name: "Donnerstag Doppel" }).waitFor();
    assert.equal(await page.locator("#hall-time-description img").count(), 0);
    assert.match(await page.locator("#hall-time-description").textContent(), /<img/);
    assert.equal(await page.locator("#hall-time-foot td").first().textContent(), "1/1 (1)");
    await page.getByRole("button", { name: /Spieler Eins.*Fixplatz/ }).click();
    await page.getByRole("button", { name: /Spieler Zwei.*Fixplatz/ }).waitFor();
    assert.equal(await page.locator("#hall-time-body tr").nth(1).locator(".hall-time-sum").textContent(), "1");
    await page.close();
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});

test("Hallenzeiten-Verwaltung speichert Parameter und bestaetigt vollstaendiges Neuverteilen", { skip: !hasSelectedProfile() && !fs.existsSync(CHROMIUM_PATH), timeout: 30000 }, async () => {
  const server = await startServer(); const browser = await launchSelectedBrowser(CHROMIUM_PATH);
  try {
    const page = await newProfilePage(browser, { viewport: { width: 1024, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/hallzeitenVerwalten.html`);
    await page.getByLabel("Name").fill("Winter Donnerstag");
    await page.getByLabel("Modus").selectOption("equal");
    await page.getByText("Spieler Eins", { exact: true }).click();
    await page.locator("#hall-time-slot-date").fill("2099-10-30"); await page.getByRole("button", { name: "Termin hinzufügen" }).click();
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await page.getByText("Raster wurde gespeichert.").waitFor();
    const saved = await page.evaluate(() => window.__lastHallTimeSave());
    assert.equal(saved.name, "Winter Donnerstag"); assert.deepEqual(saved.participantIds, ["p1"]); assert.equal(saved.slots.length, 1);
    await page.getByRole("button", { name: "Gleichberechtigt verteilen" }).click();
    await page.getByRole("heading", { name: "Bestehende Einteilung ersetzen?" }).waitFor();
    await page.getByRole("button", { name: "Neu verteilen" }).click();
    await page.getByText("Zukünftige Termine wurden neu verteilt.").waitFor();
    assert.equal(await page.evaluate(() => window.__hallTimeDistributionCount()), 1);
    await page.close();
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
