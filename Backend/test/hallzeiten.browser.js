const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { hasSelectedProfile, launchSelectedBrowser, newProfilePage } = require("./browserProfiles.js");

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const FRONTEND_ROOT = path.resolve(__dirname, "../../Frontend");
const authStub = `
const admin = (location.pathname.includes("Verwalten") || location.pathname.includes("Drucken")) && !new URLSearchParams(location.search).has("asPlayer");
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
  participants: [
    [1, "Anna", "Huber"], [2, "Berta", "Bauer"], [3, "Anton", "Aigner"], [4, "Eva", "Eder"],
    [5, "Fritz", "Fink"], [6, "Gabi", "Gruber"], [7, "Hanna", "Haas"], [8, "Hugo", "Hofer"],
    [9, "Lisa", "Leitner"], [10, "Maria", "Maier"], [11, "Paul", "Pichler"], [12, "Rita", "Reiter"],
    [13, "Stefan", "Steiner"], [14, "Werner", "Wagner"],
  ].map(([number, firstName, lastName]) => ({ id: "p" + number, firstName, lastName, name: lastName + " " + firstName })),
  slots: [
    { id: "slot-old-1", date: "2025-10-16", start: "19:00", end: "21:00" },
    { id: "slot-old-2", date: "2025-10-23", start: "19:00", end: "21:00" },
    { id: "slot-1", date: "2099-10-30", start: "19:00", end: "21:00" },
    { id: "slot-2", date: "2099-11-06", start: "19:00", end: "21:00" },
    { id: "slot-3", date: "2099-11-13", start: "19:00", end: "21:00" },
    { id: "slot-4", date: "2099-11-20", start: "19:00", end: "21:00" },
    { id: "slot-5", date: "2099-11-27", start: "19:00", end: "21:00" },
    { id: "slot-6", date: "2099-12-04", start: "19:00", end: "21:00" },
    { id: "slot-7", date: "2099-12-11", start: "19:00", end: "21:00" },
  ],
  entries: [{ slotId: "slot-1", personId: "p1", status: "confirmed" }, { slotId: "slot-1", personId: "p2", status: "waitlist", waitlistPosition: 1 }],
};
let adminGrids = [];
let lastSave = null;
let lastBooking = null;
let distributionCount = 0;
let statusClearCount = 0;
const history = [{ id: "h1", at: Date.now(), action: "booking_added", actorName: "Spieler Eins", personName: "Spieler Eins", slotId: "slot-1", slot: grid.slots[0] }];
export function createEndpoint(name) { return async (params = {}) => {
  if (name === "hallTimeGrid" && new URLSearchParams(location.search).has("failWithReference")) throw new Error("Raster konnte nicht geladen werden. (Referenz: intern-123)");
  if (name === "hallTimeGrid") { const params = new URLSearchParams(location.search); return { data: { success: true, grid: structuredClone({ ...grid, slots: params.has("evenSlots") ? grid.slots.slice(0, 8) : grid.slots, waitlistEnabled: !params.has("withoutWaitlist"), currentPersonId: params.has("withoutParticipant") ? "admin-1" : grid.currentPersonId, canAdminister: location.pathname.includes("Drucken") }) } }; }
  if (name === "hallTimeHistory") return { data: { success: true, entries: structuredClone(history) } };
  if (name === "setHallTimeBooking") {
    if (params.slotId === "slot-3") throw new Error("Termin ist bereits voll belegt. (Referenz: intern-voll-123)");
    if (params.slotId === "slot-4") throw new Error("Die Fair-Use-Grenze ist überschritten. (Referenz: intern-fair-456)");
    lastBooking = structuredClone(params);
    const targetId = params.personId || grid.currentPersonId;
    const target = grid.participants.find(({ id }) => id === targetId);
    grid.entries = grid.entries.filter((entry) => !(entry.slotId === params.slotId && entry.personId === targetId));
    if (params.selected) grid.entries.push({ slotId: params.slotId, personId: targetId, status: "confirmed" });
    history.unshift({ id: "h" + revision, at: Date.now(), action: params.selected ? "booking_added" : "booking_removed", actorName: "Spieler Eins", personName: target?.name || targetId, slotId: params.slotId, slot: grid.slots.find(({ id }) => id === params.slotId) });
    revision += 1; grid.revision = revision;
    return { data: { success: true, grid: structuredClone(grid), revision } };
  }
  if (name === "adminHallTimeGrids") return { data: { success: true, grids: structuredClone(adminGrids), revision } };
  if (name === "memberDirectory") return { data: { success: true, values: [["ID", "Vorname", "Nachname", "Aktiv"], ["p1", "Spieler", "Eins", "1"], ["p2", "Spieler", "Zwei", "1"]] } };
  if (name === "adminSaveHallTimeGrid") { lastSave = structuredClone(params); revision += 1; const saved = { ...params, id: "grid-new", participants: params.participantIds.map((id) => ({ id, name: id })), entries: [], history: [], createdAt: 1, updatedAt: 1 }; delete saved.operationId; delete saved.expectedRevision; delete saved.gridId; delete saved.participantIds; adminGrids = [saved]; return { data: { success: true, grid: structuredClone(saved), revision } }; }
  if (name === "adminDistributeHallTimeGrid") { distributionCount += 1; adminGrids[0].entries = adminGrids[0].slots.map((slot) => ({ slotId: slot.id || slot.date, personId: "p1", status: "confirmed" })); revision += 1; return { data: { success: true, revision } }; }
  if (name === "adminClearAllHallTimeStatuses") { statusClearCount += 1; const deletedEntryCount = adminGrids[0]?.entries?.length || 0; adminGrids[0].entries = []; revision += 1; return { data: { success: true, grid: structuredClone(adminGrids[0]), deletedEntryCount, revision } }; }
  throw new Error("unexpected endpoint " + name);
}; }
export const getOperationId = () => "00000000-0000-4000-8000-000000000001";
export const releaseOperationId = () => {};
export const subscribe = () => () => {};
window.__lastHallTimeSave = () => lastSave;
window.__lastHallTimeBooking = () => lastBooking;
window.__hallTimeDistributionCount = () => distributionCount;
window.__hallTimeStatusClearCount = () => statusClearCount;
`;

function type(filename) { if (filename.endsWith(".html")) return "text/html; charset=utf-8"; if (filename.endsWith(".css")) return "text/css; charset=utf-8"; return "text/javascript; charset=utf-8"; }
function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (["/JS/hallzeiten.js", "/JS/hallzeitenVerwalten.js", "/JS/hallzeitenDrucken.js"].includes(pathname)) {
      const source = fs.readFileSync(path.join(FRONTEND_ROOT, pathname), "utf8")
        .replace('"./authClient.js"', '"/test/authClient.js"').replace('"./dataClient.js"', '"/test/dataClient.js"')
        .replace('"./diagnostics.js"', '"/test/diagnostics.js"').replace('"./favorites.js"', '"/test/favorites.js"');
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }); response.end(source); return;
    }
    if (pathname === "/test/authClient.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(authStub); return; }
    if (pathname === "/test/dataClient.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(dataClientStub); return; }
    if (pathname === "/test/diagnostics.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(diagnosticsStub); return; }
    if (pathname === "/test/favorites.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(favoritesStub); return; }
    if (["/JS/navbar.js", "/JS/modals.js", "/JS/favorites.js"].includes(pathname)) { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(); return; }
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
    assert.equal(await page.locator(".hall-time-heading #hall-time-description").count(), 0);
    assert.equal(await page.locator("#hall-time-info-dialog").evaluate((dialog) => dialog.open), false);
    assert.equal(await page.locator("#hall-time-rules").count(), 0);
    const headingLayout = await page.locator(".hall-time-heading").evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      viewportWidth: innerWidth,
      borderRadius: getComputedStyle(element).borderRadius,
      textAlign: getComputedStyle(element).textAlign,
      backgroundColor: getComputedStyle(element).backgroundColor,
      height: element.getBoundingClientRect().height,
    }));
    assert.ok(headingLayout.width <= headingLayout.viewportWidth);
    assert.notEqual(headingLayout.borderRadius, "0px");
    assert.equal(headingLayout.textAlign, "center");
    assert.notEqual(headingLayout.backgroundColor, "rgba(0, 0, 0, 0)");
    const titleLayout = await page.evaluate(() => {
      const row = document.querySelector(".hall-time-heading .favorite-title-row");
      const star = document.createElement("button");
      star.className = "favorite-star";
      star.type = "button";
      row.appendChild(star);
      const heading = document.querySelector(".hall-time-heading").getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const title = document.getElementById("hall-time-title").getBoundingClientRect();
      const starRect = star.getBoundingClientRect();
      const info = document.getElementById("hall-time-info-open").getBoundingClientRect();
      const controls = document.querySelector(".hall-time-view-controls").getBoundingClientRect();
      const controlButtons = [...document.querySelectorAll(".hall-time-view-controls button")].map((button) => button.getBoundingClientRect());
      const tableCard = document.querySelector(".hall-time-table-card").getBoundingClientRect();
      return {
        headingCenter: heading.left + heading.width / 2,
        titleCenter: title.left + title.width / 2,
        starRightInset: heading.right - starRect.right,
        infoLeftInset: info.left - heading.left,
        infoLeft: info.left,
        infoRight: info.right,
        titleLeft: title.left,
        rowHeight: rowRect.height,
        controlsGap: controls.top - heading.bottom,
        tableGap: tableCard.top - controls.bottom,
        controlWidths: controlButtons.map(({ width }) => width),
        controlHeights: controlButtons.map(({ height }) => height),
      };
    });
    assert.ok(Math.abs(titleLayout.headingCenter - titleLayout.titleCenter) < 1, JSON.stringify(titleLayout));
    assert.ok(Math.abs(titleLayout.starRightInset - titleLayout.infoLeftInset) < 3, JSON.stringify(titleLayout));
    assert.ok(headingLayout.height <= 45, JSON.stringify(headingLayout));
    assert.ok(titleLayout.infoLeft >= 0 && titleLayout.infoRight < titleLayout.titleLeft, JSON.stringify(titleLayout));
    assert.ok(titleLayout.controlsGap <= 4 && titleLayout.tableGap <= 4, JSON.stringify(titleLayout));
    assert.ok(Math.abs(titleLayout.controlWidths[0] - titleLayout.controlWidths[1]) < 1, JSON.stringify(titleLayout));
    assert.ok(titleLayout.controlHeights.every((height) => Math.abs(height - headingLayout.height) < 1), JSON.stringify({ headingLayout, titleLayout }));
    await page.getByRole("button", { name: "Informationen zum Raster" }).click({ timeout: 5000 });
    await page.locator("#hall-time-info-dialog[open]").waitFor({ timeout: 5000 });
    assert.equal(await page.locator("#hall-time-info-dialog").evaluate((dialog) => dialog.open), true);
    assert.equal(await page.locator("#hall-time-info-dialog h1, #hall-time-info-dialog h2").count(), 0);
    assert.equal(await page.locator("#hall-time-description img").count(), 0);
    assert.match(await page.locator("#hall-time-description").textContent(), /<img/);
    await page.getByRole("button", { name: "Informationen schließen" }).click({ timeout: 5000 });
    assert.equal(await page.locator("#hall-time-info-dialog").evaluate((dialog) => dialog.open), false);
    assert.equal(await page.locator("#hall-time-head .hall-time-player").textContent(), "");
    assert.deepEqual(await page.locator("#hall-time-head th").nth(3).locator("span, strong, small").allTextContents(), ["Fr.", "30.10.", "19:00", "–", "21:00"]);
    await page.waitForFunction(() => {
      const scroll = document.querySelector(".hall-time-table-scroll");
      return scroll.dataset.initialPositioned === "true" && scroll.scrollLeft > 0 && scroll.scrollTop > 0;
    });
    const initialPosition = await page.evaluate(() => {
      const scroll = document.querySelector(".hall-time-table-scroll");
      const playerHead = document.querySelector("#hall-time-head .hall-time-player").getBoundingClientRect();
      const upcoming = document.querySelector("#hall-time-head [data-upcoming-slot]").getBoundingClientRect();
      const header = document.querySelector("#hall-time-head th").getBoundingClientRect();
      const ownRow = document.querySelector('#hall-time-body [data-person-id="p1"]').getBoundingClientRect();
      return {
        upcomingOffset: upcoming.left - playerHead.right,
        ownOffset: (ownRow.top + ownRow.height / 2) - (header.bottom + (scroll.clientHeight - header.height) / 2),
        scrollTop: scroll.scrollTop,
        maxScrollTop: scroll.scrollHeight - scroll.clientHeight,
        ownTop: ownRow.top,
        ownHeight: ownRow.height,
        headerBottom: header.bottom,
        headerHeight: header.height,
        clientHeight: scroll.clientHeight,
        pastColumns: document.querySelectorAll("#hall-time-head .is-past-slot").length,
        pastOpacity: Number(getComputedStyle(document.querySelector("#hall-time-body td.is-past-slot .hall-time-state")).opacity),
      };
    });
    assert.ok(Math.abs(initialPosition.upcomingOffset) < 1, JSON.stringify(initialPosition));
    assert.ok(Math.abs(initialPosition.ownOffset) < 2, JSON.stringify(initialPosition));
    assert.equal(initialPosition.pastColumns, 2);
    assert.ok(initialPosition.pastOpacity < 1);
    assert.equal(await page.locator("#hall-time-view-all").getAttribute("aria-pressed"), "true");
    const initialViewButtons = await page.locator(".hall-time-view-controls button").evaluateAll((buttons) => buttons.map((button) => ({ background: getComputedStyle(button).backgroundColor, border: getComputedStyle(button).borderColor, color: getComputedStyle(button).color })));
    assert.equal(initialViewButtons[0].background, initialViewButtons[1].background);
    assert.equal(initialViewButtons[0].border, "rgb(22, 117, 209)");
    assert.notEqual(initialViewButtons[0].color, initialViewButtons[1].color);
    assert.equal(await page.locator('#hall-time-head [data-slot-id="slot-1"]').evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(231, 241, 251)");
    await page.getByRole("button", { name: "Aktuell", exact: true }).click({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll("#hall-time-body tr:not([hidden])").length === 2);
    const currentView = await page.evaluate(() => {
      const player = document.querySelector("#hall-time-head .hall-time-player").getBoundingClientRect();
      const selected = document.querySelector('#hall-time-head [data-slot-id="slot-1"]').getBoundingClientRect();
      return { selectedOffset: selected.left - player.right, selectedCells: document.querySelectorAll('.is-selected-slot').length };
    });
    assert.ok(Math.abs(currentView.selectedOffset) < 1, JSON.stringify(currentView));
    assert.equal(currentView.selectedCells, 16);
    assert.equal(await page.locator("#hall-time-view-current").getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Alle", exact: true }).click({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll("#hall-time-body tr:not([hidden])").length === 14);
    await page.waitForTimeout(200);
    const centeredOwnRow = await page.evaluate(() => {
      const scroll = document.querySelector(".hall-time-table-scroll");
      const row = document.querySelector('#hall-time-body [data-person-id="p1"]').getBoundingClientRect();
      const head = document.querySelector("#hall-time-head th").getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      const desiredCenter = head.bottom + Math.max(0, scrollRect.bottom - head.bottom) / 2;
      return { offset: row.top + row.height / 2 - desiredCenter, scrollTop: scroll.scrollTop, maxScrollTop: scroll.scrollHeight - scroll.clientHeight, rowTop: row.top, rowHeight: row.height, headBottom: head.bottom, scrollBottom: scrollRect.bottom };
    });
    assert.ok(Math.abs(centeredOwnRow.offset) < 2 || Math.abs(centeredOwnRow.scrollTop - centeredOwnRow.maxScrollTop) < 1, JSON.stringify(centeredOwnRow));
    assert.ok(Math.abs(centeredOwnRow.offset) <= centeredOwnRow.rowHeight / 2, JSON.stringify(centeredOwnRow));
    const scrollLayout = await page.evaluate(() => {
      const scroll = document.querySelector(".hall-time-table-scroll");
      scroll.scrollLeft = 0;
      scroll.scrollTop = 0;
      const player = document.querySelector("#hall-time-body .hall-time-player");
      const date = document.querySelector("#hall-time-body td");
      const header = document.querySelector("#hall-time-head th:nth-child(2)");
      const firstRow = document.querySelector("#hall-time-body tr");
      const footer = document.querySelector("#hall-time-foot td");
      const sum = document.querySelector("#hall-time-body .hall-time-sum");
      const before = { player: player.getBoundingClientRect().left, playerWidth: player.getBoundingClientRect().width, date: date.getBoundingClientRect().left, sum: sum.getBoundingClientRect().left, header: header.getBoundingClientRect().top, footer: footer.getBoundingClientRect().bottom, row: firstRow.getBoundingClientRect().top };
      scroll.scrollLeft = 120;
      scroll.scrollTop = 120;
      const after = { player: player.getBoundingClientRect().left, date: date.getBoundingClientRect().left, sum: sum.getBoundingClientRect().left, header: header.getBoundingClientRect().top, footer: footer.getBoundingClientRect().bottom, row: firstRow.getBoundingClientRect().top };
      return { before, after, horizontalOverflow: scroll.scrollWidth > scroll.clientWidth, verticalOverflow: scroll.scrollHeight > scroll.clientHeight };
    });
    assert.equal(scrollLayout.horizontalOverflow, true);
    assert.equal(scrollLayout.verticalOverflow, true);
    assert.ok(Math.abs(scrollLayout.before.playerWidth - 80) < 1, JSON.stringify(scrollLayout));
    assert.ok(Math.abs(scrollLayout.after.player - scrollLayout.before.player) < 1);
    assert.ok(scrollLayout.after.date < scrollLayout.before.date);
    assert.ok(scrollLayout.after.sum < scrollLayout.before.sum);
    assert.ok(Math.abs(scrollLayout.after.header - scrollLayout.before.header) < 1);
    assert.ok(Math.abs(scrollLayout.after.footer - scrollLayout.before.footer) < 1, JSON.stringify(scrollLayout));
    assert.ok(scrollLayout.after.row < scrollLayout.before.row);
    const ownNameStyle = await page.locator('#hall-time-body [data-person-id="p1"] .hall-time-player').evaluate((element) => ({
      backgroundColor: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
      fontWeight: getComputedStyle(element).fontWeight,
      boxShadow: getComputedStyle(element).boxShadow,
    }));
    assert.equal(ownNameStyle.backgroundColor, "rgb(231, 241, 251)");
    assert.equal(Number(ownNameStyle.fontWeight) >= 700, true);
    assert.equal(ownNameStyle.color, "rgb(33, 79, 125)");
    assert.equal(ownNameStyle.boxShadow, "none");
    assert.equal(await page.locator('#hall-time-body [data-person-id="p1"] td').first().evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(231, 241, 251)");
    assert.equal(await page.locator("#hall-time-foot .hall-time-player").textContent(), "");
    const viewportFill = await page.evaluate(() => {
      const card = document.querySelector(".hall-time-table-card").getBoundingClientRect();
      const legend = document.querySelector(".hall-time-legend").getBoundingClientRect();
      const history = document.querySelector(".hall-time-history").getBoundingClientRect();
      return { cardBottom: card.bottom, legendBottom: legend.bottom, historyTop: history.top, viewportBottom: innerHeight };
    });
    assert.ok(viewportFill.cardBottom <= viewportFill.viewportBottom, JSON.stringify(viewportFill));
    assert.ok(viewportFill.viewportBottom - viewportFill.cardBottom <= 10, JSON.stringify(viewportFill));
    assert.ok(viewportFill.legendBottom <= viewportFill.viewportBottom);
    assert.ok(viewportFill.historyTop > viewportFill.viewportBottom);
    const stableViewportHeight = await page.evaluate(async () => {
      const scroll = document.querySelector(".hall-time-table-scroll");
      const before = parseFloat(scroll.style.maxHeight);
      window.scrollTo(0, 240);
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = parseFloat(scroll.style.maxHeight);
      const pageScroll = window.scrollY;
      window.scrollTo(0, 0);
      return { before, after, pageScroll };
    });
    assert.ok(stableViewportHeight.pageScroll > 0);
    assert.ok(Math.abs(stableViewportHeight.after - stableViewportHeight.before) < 1, JSON.stringify(stableViewportHeight));
    assert.deepEqual(await page.locator(".hall-time-legend span").allTextContents(), ["✓ Dabei", "⌛ Warteliste", "× nicht Dabei"]);
    const legendRows = await page.locator(".hall-time-legend span").evaluateAll((items) => new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size);
    assert.equal(legendRows, 1);
    assert.equal(await page.locator("#hall-time-foot td").nth(2).textContent(), "1/1 (1)");
    assert.deepEqual(await page.locator("#hall-time-body .hall-time-player").first().locator(".hall-time-person-name > span").allTextContents(), ["Aigner", "Anton"]);
    assert.equal(await page.locator("#hall-time-body .hall-time-player").first().locator(".hall-time-person-name > span").evaluateAll((lines) => lines.every((line) => getComputedStyle(line).whiteSpace === "nowrap")), true);
    const foreignButton = page.getByRole("button", { name: /Leitner Lisa.*06\.11.*anmelden/ });
    await foreignButton.scrollIntoViewIfNeeded();
    const foreignRowTop = await page.locator('#hall-time-body [data-person-id="p9"]').evaluate((row) => row.getBoundingClientRect().top);
    await foreignButton.click({ timeout: 5000 });
    assert.equal((await page.evaluate(() => window.__lastHallTimeBooking())).personId, "p9");
    assert.equal(await page.locator("#hall-time-history-list li").first().locator(".competition-history-entry-title").textContent(), "Spieler Eins hat Leitner Lisa angemeldet");
    assert.match(await page.locator("#hall-time-history-list li").first().locator("time").textContent(), /^Geändert am: .+$/);
    assert.equal(await page.locator("#hall-time-history-list li").first().locator(".competition-history-slot").textContent(), "Freitag, 06.11.2099, 19:00–21:00");
    assert.equal(await page.locator("#hall-time-history-list li").first().locator(".competition-history-slot").evaluate((element) => Number(getComputedStyle(element).fontWeight) < 700), true);
    const foreignRowTopAfter = await page.locator('#hall-time-body [data-person-id="p9"]').evaluate((row) => row.getBoundingClientRect().top);
    assert.ok(Math.abs(foreignRowTopAfter - foreignRowTop) < 1, `${foreignRowTop} -> ${foreignRowTopAfter}`);
    await page.locator('#hall-time-head [data-slot-id="slot-2"] .hall-time-slot-select').click({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll("#hall-time-body tr:not([hidden])").length === 1);
    assert.equal(await page.locator('#hall-time-head [data-slot-id="slot-2"]').evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(231, 241, 251)");
    assert.equal(await page.locator('#hall-time-body tr:not([hidden])').getAttribute("data-person-id"), "p9");
    assert.equal(await page.locator("#hall-time-view-all").getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("#hall-time-view-current").getAttribute("aria-pressed"), "false");
    await page.getByRole("button", { name: "Leitner Lisa auswählen" }).click({ timeout: 5000 });
    assert.equal(await page.locator('#hall-time-head [data-slot-id]:visible').count(), 1);
    assert.equal(await page.locator('#hall-time-head [data-slot-id]:visible').getAttribute("data-slot-id"), "slot-2");
    assert.equal(await page.locator('#hall-time-body tr:not([hidden])').count(), 14);
    const selectedPersonStyle = await page.locator('#hall-time-body [data-person-id="p9"]').evaluate((row) => ({ name: getComputedStyle(row.querySelector(".hall-time-player")).backgroundColor, cell: getComputedStyle(row.querySelector("td:not([hidden])")).backgroundColor }));
    assert.deepEqual(selectedPersonStyle, { name: "rgb(231, 241, 251)", cell: "rgb(231, 241, 251)" });
    assert.equal(await page.locator('#hall-time-body [data-person-id="p1"]').evaluate((row) => row.classList.contains("is-current-player")), false);
    assert.notEqual(await page.locator('#hall-time-body [data-person-id="p1"] .hall-time-player').evaluate((cell) => getComputedStyle(cell).color), "rgb(33, 79, 125)");
    assert.equal(await page.locator("#hall-time-view-all").getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("#hall-time-view-current").getAttribute("aria-pressed"), "false");
    await page.getByRole("button", { name: "Alle", exact: true }).click({ timeout: 5000 });
    assert.equal(await page.locator('#hall-time-head [data-slot-id]:visible').count(), 9);
    assert.equal(await page.locator('#hall-time-body .is-selected-player').count(), 0);
    assert.equal(await page.locator('#hall-time-body [data-person-id="p1"] .hall-time-player').evaluate((cell) => getComputedStyle(cell).color), "rgb(33, 79, 125)");
    assert.equal(await page.locator('#hall-time-body [data-person-id="p1"] td').first().evaluate((cell) => getComputedStyle(cell).backgroundColor), "rgb(231, 241, 251)");
    await page.locator('#hall-time-head [data-slot-id="slot-2"] .hall-time-slot-select').click({ timeout: 5000 });
    await page.locator('#hall-time-head [data-slot-id="slot-1"] .hall-time-slot-select').click({ timeout: 5000 });
    assert.equal(await page.locator("#hall-time-view-current").getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Aktuell", exact: true }).click({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll("#hall-time-body tr:not([hidden])").length === 2);
    assert.equal(await page.locator('#hall-time-head .is-selected-slot').getAttribute("data-slot-id"), "slot-1");
    await page.getByRole("button", { name: "Alle", exact: true }).click({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll("#hall-time-body tr:not([hidden])").length === 14);
    await page.getByRole("button", { name: /Aigner Anton.*13\.11\.2099.*anmelden/ }).click({ timeout: 5000 });
    await page.locator("#hall-time-message-dialog[open]").waitFor({ timeout: 5000 });
    assert.equal(await page.locator("#hall-time-message-text").textContent(), "Termin ist bereits voll belegt.");
    assert.equal(await page.locator("#hall-time-feedback").textContent(), "");
    assert.equal(await page.locator("#hall-time-message-dialog").evaluate((dialog) => dialog.matches(":modal")), true);
    assert.equal(await page.locator("#hall-time-message-text").evaluate((element) => getComputedStyle(element).textAlign), "center");
    await page.waitForTimeout(100);
    assert.equal(await page.locator("#hall-time-message-dialog").evaluate((dialog) => dialog.open), true);
    await page.getByRole("button", { name: "Meldung schließen" }).click({ timeout: 5000 });
    await page.getByRole("button", { name: /Aigner Anton.*20\.11\.2099.*anmelden/ }).click({ timeout: 5000 });
    await page.locator("#hall-time-message-dialog[open]").waitFor({ timeout: 5000 });
    assert.equal(await page.locator("#hall-time-message-text").textContent(), "Die Fair-Use-Grenze ist überschritten.");
    assert.equal((await page.locator("body").textContent()).includes("intern-fair-456"), false);
    await page.getByRole("button", { name: "Meldung schließen" }).click({ timeout: 5000 });
    await page.locator("#clock").waitFor({ timeout: 5000 });
    assert.match(await page.locator("#clock").textContent(), /^\d{4}\.\d{2}\.\d{2} – \d{2}:\d{2}$/);
    const compactLayout = await page.evaluate(async () => {
      const body = document.getElementById("hall-time-body");
      [...body.children].slice(2).forEach((row) => row.remove());
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const table = document.getElementById("hall-time-table").getBoundingClientRect();
      const scroll = document.querySelector(".hall-time-table-scroll").getBoundingClientRect();
      const legend = document.querySelector(".hall-time-legend").getBoundingClientRect();
      return { tableBottom: table.bottom, scrollBottom: scroll.bottom, legendTop: legend.top, viewportBottom: innerHeight };
    });
    assert.ok(Math.abs(compactLayout.scrollBottom - compactLayout.tableBottom) < 1, JSON.stringify(compactLayout));
    assert.ok(compactLayout.legendTop - compactLayout.tableBottom < 14, JSON.stringify(compactLayout));
    assert.ok(compactLayout.legendTop < compactLayout.viewportBottom);
    await page.goto(`http://127.0.0.1:${server.address().port}/hallzeiten.html?id=grid-1&withoutWaitlist=1`);
    await page.getByRole("heading", { name: "Donnerstag Doppel" }).waitFor({ timeout: 5000 });
    assert.equal(await page.locator(".hall-time-legend .is-waitlist").isHidden(), true);
    assert.deepEqual(await page.locator(".hall-time-legend span:visible").allTextContents(), ["✓ Dabei", "× nicht Dabei"]);
    await page.goto(`http://127.0.0.1:${server.address().port}/hallzeiten.html?id=grid-1&failWithReference=1`);
    await page.getByText("Raster konnte nicht geladen werden.", { exact: true }).waitFor({ timeout: 5000 });
    assert.equal((await page.locator("body").textContent()).includes("intern-123"), false);
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
    await page.getByLabel("Wartelisteneinträge pro Person").fill("3");
    await page.getByLabel("Öffentlich beitretbar").check();
    assert.deepEqual(await page.locator("#hall-time-players label").allTextContents(), ["Eins Spieler", "Zwei Spieler"]);
    await page.getByText("Eins Spieler", { exact: true }).click();
    await page.locator("#hall-time-slot-date").fill("2099-10-30");
    await page.getByLabel("Folgetermine").fill("2");
    await page.getByRole("button", { name: "Terminserie übernehmen" }).click();
    await page.getByText("3 Termine übernommen.").waitFor();
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await page.getByText("Raster wurde gespeichert.").waitFor();
    const saved = await page.evaluate(() => window.__lastHallTimeSave());
    assert.equal(saved.name, "Winter Donnerstag"); assert.deepEqual(saved.participantIds, ["p1"]);
    assert.equal(saved.maxWaitlistEntries, 3); assert.equal(saved.publicJoinable, true);
    assert.deepEqual(saved.slots.map(({ date }) => date), ["2099-10-30", "2099-11-06", "2099-11-13"]);
    assert.match(await page.locator("#hall-time-print-mine").getAttribute("href"), /hallzeitenDrucken\.html\?id=grid-new&ansicht=mine$/);
    assert.match(await page.locator("#hall-time-print-all").getAttribute("href"), /hallzeitenDrucken\.html\?id=grid-new&ansicht=all$/);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLayout = await page.locator("#hall-time-form").evaluate((form) => ({
      formRight: form.getBoundingClientRect().right,
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(mobileLayout.formRight <= mobileLayout.viewportWidth + 1, JSON.stringify(mobileLayout));
    assert.equal(mobileLayout.documentWidth, mobileLayout.viewportWidth);
    await page.getByRole("button", { name: "Gleichberechtigt verteilen" }).click({ timeout: 5000 });
    await page.getByRole("heading", { name: "Bestehende Einteilung ersetzen?" }).waitFor({ timeout: 5000 });
    const dialogLayout = await page.locator("#hall-time-distribute-dialog").evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      const close = dialog.querySelector(".hall-time-dialog-close").getBoundingClientRect();
      const viewportLeft = visualViewport?.offsetLeft || 0;
      const viewportWidth = visualViewport?.width || innerWidth;
      return { centerOffset: Math.abs((rect.left + rect.width / 2) - viewportWidth / 2), rectLeft: rect.left, rectWidth: rect.width, innerWidth, viewportLeft, viewportWidth, textAlign: getComputedStyle(dialog.querySelector("p")).textAlign, closeRight: rect.right - close.right, closeTop: close.top - rect.top };
    });
    assert.ok(dialogLayout.centerOffset < 2, JSON.stringify(dialogLayout));
    assert.equal(dialogLayout.textAlign, "center");
    assert.ok(dialogLayout.closeRight < 24 && dialogLayout.closeTop < 24, JSON.stringify(dialogLayout));
    await page.getByRole("button", { name: "Neu verteilen" }).click({ timeout: 5000 });
    await page.getByText("Zukünftige Termine wurden neu verteilt.").waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__hallTimeDistributionCount()), 1);
    await page.getByRole("button", { name: "Alle Stati auf Termin löschen", exact: true }).click({ timeout: 5000 });
    await page.getByRole("heading", { name: "Alle Stati auf den Terminen löschen?" }).waitFor({ timeout: 5000 });
    await page.locator("#hall-time-clear-statuses-dialog").getByRole("button", { name: "Alle Stati auf Termin löschen" }).click({ timeout: 5000 });
    await page.getByText("3 Stati wurden gelöscht.").waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__hallTimeStatusClearCount()), 1);
    assert.equal(await page.locator("#hall-time-slots .hall-time-slot-row").count(), 3);
    await page.close();
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});

test("Hallenzeiten-Druckansichten zeigen dem Admin den eigenen oder gesamten sichtbaren Raster", { skip: !hasSelectedProfile() && !fs.existsSync(CHROMIUM_PATH), timeout: 30000 }, async () => {
  const server = await startServer(); const browser = await launchSelectedBrowser(CHROMIUM_PATH);
  try {
    const page = await newProfilePage(browser, { viewport: { width: 1200, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/hallzeitenDrucken.html?id=grid-1&ansicht=mine`);
    await page.locator(".hall-time-print-table").first().waitFor({ timeout: 5000 });
    assert.equal(await page.locator("#hall-time-print-app h1, #hall-time-print-app h2, .print-help").count(), 0);
    assert.equal(await page.locator(".hall-time-print-page").count(), 2);
    assert.equal(await page.locator(".hall-time-print-table tbody tr").count(), 2);
    assert.deepEqual(await page.locator(".hall-time-print-table").first().locator("thead th").allTextContents(), ["Name", "16.10.25\n19-21", "23.10.25\n19-21", "30.10.99\n19-21", "6.11.99\n19-21", "13.11.99\n19-21"]);
    assert.equal(await page.locator(".hall-time-print-table tbody tr").first().locator("th").textContent(), "Huber Anna");
    assert.equal(await page.locator(".hall-time-print-table tfoot").count(), 0);
    assert.equal(await page.locator(".print-sum").count(), 0);
    const compactWidths = await page.locator(".hall-time-print-table").first().evaluate((table) => {
      const slots = [...table.querySelectorAll("thead .print-slot")].map((cell) => cell.getBoundingClientRect().width);
      const name = table.querySelector("tbody .print-name");
      const style = getComputedStyle(name);
      const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      return { distinctSlots: new Set(slots.map(Math.round)).size, slotWidth: slots[0], nameExtra: name.getBoundingClientRect().width - name.scrollWidth - horizontalPadding };
    });
    assert.equal(compactWidths.distinctSlots, 1);
    assert.ok(compactWidths.slotWidth < 55, JSON.stringify(compactWidths));
    assert.ok(compactWidths.nameExtra < 3, JSON.stringify(compactWidths));
    await page.goto(`http://127.0.0.1:${server.address().port}/hallzeitenDrucken.html?id=grid-1&ansicht=all`);
    await page.locator(".hall-time-print-table").first().waitFor({ timeout: 5000 });
    assert.equal(await page.locator(".hall-time-print-page").count(), 2);
    assert.equal(await page.locator(".hall-time-print-table tbody tr").count(), 28);
    assert.equal(await page.locator(".hall-time-print-table").first().locator("thead th").count(), 6);
    assert.equal(await page.locator(".hall-time-print-table").nth(1).locator("thead th").count(), 6);
    assert.equal(await page.locator(".hall-time-print-table").nth(1).locator("thead .print-slot").last().textContent(), "");
    assert.equal(await page.locator(".hall-time-print-table").nth(1).locator("tbody tr").first().locator(".print-empty-slot").count(), 1);
    const oddBlockWidths = await page.locator(".hall-time-print-table").evaluateAll((tables) => tables.map((table) => table.getBoundingClientRect().width));
    assert.ok(Math.abs(oddBlockWidths[0] - oddBlockWidths[1]) < 1, JSON.stringify(oddBlockWidths));
    const sharedColumnWidths = await page.locator(".hall-time-print-table").evaluateAll((tables) => tables.map((table) => [...table.querySelectorAll("thead th")].map((cell) => Math.round(cell.getBoundingClientRect().width))));
    assert.deepEqual(sharedColumnWidths[0], sharedColumnWidths[1]);
    assert.equal(await page.locator(".hall-time-print-table tbody tr").first().locator("th").textContent(), "Aigner Anton");
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator("#hall-time-print-app").evaluate((element) => getComputedStyle(element).display), "block");
    await page.goto(`http://127.0.0.1:${server.address().port}/hallzeitenDrucken.html?id=grid-1&ansicht=all&asPlayer=1`);
    await page.getByText("Diese Druckvorlagen sind ausschließlich für Administratoren verfügbar.").waitFor({ timeout: 5000 });
    assert.equal(await page.locator("#hall-time-print-app").isHidden(), true);
    await page.goto(`http://127.0.0.1:${server.address().port}/hallzeitenDrucken.html?id=grid-1&ansicht=mine&withoutParticipant=1`);
    await page.locator(".hall-time-print-table").first().waitFor({ timeout: 5000 });
    assert.equal(await page.locator(".hall-time-print-table tbody tr").first().locator("th").textContent(), "________________________");
    await page.goto(`http://127.0.0.1:${server.address().port}/hallzeitenDrucken.html?id=grid-1&ansicht=all&evenSlots=1`);
    await page.locator(".hall-time-print-table").first().waitFor({ timeout: 5000 });
    assert.equal(await page.locator(".print-empty-slot").count(), 0);
    const evenBlockWidths = await page.locator(".hall-time-print-table").evaluateAll((tables) => tables.map((table) => table.getBoundingClientRect().width));
    assert.ok(Math.abs(evenBlockWidths[0] - evenBlockWidths[1]) < 1, JSON.stringify(evenBlockWidths));
    await page.close();
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
