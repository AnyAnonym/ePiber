const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright-core");

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const FRONTEND_ROOT = path.resolve(__dirname, "../../Frontend");
const BACKEND_ROOT = path.resolve(__dirname, "..");

const authStub = `
let user;
let status = "loading";
const listeners = new Set();
const params = new URLSearchParams(location.search);
const authenticatedUser = { id: "player-1", role: params.get("role") || "player", login: "player" };
function resolveAuth(resolve) {
  user = params.get("anonymous") === "1" ? null : authenticatedUser;
  status = user ? "authenticated" : "anonymous";
  for (const listener of listeners) listener(user, { status, error: null });
  resolve(user);
}
export const ready = new Promise((resolve) => {
  if (params.get("manualAuth") === "1") window.__resolveAuth = () => resolveAuth(resolve);
  else setTimeout(() => resolveAuth(resolve), Number(params.get("authDelay") || 0));
});
export function subscribeAuth(callback) {
  listeners.add(callback);
  callback(user, { status, error: null });
  return () => listeners.delete(callback);
}
window.__loseSession = () => {
  user = null;
  status = "anonymous";
  for (const listener of listeners) listener(user, { status, error: null });
};
`;

const dataClientStub = `
window.__historyCalls = [];
window.__bewerbeCalls = [];
window.__comments = [{ id: "comment-1", eventId: "history-1", authorName: "Ada", createdAt: "2026-08-02T11:00:00.000Z", updatedAt: null, status: "visible", body: "Sicherer Kommentar", placeholder: "", mine: true, canEdit: true, canDelete: true, canModerate: false }];
window.__commentInteraction = { reactionTotal: 1, reactions: [{ key: "thumbs_up", count: 1 }], myReaction: null };
window.__interaction = { commentCount: 1, reactionTotal: 3, reactions: [{ key: "thumbs_up", count: 2 }, { key: "surprised", count: 1 }], myReaction: null };
window.__commentWriteCalls = [];
window.__revision = 1;
window.__subscriptions = new Map();
window.__catalog = [
  { key: "thumbs_up", emoji: "👍", label: "Gefällt mir", order: 10, active: true },
  { key: "surprised", emoji: "😮", label: "Überrascht", order: 20, active: true },
  { key: "flexed_biceps", emoji: "💪", label: "Stark", order: 30, active: true },
];
export const subscribeInvalidations = () => () => {};
export const subscribe = (topic, callback) => {
  window.__subscriptions.set(topic, callback);
  return () => window.__subscriptions.delete(topic);
};
export const getOperationId = () => "00000000-0000-4000-8000-000000000001";
export const releaseOperationId = () => {};
export function createEndpoint(name) {
  return async (params = {}) => {
    if (name === "competitionHistoryComments") {
      const admin = new URLSearchParams(location.search).get("role") === "admin";
      if (new URLSearchParams(location.search).get("staleComments") === "1" && params.eventId === "history-1") await new Promise((resolve) => setTimeout(resolve, 300));
      const sourceComments = params.eventId === "history-2"
        ? [{ id: "other-comment", eventId: "history-2", authorName: "Berta", createdAt: "2026-08-01T11:00:00.000Z", updatedAt: null, status: "visible", body: "Anderer Bewerb", placeholder: "", mine: false, canEdit: false, canDelete: false, canModerate: false }]
        : window.__comments;
      return { data: { success: true, comments: sourceComments.map((comment) => ({
        ...comment,
        body: comment.status === "under_review" && !admin ? "" : comment.body,
        placeholder: comment.status === "under_review" && !admin ? "Kommentar wird geprüft." : "",
        canDelete: comment.mine || admin,
        canModerate: admin,
        canReact: comment.status !== "under_review" || admin,
        interaction: comment.status === "under_review" && !admin ? { reactionTotal: 0, reactions: [], myReaction: null } : window.__commentInteraction,
      })), nextCursor: null, revision: window.__revision } };
    }
    if (name === "competitionHistoryInteraction") return { data: { success: true, interaction: window.__interaction, revision: window.__revision } };
    if (name === "competitionHistoryCommentForEdit") return { data: { success: true, comment: { ...window.__comments.find(({ id }) => id === params.commentId) } } };
    if (name === "competitionHistoryReactions") return { data: { success: true, reactions: [{ key: "thumbs_up", userName: "Ada", createdAt: 1, mine: true }, { key: "thumbs_up", userName: "Berta", createdAt: 2, mine: false }, { key: "surprised", userName: "Chris", createdAt: 3, mine: false }] } };
    if (name === "competitionHistoryCommentReactions") return { data: { success: true, reactions: [{ key: "thumbs_up", userName: "Berta", createdAt: 1, mine: true }] } };
    if (name === "setCompetitionHistoryReaction") {
      window.__interaction = params.reactionKey === null
        ? { ...window.__interaction, reactionTotal: 2, reactions: [{ key: "thumbs_up", count: 1 }, { key: "surprised", count: 1 }], myReaction: null }
        : { ...window.__interaction, reactionTotal: 4, reactions: [...window.__interaction.reactions, { key: params.reactionKey, count: 1 }], myReaction: params.reactionKey };
      return { data: { success: true, eventId: params.eventId, interaction: window.__interaction } };
    }
    if (name === "setCompetitionHistoryCommentReaction") {
      window.__commentInteraction = params.reactionKey === null
        ? { reactionTotal: 0, reactions: [], myReaction: null }
        : { reactionTotal: 1, reactions: [{ key: params.reactionKey, count: 1 }], myReaction: params.reactionKey };
      return { data: { success: true, commentId: params.commentId, eventId: "history-1", interaction: window.__commentInteraction } };
    }
    if (name === "addCompetitionHistoryComment") {
      window.__commentWriteCalls.push(params.body);
      if (new URLSearchParams(location.search).get("uncertainWrite") === "1" && window.__commentWriteCalls.length === 1) throw Object.assign(new Error("unklar"), { code: "WRITE_OUTCOME_UNKNOWN" });
      const comment = { id: "comment-2", eventId: params.eventId, authorName: "Player", createdAt: Date.now(), updatedAt: null, status: "visible", body: params.body, placeholder: "", mine: true, canEdit: true, canDelete: true, canModerate: false };
      window.__comments = [...window.__comments, comment];
      window.__interaction = { ...window.__interaction, commentCount: window.__comments.length };
      return { data: { success: true, eventId: params.eventId, comment } };
    }
    if (name === "editCompetitionHistoryComment") return { data: { success: true, eventId: "history-1" } };
    if (name === "deleteCompetitionHistoryComment") return { data: { success: true, eventId: "history-1" } };
    if (name === "moderateCompetitionHistoryComment") {
      window.__comments = window.__comments.map((comment) => comment.id === params.commentId ? { ...comment, status: params.status } : comment);
      return { data: { success: true, eventId: "history-1", status: params.status } };
    }
    if (name === "bewerbsart") return { data: { success: true, values: [
      ["ID", "EntryListAvailable", "Bezeichnung", "RoundRobin"],
      ["2", "0", "Rangliste", "0"],
      ["3", "0", "KO", "0"],
    ] } };
    if (name === "competitionHistory") {
      window.__historyCalls.push({ ...params });
      if (new URLSearchParams(location.search).get("historyError") === "1") throw new Error("private failure");
      if (new URLSearchParams(location.search).get("historyEmpty") === "1") return { data: { success: true, events: [], nextCursor: null } };
      if (!params.bewerbId && params.cursor === "global-page-2") return { data: {
        success: true,
        history: [{ occurredAt: "2026-07-01T08:00:00.000Z", competitionName: "Wintercup", roundName: "Achtelfinale", summary: "Angelegt", actorName: "Test User" }],
        nextCursor: null,
      } };
      if (!params.bewerbId) return { data: {
        success: true,
        events: [
          { id: "history-1", occurredAt: "2026-08-02T10:00:00.000Z", competitionName: "Sommercup", roundName: "Viertelfinale", type: "ranking_challenge_deleted", summary: "Zweite Änderung", result: "6-3/6-4", actorName: "Neu Spieler", detail: "Grund: Doppelte Forderung", interaction: window.__interaction },
          { id: "history-2", occurredAt: "2026-08-01T09:00:00.000Z", competitionName: "Rangliste", summary: "Erste Änderung", actorName: "Alt Spieler", interaction: { commentCount: 1, reactionTotal: 0, reactions: [], myReaction: null } },
        ],
        nextCursor: "global-page-2", reactionCatalog: window.__catalog, revision: window.__revision,
      } };
      if (params.cursor === "page-2") return { data: {
        success: true,
        history: [{ occurredAt: "2026-07-01T08:00:00.000Z", roundName: "Achtelfinale", summary: "Angelegt", actorName: "Test User" }],
        nextCursor: null,
      } };
      return { data: {
        success: true,
        events: [
          { id: "history-1", occurredAt: "2026-08-02T10:00:00.000Z", roundName: "Viertelfinale", type: "ranking_challenge_deleted", summary: "Zweite Änderung", result: "6-3/6-4", actorName: "Neu Spieler", detail: "Grund: Doppelte Forderung", interaction: window.__interaction },
          { id: "history-2", occurredAt: "2026-08-01T09:00:00.000Z", roundName: "1. Gruppe", summary: "<img src=x onerror=alert(1)>", actorName: "Alt Spieler", detail: "Ebenfalls nicht anzeigen", interaction: { commentCount: 1, reactionTotal: 0, reactions: [], myReaction: null } },
        ],
        nextCursor: "page-2", reactionCatalog: window.__catalog, revision: window.__revision,
      } };
    }
    if (name === "bewerbe") {
      window.__bewerbeCalls.push({ ...params });
      if (new URLSearchParams(location.search).get("slowVisibilityRefresh") === "1" && window.__bewerbeCalls.length > 1) {
        return new Promise((resolve) => setTimeout(() => resolve({ data: { success: true, values: [
          ["ID", "BewerbsartID", "Bezeichnung", "EntryStart", "EntryDeadline", "Bewerbsbeginn", "Bewerbsende", "SortOrder"],
          ["2", "2", "Rangliste <img src=x onerror=alert(1)>", "", "", "20250101", "", "1"],
          ["3", "3", "Sommercup", "", "", "20250101", "", "2"],
        ] } }), 500));
      }
      return { data: { success: true, values: [
        ["ID", "BewerbsartID", "Bezeichnung", "EntryStart", "EntryDeadline", "Bewerbsbeginn", "Bewerbsende", "SortOrder"],
        ["2", "2", "Rangliste <img src=x onerror=alert(1)>", "", "", "20250101", "", "1"],
        ["3", "3", "Sommercup", "", "", "20250101", "", "2"],
      ] } };
    }
    return { data: { success: true } };
  };
}
`;

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const emojiAssets = {
      "/api/emoji-picker/index.js": path.join(BACKEND_ROOT, "node_modules/emoji-picker-element/index.js"),
      "/api/emoji-picker/picker.js": path.join(BACKEND_ROOT, "node_modules/emoji-picker-element/picker.js"),
      "/api/emoji-picker/database.js": path.join(BACKEND_ROOT, "node_modules/emoji-picker-element/database.js"),
      "/api/emoji-picker/i18n/de.js": path.join(BACKEND_ROOT, "node_modules/emoji-picker-element/i18n/de.js"),
      "/api/emoji-picker/data/de.json": path.join(BACKEND_ROOT, "node_modules/emoji-picker-element-data/de/cldr-native/data.json"),
    };
    if (emojiAssets[pathname]) {
      const type = pathname.endsWith(".json") ? "application/json; charset=utf-8" : "text/javascript; charset=utf-8";
      response.writeHead(200, { "Content-Type": type });
      response.end(request.method === "HEAD" ? "" : fs.readFileSync(emojiAssets[pathname]));
      return;
    }
    if (pathname === "/JS/bewerbeList.js") {
      const source = fs.readFileSync(path.join(FRONTEND_ROOT, "JS/bewerbeList.js"), "utf8")
        .replace('"./dataClient.js"', '"/test/dataClient.js"')
        .replace('"./authClient.js"', '"/test/authClient.js"')
        .replace('"./loadingHelper.js"', '"/test/loadingHelper.js"')
        .replace('"./monitorReady.js"', '"/test/monitorReady.js"')
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
    if (pathname === "/test/loadingHelper.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end("export const callWithRetry = (fn) => fn(); export const showLoadingOverlay = () => {}; export const hideLoadingOverlay = () => {}; export const showErrorOverlay = () => {};\n");
      return;
    }
    if (pathname === "/test/monitorReady.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end("export const signalMonitorReady = () => {}; export const signalMonitorFailed = () => {};\n");
      return;
    }
    if (pathname === "/test/diagnostics.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end("window.__diagnostics = []; export const diagnostic = { error: (...args) => window.__diagnostics.push(args) };\n");
      return;
    }
    if (["/JS/modals.js", "/JS/navbar.js", "/JS/global.js", "/JS/clock.js", "/JS/footer.js"].includes(pathname)) {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end();
      return;
    }
    const relative = pathname.replace(/^\/+/, "");
    const filePath = path.resolve(FRONTEND_ROOT, relative || "Bewerbe.html");
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

test("Bewerbshistorie bleibt authentifiziert, sicher, paginiert und zugaenglich", {
  skip: !fs.existsSync(CHROMIUM_PATH) && `Chromium fehlt unter ${CHROMIUM_PATH}`,
  timeout: 30000,
}, async () => {
  const server = await startServer();
  const address = server.address();
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 640 } });
    await page.goto(`http://127.0.0.1:${address.port}/Bewerbe.html?manualAuth=1`, { waitUntil: "domcontentloaded" });
    await page.locator(".bewerb-card").first().waitFor({ state: "visible" });
    assert.equal(await page.locator(".bewerb-grid").first().evaluate((grid) => getComputedStyle(grid).display), "block");
    assert.equal(await page.locator(".bewerb-card").first().getAttribute("role"), null);
    assert.equal(await page.locator(".bewerb-card").first().getAttribute("tabindex"), null);
    assert.equal(await page.locator(".bewerb-card").first().getByRole("link").getAttribute("href"), "rangliste.html?id=2");
    assert.equal(await page.getByRole("button", { name: /Historie von/ }).first().isHidden(), true);
    assert.equal(await page.getByRole("button", { name: "Historie aller Bewerbe öffnen" }).isHidden(), true);
    await page.evaluate(() => window.__resolveAuth());
    await page.getByRole("button", { name: /Historie von/ }).first().waitFor({ state: "visible" });
    const globalHistoryButton = page.getByRole("button", { name: "Historie aller Bewerbe öffnen" });
    await globalHistoryButton.waitFor({ state: "visible" });
    assert.equal(await globalHistoryButton.locator("svg").count(), 1);
    assert.equal(await globalHistoryButton.locator("svg").getAttribute("data-icon"), "megaphone");
    const pageHeadingGap = await page.locator(".bewerbe-page-heading").evaluate((row) => {
      const heading = row.querySelector("h2").getBoundingClientRect();
      const buttonElement = row.querySelector("button");
      const button = buttonElement.getBoundingClientRect();
      return {
        horizontal: button.left - heading.right,
        vertical: Math.abs((button.top + button.height / 2) - (heading.top + heading.height / 2)),
        outsideCards: !document.getElementById("bewerbe-container").contains(buttonElement),
      };
    });
    assert.equal(pageHeadingGap.horizontal >= 0 && pageHeadingGap.horizontal <= 8, true);
    assert.equal(pageHeadingGap.vertical <= 1, true);
    assert.equal(pageHeadingGap.outsideCards, true);

    const originalUrl = page.url();
    await globalHistoryButton.click();
    const modal = page.getByRole("dialog");
    await modal.waitFor({ state: "visible" });
    assert.equal(await modal.locator("#competition-history-title").innerText(), "Historie");
    assert.equal(await modal.locator("#competition-history-competition-name").innerText(), "Alle Bewerbe");
    assert.deepEqual(await page.evaluate(() => window.__historyCalls), [{}]);
    await page.waitForTimeout(250);
    assert.deepEqual(await modal.locator(".competition-history-entry-competition").allTextContents(), ["Sommercup - Viertelfinale", "Rangliste"]);
    assert.deepEqual(await modal.locator(".competition-history-entry").first().locator(":scope > :not(.history-entry-actions)").allTextContents(), [
      await modal.locator(".competition-history-entry").first().locator("time").innerText(),
      "Sommercup - Viertelfinale",
      "Zweite Änderung",
      "Grund: Doppelte Forderung",
      "Ergebnis: 6-3/6-4",
      "Eingetragen durch: Neu Spieler",
    ]);
    const expectedHistoryStyles = [
      { color: "rgb(0, 0, 0)", fontSize: "14.4px", fontWeight: "400" },
      { color: "rgb(0, 0, 0)", fontSize: "14.4px", fontWeight: "400" },
      { color: "rgb(0, 0, 0)", fontSize: "14.4px", fontWeight: "700" },
      { color: "rgb(0, 0, 0)", fontSize: "14.4px", fontWeight: "400" },
      { color: "rgb(0, 0, 0)", fontSize: "14.4px", fontWeight: "400" },
      { color: "rgb(0, 0, 0)", fontSize: "14.4px", fontWeight: "400" },
    ];
    const historyStyles = () => modal.locator(".competition-history-entry").first().locator(":scope > :not(.history-entry-actions)").evaluateAll((lines) => lines.map((line) => {
      const style = getComputedStyle(line);
      return { color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight };
    }));
    assert.deepEqual(await historyStyles(), expectedHistoryStyles);
    const actionRow = page.locator(".history-entry-actions").first();
    assert.equal(await actionRow.getByRole("button", { name: "Kommentare öffnen, 1 Kommentare" }).locator("svg").count(), 1);
    assert.deepEqual(await actionRow.locator(".history-reaction-button").allTextContents(), ["👍", "😮"]);
    assert.equal(await actionRow.locator(".history-reaction-summary .history-action-count").innerText(), "3");
    assert.equal(await actionRow.getByRole("button", { name: "Reaktion hinzufügen" }).locator("svg").count(), 1);
    const compactGaps = await actionRow.evaluate((row) => {
      const commentIcon = row.querySelector(".history-action-button").getBoundingClientRect();
      const commentCount = row.querySelector(".history-action-group .history-action-count").getBoundingClientRect();
      const emoji = [...row.querySelectorAll(".history-reaction-button")].at(-1).getBoundingClientRect();
      const reactionCount = row.querySelector(".history-reaction-summary .history-action-count").getBoundingClientRect();
      const add = row.querySelector(".history-reaction-add").getBoundingClientRect();
      return { comment: commentCount.left - commentIcon.right, reaction: reactionCount.left - emoji.right, add: add.left - reactionCount.right };
    });
    assert.equal(compactGaps.comment <= 4 && compactGaps.reaction <= 4 && compactGaps.add <= 4, true);
    await page.evaluate(() => {
      window.__interaction = { ...window.__interaction, commentCount: 5 };
      window.__revision = 2;
      window.__subscriptions.get("competition-history")?.({ revision: 2 });
    });
    await page.waitForFunction(() => document.querySelector(".history-action-group .history-action-count")?.textContent === "5");

    await actionRow.getByRole("button", { name: /Kommentare öffnen/ }).click();
    const commentsModal = page.locator("#history-comments-modal");
    await commentsModal.waitFor({ state: "visible" });
    assert.equal(await commentsModal.locator(".history-comment-author").innerText(), "Ada");
    assert.equal(await commentsModal.locator(".history-comment-body").innerText(), "Sicherer Kommentar");
    const commentReactions = commentsModal.locator(".history-comment-reactions").first();
    assert.deepEqual(await commentReactions.locator(".history-reaction-button").allTextContents(), ["👍"]);
    assert.equal(await commentReactions.locator(".history-action-count").innerText(), "1");
    const reactionsModal = page.locator("#history-reactions-modal");
    await commentReactions.locator(".history-reaction-button").click();
    await reactionsModal.waitFor({ state: "visible" });
    assert.deepEqual(await reactionsModal.locator(".history-reaction-person-name").allTextContents(), ["Berta"]);
    await reactionsModal.getByRole("button", { name: "Reaktionen schließen" }).click();
    await commentReactions.getByRole("button", { name: "Reaktion hinzufügen" }).click();
    await reactionsModal.getByRole("button", { name: "Stark" }).click();
    await commentsModal.getByText("💪").waitFor({ state: "visible" });
    await commentsModal.getByRole("button", { name: "Kommentar schreiben" }).click();
    const editorModal = page.locator("#history-comment-editor-modal");
    await editorModal.waitFor({ state: "visible" });
    const commentInput = editorModal.locator("#history-comment-text");
    await commentInput.fill("Neuer Kommentar ");
    await editorModal.getByRole("button", { name: "Emoji auswählen" }).click();
    const emojiPicker = editorModal.locator("emoji-picker");
    await emojiPicker.waitFor({ state: "attached" });
    await emojiPicker.evaluate((picker) => picker.dispatchEvent(new CustomEvent("emoji-click", { detail: { unicode: "🎾" } })));
    assert.equal(await commentInput.inputValue(), "Neuer Kommentar 🎾");
    await editorModal.getByRole("button", { name: "Senden" }).click();
    await editorModal.waitFor({ state: "hidden" });
    assert.deepEqual(await commentsModal.locator(".history-comment-body").allTextContents(), ["Sicherer Kommentar", "Neuer Kommentar 🎾"]);
    assert.equal(await page.locator(".history-entry-actions").first().locator(".history-action-group .history-action-count").innerText(), "2");
    await commentsModal.getByRole("button", { name: "Kommentare schließen" }).click();
    await actionRow.locator(".history-reaction-button").first().click();
    await reactionsModal.waitFor({ state: "visible" });
    assert.deepEqual(await reactionsModal.locator(".history-reaction-person-name").allTextContents(), ["Ada", "Berta", "Chris"]);
    assert.equal(await reactionsModal.getByRole("button", { name: "Entfernen" }).count(), 1);
    await reactionsModal.getByRole("button", { name: "Reaktionen schließen" }).click();
    await actionRow.getByRole("button", { name: "Reaktion hinzufügen" }).click();
    assert.equal(await reactionsModal.getByRole("button", { name: "Stark" }).innerText(), "💪");
    await reactionsModal.getByRole("button", { name: "Reaktionen schließen" }).click();
    await page.setViewportSize({ width: 1024, height: 720 });
    assert.deepEqual(await historyStyles(), expectedHistoryStyles);
    await page.setViewportSize({ width: 390, height: 640 });
    const body = modal.locator("#competition-history-body");
    const scrollMetrics = await body.evaluate((bodyElement) => {
      const list = bodyElement.querySelector("#competition-history-list");
      const template = list.firstElementChild;
      for (let index = 0; index < 100; index++) list.appendChild(template.cloneNode(true));
      bodyElement.scrollTop = 0;
      const dialog = bodyElement.closest(".competition-history-dialog").getBoundingClientRect();
      return {
        clientHeight: bodyElement.clientHeight,
        scrollHeight: bodyElement.scrollHeight,
        scrollTop: bodyElement.scrollTop,
        dialogBottom: dialog.bottom,
        viewportHeight: innerHeight,
      };
    });
    assert.equal(scrollMetrics.scrollHeight > scrollMetrics.clientHeight, true);
    assert.equal(scrollMetrics.dialogBottom <= scrollMetrics.viewportHeight, true);
    const moreButton = modal.getByRole("button", { name: "Weitere Einträge laden" });
    const initialButtonPosition = await moreButton.evaluate((button) => {
      const bodyElement = button.closest(".competition-history-body");
      return {
        buttonOffsetTop: button.offsetTop,
        bodyClientHeight: bodyElement.clientHeight,
      };
    });
    assert.equal(initialButtonPosition.buttonOffsetTop > initialButtonPosition.bodyClientHeight, true);
    await moreButton.evaluate((button) => button.scrollIntoView({ block: "end", inline: "nearest" }));
    const bodyScrollAfterScroll = await body.evaluate((bodyElement) => ({
      scrollTop: bodyElement.scrollTop,
      scrollHeight: bodyElement.scrollHeight,
      clientHeight: bodyElement.clientHeight,
    }));
    assert.equal(bodyScrollAfterScroll.scrollTop > 0, true);
    assert.equal(bodyScrollAfterScroll.scrollHeight > bodyScrollAfterScroll.clientHeight, true);
    await moreButton.click();
    assert.deepEqual(await page.evaluate(() => window.__historyCalls), [{}, { cursor: "global-page-2" }]);
    assert.deepEqual(await modal.locator(".competition-history-entry-competition").allTextContents(), ["Sommercup - Viertelfinale", "Rangliste", "Wintercup - Achtelfinale"]);
    await page.keyboard.press("Escape");
    assert.equal(await globalHistoryButton.evaluate((button) => document.activeElement === button), true);

    const historyButton = page.getByRole("button", { name: /Historie von/ }).first();
    assert.equal(await historyButton.innerText(), "");
    assert.equal(await historyButton.locator("svg").count(), 1);
    assert.equal(await historyButton.locator("svg").getAttribute("data-icon"), "megaphone");
    const headingGap = await page.locator(".bewerb-card").first().evaluate((card) => {
      const heading = card.querySelector("h3").getBoundingClientRect();
      const button = card.querySelector(".competition-history-button").getBoundingClientRect();
      return { horizontal: button.left - heading.right, vertical: Math.abs((button.top + button.height / 2) - (heading.top + heading.height / 2)) };
    });
    assert.equal(headingGap.horizontal >= 0 && headingGap.horizontal <= 8, true);
    assert.equal(headingGap.vertical <= 1, true);
    await historyButton.click();
    await modal.waitFor({ state: "visible" });
    assert.equal(await modal.locator("#competition-history-title").innerText(), "Historie");
    assert.equal(await modal.locator("#competition-history-competition-name").innerText(), "Rangliste <img src=x onerror=alert(1)>");
    assert.equal(await modal.locator(".competition-history-heading").evaluate((heading) => getComputedStyle(heading).textAlign), "center");
    assert.equal(await modal.locator("#competition-history-title").evaluate((title) => title.getBoundingClientRect().bottom <= document.getElementById("competition-history-competition-name").getBoundingClientRect().top), true);
    assert.equal(page.url(), originalUrl);
    assert.deepEqual(await page.evaluate(() => window.__historyCalls), [
      {},
      { cursor: "global-page-2" },
      { bewerbId: "2" },
    ]);
    assert.equal(await modal.locator("img").count(), 0);
    assert.deepEqual(await modal.locator(".competition-history-entry-title").allTextContents(), [
      "Zweite Änderung",
      "<img src=x onerror=alert(1)>",
    ]);
    assert.deepEqual(await modal.locator("#competition-history-list").evaluate((list) => ({ tag: list.tagName, style: getComputedStyle(list).listStyleType, overflow: getComputedStyle(list).overflowY })), {
      tag: "UL",
      style: "none",
      overflow: "visible",
    });
    assert.deepEqual(await modal.locator(".competition-history-entry").first().locator(":scope > :not(.history-entry-actions)").allTextContents(), [
      await modal.locator(".competition-history-entry").first().locator("time").innerText(),
      "Viertelfinale",
      "Zweite Änderung",
      "Grund: Doppelte Forderung",
      "Ergebnis: 6-3/6-4",
      "Eingetragen durch: Neu Spieler",
    ]);
    assert.deepEqual(await modal.locator(".competition-history-entry").nth(1).locator(":scope > :not(.history-entry-actions)").allTextContents(), [
      await modal.locator(".competition-history-entry").nth(1).locator("time").innerText(),
      "1. Gruppe",
      "<img src=x onerror=alert(1)>",
      "Eingetragen durch: Alt Spieler",
    ]);
    assert.equal((await modal.textContent()).includes("Grund: Doppelte Forderung"), true);
    assert.equal((await modal.textContent()).includes("Ebenfalls nicht anzeigen"), false);
    assert.equal(await page.locator("#competition-history-close").evaluate((button) => document.activeElement === button), true);

    await moreButton.click();
    assert.deepEqual(await page.evaluate(() => window.__historyCalls), [
      {},
      { cursor: "global-page-2" },
      { bewerbId: "2" },
      { bewerbId: "2", cursor: "page-2" },
    ]);
    assert.deepEqual(await modal.locator(".competition-history-entry-title").allTextContents(), [
      "Zweite Änderung",
      "<img src=x onerror=alert(1)>",
      "Angelegt",
    ]);
    const bounds = await modal.locator(".competition-history-dialog").evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
    assert.equal(bounds.left >= 0 && bounds.right <= bounds.width, true);
    assert.equal(bounds.top >= 0 && bounds.bottom <= bounds.height, true);

    const cardCount = await page.locator(".bewerb-card").count();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    assert.equal(await modal.isVisible(), true);
    assert.equal(await page.locator(".bewerb-card").count(), cardCount);
    await page.keyboard.press("Escape");
    assert.equal(await modal.isHidden(), true);
    assert.equal(await page.locator(".bewerb-card .competition-history-button").first().isVisible(), true);
    await page.waitForFunction(() => window.__bewerbeCalls.length === 2);
    assert.equal(await page.locator(".bewerb-card").count(), cardCount);

    await globalHistoryButton.click();
    await modal.waitFor({ state: "visible" });
    await page.evaluate(() => window.__loseSession());
    assert.equal(await modal.isHidden(), true);
    assert.equal(await historyButton.isHidden(), true);
    assert.equal(await globalHistoryButton.isHidden(), true);
    assert.equal(await page.locator("#competition-history-list").textContent(), "");
    await page.close();

    const errorPage = await browser.newPage();
    await errorPage.goto(`http://127.0.0.1:${address.port}/Bewerbe.html?historyError=1`, { waitUntil: "domcontentloaded" });
    await errorPage.getByRole("button", { name: /Historie von/ }).first().click();
    await errorPage.getByText("Historie konnte nicht geladen werden. Bitte erneut versuchen.").waitFor({ state: "visible" });
    assert.deepEqual(await errorPage.evaluate(() => window.__diagnostics.map((entry) => entry[0])), ["competition_history_load_failed"]);
    await errorPage.getByRole("button", { name: "Erneut versuchen" }).click();
    assert.equal((await errorPage.evaluate(() => window.__historyCalls)).length, 2);
    await errorPage.close();

    const emptyPage = await browser.newPage();
    await emptyPage.goto(`http://127.0.0.1:${address.port}/Bewerbe.html?historyEmpty=1`, { waitUntil: "domcontentloaded" });
    await emptyPage.getByRole("button", { name: /Historie von/ }).first().click();
    await emptyPage.getByText("Keine Historieneinträge vorhanden.").waitFor({ state: "visible" });
    assert.equal(await emptyPage.locator(".competition-history-entry").count(), 0);
    await emptyPage.close();

    const adminPage = await browser.newPage({ viewport: { width: 390, height: 640 } });
    await adminPage.goto(`http://127.0.0.1:${address.port}/Bewerbe.html?role=admin`, { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: "Historie aller Bewerbe öffnen" }).click();
    await adminPage.locator(".history-entry-actions").first().getByRole("button", { name: /Kommentare öffnen/ }).click();
    const adminComments = adminPage.locator("#history-comments-modal");
    const hideComment = adminComments.getByRole("button", { name: "Vorläufig ausblenden" });
    await hideComment.waitFor({ state: "visible" });
    await hideComment.click();
    await adminComments.getByRole("button", { name: "Wieder freigeben" }).waitFor({ state: "visible" });
    assert.equal(await adminComments.locator(".history-comment").first().getAttribute("class"), "history-comment is-mine is-under-review");
    assert.equal(await adminComments.locator(".history-comment-body").first().innerText(), "Sicherer Kommentar");
    await adminPage.close();

    const stalePage = await browser.newPage({ viewport: { width: 390, height: 640 } });
    await stalePage.goto(`http://127.0.0.1:${address.port}/Bewerbe.html?staleComments=1`, { waitUntil: "domcontentloaded" });
    await stalePage.getByRole("button", { name: "Historie aller Bewerbe öffnen" }).click();
    const staleActions = stalePage.locator(".history-entry-actions");
    await staleActions.nth(0).getByRole("button", { name: /Kommentare öffnen/ }).click();
    await stalePage.locator("#history-comments-close").click();
    await staleActions.nth(1).getByRole("button", { name: /Kommentare öffnen/ }).click();
    await stalePage.getByText("Anderer Bewerb").waitFor({ state: "visible" });
    await stalePage.waitForTimeout(350);
    assert.deepEqual(await stalePage.locator("#history-comments-list .history-comment-author").allTextContents(), ["Berta"]);
    await stalePage.close();

    const uncertainPage = await browser.newPage({ viewport: { width: 390, height: 640 } });
    await uncertainPage.goto(`http://127.0.0.1:${address.port}/Bewerbe.html?uncertainWrite=1`, { waitUntil: "domcontentloaded" });
    await uncertainPage.getByRole("button", { name: "Historie aller Bewerbe öffnen" }).click();
    await uncertainPage.locator(".history-entry-actions").first().getByRole("button", { name: /Kommentare öffnen/ }).click();
    await uncertainPage.getByRole("button", { name: "Kommentar schreiben" }).click();
    const uncertainEditor = uncertainPage.locator("#history-comment-editor-modal");
    await uncertainEditor.locator("textarea").fill("Ursprünglicher Text");
    await uncertainEditor.getByRole("button", { name: "Senden" }).click();
    await uncertainEditor.getByText("Kommentar konnte nicht gespeichert werden. Bitte erneut versuchen.").waitFor({ state: "visible" });
    await uncertainEditor.locator("textarea").fill("Geänderter Text");
    await uncertainEditor.getByRole("button", { name: "Senden" }).click();
    await uncertainEditor.getByText("Bitte zuerst die zuvor gesendete Änderung unverändert wiederholen.").waitFor({ state: "visible" });
    assert.deepEqual(await uncertainPage.evaluate(() => window.__commentWriteCalls), ["Ursprünglicher Text"]);
    await uncertainPage.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
