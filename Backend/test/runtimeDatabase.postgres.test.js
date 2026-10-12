"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { runMigrations } = require("../db/migrationRunner");
const { applyFullDevelSeed, applyTechnicalSeed } = require("../db/seedRunner");
const { createRuntimeRepositories } = require("../db/createRuntimeRepositories");
const { RuntimeDatabase } = require("../db/runtimeDatabase");
const { PostgresAuthService } = require("../postgresAuthService");
const { PostgresCompetitionService } = require("../postgresCompetitionService");
const { PostgresProjectionService } = require("../postgresProjectionService");
const { PostgresProjectionLoader } = require("../postgresProjectionLoader");
const { PostgresPreferenceService } = require("../postgresPreferenceService");
const { PostgresFrontendLoggingService } = require("../postgresFrontendLoggingService");
const { PostgresMessagingService } = require("../postgresMessagingService");
const { PostgresAuditAdapter } = require("../postgresAuditAdapter");
const { IDEMPOTENCY_CONTRACTS, LEGACY_AUDIT_CONTRACTS } = require("../postgresRuntimeContracts");
const dataStore = require("../dataStore");
const { createPostgresComponents } = require("../createPostgresComponents");
const { startPostgresTestCluster } = require("./postgresTestCluster");

async function preparedRuntime(t) {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-11T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-11T00:00:00.000Z", output: () => {} });
  const events = [];
  const runtime = createRuntimeRepositories({
    connectionConfig: { ...cluster.connectionConfig, application_name: "epiber-runtime-test" },
    expectedTenantCode: "devel-epiber",
    sourceInstance: "devel",
    auditContracts: {
      ...LEGACY_AUDIT_CONTRACTS,
      "identity.profile.update": { before: { revision: "revision" }, after: { revision: "revision" } },
      "competition.entry.add": {
        before: { competitionId: "id", personId: "id" },
        after: { competitionId: "id", personId: "id", entryId: "id", alreadyPresent: "boolean" },
      },
      "competition.entry.remove": {
        before: { competitionId: "id", personId: "id" },
        after: { competitionId: "id", personId: "id", entryId: "id", removed: "boolean" },
      },
    },
    idempotencyContracts: {
      ...IDEMPOTENCY_CONTRACTS,
      "identity.profile.update": { personId: "id", revision: "revision" },
      "competition.entry.add": { success: "boolean", entryId: "id", alreadyPresent: "boolean" },
      "competition.entry.remove": { success: "boolean", entryId: "id", removed: "boolean" },
      "preference.favorites.set": { success: "boolean", favorites: "preference_targets", revision: "revision" },
      "preference.start_page.set": { success: "boolean", target: "preference_target", revision: "revision" },
    },
    messageEventContracts: {
      "test.notice": { templateKey: "test.notice", templateVersion: 1, parameters: { subjectId: "id", status: "status" } },
      "competition.entry.created": { templateKey: "competition.entry.created", templateVersion: 1, parameters: { competitionId: "id", personId: "id" } },
      "competition.entry.withdrawn": { templateKey: "competition.entry.withdrawn", templateVersion: 1, parameters: { competitionId: "id", personId: "id" } },
    },
    log: (level, event, fields) => events.push({ level, event, fields }),
  });
  t.after(() => runtime.close());
  const repositories = await runtime.connect();
  return { cluster, events, repositories, runtime };
}

test("PostgreSQL-Laufzeit lehnt unvollstaendige Domaenenregistrierung vor Verbindungsaufbau ab", async () => {
  const runtime = new RuntimeDatabase({
    connectionConfig: { host: "/nicht/verwendet", port: 5433, database: "unused", user: "unused" },
    expectedTenantCode: "devel-epiber",
    requiredDomains: ["core", "identity"],
  });
  runtime.registerDomain("core", () => ({}));
  await assert.rejects(runtime.connect(), (error) => error.code === "DB_DOMAINS_INCOMPLETE" && error.details.missing[0] === "identity");
  assert.equal(runtime.status().ready, false);
});

test("PostgreSQL-Laufzeit validiert Tenant, Schema und Core-/Identity-Repositories", { timeout: 30_000 }, async (t) => {
  const { events, repositories, runtime } = await preparedRuntime(t);
  const tenant = await repositories.core.tenant();
  assert.equal(tenant.tenantCode, "devel-epiber");
  assert.equal((await repositories.core.section()).sectionCode, "tennis");

  const people = await repositories.identity.people();
  assert.equal(people.length, 5);
  assert.equal(people[0].role, "admin");
  assert.deepEqual(people[0].assignedRoles, ["admin", "operator"]);
  const account = await repositories.identity.accountForLogin("PLAYER", { includeCredential: true });
  assert.equal(account.personId, "3");
  assert.equal(account.credentialSchema, "legacy_sha256");
  assert.equal(account.secretHash, "a".repeat(64));
  const favorites = await repositories.identity.userFavorites("1");
  assert.equal(favorites.favorites.length, 3);
  assert.deepEqual(favorites.favorites.map(({ page, params }) => [page, params?.id || null]), [
    ["scoreboard", null], ["rangliste", "2"], ["hallzeiten", "hall-seed"],
  ]);
  assert.deepEqual((await repositories.identity.userStartPage("1")).target, { type: "page", page: "rangliste", params: { id: "2" } });

  assert.equal(runtime.status().ready, true);
  assert.equal(runtime.status().generation, 6);
  assert.equal(events.some(({ event, fields }) => event === "postgres_runtime_started" && fields.result === "success"), true);
  assert.equal(JSON.stringify(events).includes("secretHash"), false);
});

test("Play-Repository liest typisierte Bewerbs-, Match- und Ranglistenprojektionen", { timeout: 30_000 }, async (t) => {
  const { repositories, runtime } = await preparedRuntime(t);
  const competitions = await repositories.play.competitions();
  assert.equal(competitions.length, 3);
  assert.deepEqual(competitions.find(({ id }) => id === "ko-1").genderCodes, [1]);
  assert.equal((await repositories.play.competitionTypes()).length, 3);
  assert.equal((await repositories.play.matchFormats()).length, 1);
  assert.equal((await repositories.play.entries("ko-1", { includeWithdrawn: true })).length, 2);
  const matches = await repositories.play.matches("ko-1");
  assert.equal(matches.length, 2);
  assert.equal(matches.every(({ participants }) => Array.isArray(participants)), true);
  const groupMatches = await repositories.play.matches("rr-1");
  assert.deepEqual(groupMatches.map(({ completionType }) => completionType).sort(), ["retirement", "walkover"]);
  assert.equal((await repositories.play.rankings("2")).length, 3);
});

test("PostgreSQL-Projektionsservice erzeugt alle acht bestehenden Tabellenvertraege ohne Credentialprojektion", { timeout: 30_000 }, async (t) => {
  const { repositories } = await preparedRuntime(t);
  const tables = await new PostgresProjectionService(repositories).load();
  assert.deepEqual(Object.keys(tables).sort(), ["bewerbe", "bewerbsart", "entryList", "matches1", "matchtyp", "navigator", "players", "rlPlatzierung"].sort());
  assert.equal(tables.players.length, 6);
  const passwordIndex = tables.players[0].indexOf("PasswdHash");
  assert.equal(tables.players.slice(1).every((row) => row[passwordIndex] === ""), true);
  const matchHeader = tables.matches1[0];
  const matchIdIndex = matchHeader.indexOf("ID");
  const resultIndex = matchHeader.indexOf("Ergebnis");
  const playerOneIndex = matchHeader.indexOf("Spieler1ID");
  const regular = tables.matches1.find((row) => row[matchIdIndex] === "m-seed");
  assert.equal(regular[resultIndex], "6-3/6-4");
  const walkover = tables.matches1.find((row) => row[matchIdIndex] === "rr-walkover");
  assert.equal(walkover[playerOneIndex].endsWith("[wo]") || walkover[matchHeader.indexOf("Spieler3ID")].endsWith("[wo]"), true);
  assert.equal(tables.navigator[1][3], "1");
});

test("PostgreSQL-Projektionsloader ersetzt den Sheet-Initialload atomar und ohne Polling", { timeout: 30_000 }, async (t) => {
  const { repositories } = await preparedRuntime(t);
  dataStore.resetForTests();
  t.after(() => dataStore.resetForTests());
  const events = [];
  const loader = new PostgresProjectionLoader({
    projectionService: new PostgresProjectionService(repositories),
    dataStore,
    publish: (topic, value) => events.push({ topic, value }),
    log: (level, event, fields) => events.push({ level, event, fields }),
  });
  const first = await loader.initialLoad();
  assert.equal(first.success, true);
  assert.equal(first.tableCount, 8);
  assert.equal(dataStore.isReady(), true);
  const second = await loader.refresh("test");
  assert.deepEqual(second.changedTables, []);
  assert.equal(loader.getStatus().running, false);
  assert.equal(events.some(({ event, fields }) => event === "postgres_projection_refresh_completed" && fields.result === "success"), true);
});

test("PostgreSQL-Komposition liefert aktivierbare Teilservices, bleibt fuer unvollstaendigen Serverstart aber fail-closed", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  const components = await createPostgresComponents({
    connectionConfig: cluster.connectionConfig,
    expectedTenantCode: "devel-epiber",
    sourceInstance: "devel",
    rateLimitSecret: Buffer.alloc(32, 5),
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    sessionRefreshIntervalMs: 24 * 60 * 60 * 1000,
    sessionMaxPerUser: 10,
  });
  t.after(() => components.runtime.close());
  assert.equal(components.capabilities.serverReady, false);
  assert.equal(components.capabilities.missing.includes("match-and-ranking-writes"), true);
  assert.equal(typeof components.authService.login, "function");
  assert.equal(typeof components.competitionService.addEntry, "function");
  assert.equal(typeof components.messagingService.addCompetitionHistoryComment, "function");
  assert.equal(components.auditLogRepository.status().backend, "postgres");
  const principal = { type: "user", id: "1", name: "Ada Admin", role: "admin" };
  const provisionParams = { operationId: "0199c800-0000-7000-8000-00000000fc01", label: "Kompositionsmonitor" };
  const provisioned = await components.monitorBroker.provision(principal, provisionParams);
  assert.equal(typeof provisioned.monitor.token, "string");
  const repeated = await components.monitorBroker.provision(principal, provisionParams);
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.tokenUnavailable, true);
  const navigated = await components.monitorBroker.navigate(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fc02",
    monitorId: provisioned.monitor.monitorId,
    path: "/scoreboard.html",
  });
  assert.equal(navigated.delivery, "offline");
  assert.equal(components.monitorBroker.target(provisioned.monitor.monitorId).path, "/scoreboard.html");
  const sent = [];
  components.monitorBroker.setTransport({ send: (_info, message) => { sent.push(message); return true; }, publish: () => {}, close: () => {} });
  const deviceInfo = { principal: { type: "device", id: provisioned.monitor.monitorId, role: "device" } };
  components.monitorBroker.register(deviceInfo);
  const delivered = await components.monitorBroker.navigate(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fc03",
    monitorId: provisioned.monitor.monitorId,
    path: "/index.html",
  });
  assert.equal(delivered.delivery, "sent");
  await components.monitorBroker.acknowledge(deviceInfo.principal, { kind: "navigate", commandId: delivered.commandId, status: "loaded" });
  const scrolled = await components.monitorBroker.scroll(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fc04",
    monitorId: provisioned.monitor.monitorId,
    direction: "down",
  });
  await components.monitorBroker.acknowledge(deviceInfo.principal, { kind: "scroll", commandId: scrolled.commandId, status: "applied" });
  assert.equal(sent.some(({ data }) => data.kind === "navigate"), true);
  assert.equal(sent.some(({ data }) => data.kind === "scroll"), true);
  components.monitorBroker.unregister(deviceInfo);
});

test("Venue-Repository liest Courts und Hallenzeiten und persistiert Scores atomar", { timeout: 30_000 }, async (t) => {
  const { repositories, runtime } = await preparedRuntime(t);
  const courts = await repositories.venue.courts();
  assert.equal(courts.length, 1);
  assert.equal(courts[0].matchId, "m-seed");
  const grid = await repositories.venue.hallTimeGrid("hall-seed");
  assert.equal(grid.participants.length, 2);
  assert.equal(grid.slots[0].allocations.length, 2);
  assert.equal((await repositories.venue.navigationPresets("1"))[0].targetType, "page");

  const event = {
    eventId: "0199c800-0000-7000-8000-00000000bb01",
    courtId: "1",
    score: {
      sideOneSetOne: "1", sideTwoSetOne: "0", sideOneSetTwo: "0", sideTwoSetTwo: "0",
      sideOneSetThree: "0", sideTwoSetThree: "0", sideOnePoints: "30", sideTwoPoints: "15",
    },
    sourceOccurredAt: new Date("2026-10-11T12:00:00.000Z"),
    sourceSequence: 2,
  };
  const stored = await repositories.venue.appendScoreEvent(event);
  assert.deepEqual(stored, { duplicate: false, courtSequence: "2", revision: "3" });
  assert.deepEqual(await repositories.venue.appendScoreEvent(event), { duplicate: true, courtSequence: "2" });
  await assert.rejects(repositories.venue.appendScoreEvent({ ...event, score: { ...event.score, sideOnePoints: "40" } }), (error) => error.code === "SCORE_EVENT_CONFLICT");
  const monitor = await repositories.venue.provisionMonitor("Runtime Monitor", "monitor-runtime");
  assert.equal((await repositories.venue.monitorByToken(monitor.token)).monitorId, "monitor-runtime");
  const navigation = await runtime.withTransaction("venue.monitor.navigate", (transaction) => repositories.venue.createNavigationCommand(transaction, {
    monitorId: "monitor-runtime",
    commandId: "0199c800-0000-7000-8000-00000000fb01",
    operationId: "0199c800-0000-7000-8000-00000000fb02",
    path: "/scoreboard.html",
  }));
  assert.equal(navigation.path, "/scoreboard.html");
  assert.equal((await repositories.venue.monitorTarget("monitor-runtime")).commandId, navigation.commandId);
  assert.equal((await repositories.venue.updateMonitorCommand("monitor-runtime", navigation.commandId, "loaded")).status, "loaded");
  const manualCourt = await runtime.withTransaction("venue.court.manual", (transaction) => repositories.venue.replaceCourtAssignment(transaction, {
    courtId: "1", expectedRevision: 2, actorPersonId: "1", assignment: { homePlayerIds: ["1"], guestPlayerIds: ["2"] },
  }));
  assert.equal(manualCourt.revision, 3);
  const deactivated = await runtime.withTransaction("venue.court.active", (transaction) => repositories.venue.setCourtActive(transaction, {
    courtId: "1", expectedRevision: 3, actorPersonId: "1", active: false,
  }));
  assert.deepEqual(deactivated, { revision: 4, active: false });
  const projectedCourt = (await repositories.venue.courts()).find(({ id }) => id === "1");
  assert.deepEqual(projectedCourt.homePlayerIds, ["1"]);
  assert.deepEqual(projectedCourt.guestPlayerIds, ["2"]);
  assert.equal(projectedCourt.active, false);
  const rotated = await repositories.venue.rotateMonitorToken("monitor-runtime");
  assert.equal(await repositories.venue.monitorByToken(monitor.token), null);
  assert.equal((await repositories.venue.monitorByToken(rotated.token)).monitorId, "monitor-runtime");
  await repositories.venue.revokeMonitor("monitor-runtime");
  assert.equal(await repositories.venue.monitorByToken(rotated.token), null);
});

test("Messaging-Repository liest Inbox, quittiert idempotent und erzeugt kontrollierte Ereignisse", { timeout: 30_000 }, async (t) => {
  const { repositories } = await preparedRuntime(t);
  assert.equal((await repositories.messaging.summary("2")).unreadCount, 0);
  const inbox = await repositories.messaging.inbox("2");
  assert.equal(inbox[0].eventId, "event-seed");

  const created = await repositories.messaging.createEvent({
    contractId: "event-runtime",
    eventType: "test.notice",
    operationId: "0199c800-0000-7000-8000-00000000cc01",
    templateParameters: { subjectId: "m-seed", status: "ready" },
    competitionId: "2",
    matchId: "m-seed",
    participants: [{ personId: "1", role: "actor" }],
    recipients: ["1", "2"],
    readPersonIds: ["1"],
    createdAt: new Date("2026-10-11T12:00:00.000Z"),
  });
  assert.deepEqual(created, { id: "event-runtime", duplicate: false, recipients: 2 });
  assert.deepEqual(await repositories.messaging.createEvent({
    contractId: "event-runtime",
    eventType: "test.notice",
    operationId: "0199c800-0000-7000-8000-00000000cc01",
    templateParameters: { subjectId: "m-seed", status: "ready" },
    competitionId: "2",
    matchId: "m-seed",
    participants: [{ personId: "1", role: "actor" }],
    recipients: ["1", "2"],
    readPersonIds: ["1"],
    createdAt: new Date("2026-10-11T12:00:00.000Z"),
  }), { id: "event-runtime", duplicate: true });
  await assert.rejects(repositories.messaging.createEvent({
    contractId: "event-runtime",
    eventType: "test.notice",
    operationId: "0199c800-0000-7000-8000-00000000cc01",
    templateParameters: { subjectId: "m-seed", status: "changed" },
    competitionId: "2",
    matchId: "m-seed",
    participants: [{ personId: "1", role: "actor" }],
    recipients: ["1", "2"],
  }), (error) => error.code === "MESSAGE_OPERATION_CONFLICT");
  assert.equal((await repositories.messaging.summary("2")).unreadCount, 1);
  const runtimeMessage = (await repositories.messaging.inbox("2")).find(({ eventId }) => eventId === "event-runtime");
  const acknowledged = await repositories.messaging.acknowledge("2", runtimeMessage.id);
  assert.equal(acknowledged.duplicate, false);
  const repeated = await repositories.messaging.acknowledge("2", runtimeMessage.id);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.userRevision, acknowledged.userRevision);
  assert.equal((await repositories.messaging.summary("2")).unreadCount, 0);
  const history = await repositories.messaging.competitionHistory("2", { limit: 10 });
  const seededHistory = history.events.find(({ id }) => id === "event-seed");
  assert.equal(seededHistory.summary, "Ada Admin hat ein Ergebnis eingetragen.");
  assert.deepEqual(seededHistory.participants, [{ participantRole: "winner", displayName: "Ada Admin" }]);
  const interactions = await repositories.messaging.interactionSummaries(["event-seed"], "1");
  assert.equal(interactions.get("event-seed").commentCount, 1);
  assert.equal(interactions.get("event-seed").reactionTotal, 1);
  assert.equal(interactions.get("event-seed").myReaction, "ok");
  const comments = await repositories.messaging.comments("event-seed", { limit: 10 });
  assert.equal(comments.comments.length, 1);
  assert.equal(comments.comments[0].status, "visible");
  const commentInteractions = await repositories.messaging.commentReactionSummaries([comments.comments[0].id], "2");
  assert.equal(commentInteractions.get(comments.comments[0].id).myReaction, "+1");
  assert.equal(await repositories.messaging.historyRevision(), "2");
  await assert.rejects(repositories.messaging.inbox("2", { before: "0199c800-0000-7000-8000-00000000ffff" }), (error) => error.code === "MESSAGE_CURSOR_INVALID");
  await assert.rejects(repositories.messaging.competitionHistory("2", { cursor: "missing-event" }), (error) => error.code === "COMPETITION_HISTORY_CURSOR_INVALID");
  await assert.rejects(repositories.messaging.comments("event-seed", { cursor: "0199c800-0000-7000-8000-00000000ffff" }), (error) => error.code === "COMPETITION_HISTORY_COMMENT_CURSOR_INVALID");
  await assert.rejects(repositories.messaging.createEvent({
    contractId: "bad-event",
    eventType: "test.notice",
    operationId: "0199c800-0000-7000-8000-00000000cc02",
    templateParameters: { subjectId: "private@example.test", status: "ready" },
    recipients: ["1"],
  }), (error) => error.code === "MESSAGE_PARAMETER_INVALID");
});

test("PostgreSQL-Messaginginteraktionen sind moderierbar, idempotent und ohne freien Auditpayload", { timeout: 30_000 }, async (t) => {
  const { repositories } = await preparedRuntime(t);
  const service = new PostgresMessagingService({ messaging: repositories.messaging, ops: repositories.ops });
  const admin = { id: "1", name: "Ada Admin", role: "admin", roles: ["admin"] };
  const player = { id: "2", name: "Olivia Operator", role: "operator", roles: ["operator"] };
  const add = {
    operationId: "0199c800-0000-7000-8000-00000000f201",
    eventId: "event-seed",
    body: "Neuer kontrollierter Kommentar",
  };
  const added = await service.addCompetitionHistoryComment(admin, add);
  assert.equal(added.changed, true);
  assert.equal(added.comment.body, add.body);
  assert.equal((await service.addCompetitionHistoryComment(admin, add)).repeated, true);
  const reaction = await service.setCompetitionHistoryCommentReaction(player, {
    operationId: "0199c800-0000-7000-8000-00000000f202",
    commentId: added.commentId,
    reactionKey: "heart",
  });
  assert.equal(reaction.interaction.myReaction, "heart");
  await service.moderateCompetitionHistoryComment(admin, {
    operationId: "0199c800-0000-7000-8000-00000000f203",
    commentId: added.commentId,
    status: "under_review",
  });
  const comments = await service.competitionHistoryComments(player, { eventId: "event-seed", limit: 30 });
  const hidden = comments.comments.find(({ id }) => id === added.commentId);
  assert.equal(hidden.body, "");
  assert.equal(hidden.canReact, false);
  await assert.rejects(service.setCompetitionHistoryCommentReaction(player, {
    operationId: "0199c800-0000-7000-8000-00000000f204",
    commentId: added.commentId,
    reactionKey: "thumbs_up",
  }), (error) => error.code === "COMPETITION_HISTORY_COMMENT_UNDER_REVIEW");
  const removed = await service.deleteCompetitionHistoryComment(admin, {
    operationId: "0199c800-0000-7000-8000-00000000f205",
    commentId: added.commentId,
  });
  assert.equal(removed.changed, true);
  await assert.rejects(repositories.messaging.comment(repositories.messaging.database, added.commentId), (error) => error.code === "COMPETITION_HISTORY_COMMENT_NOT_FOUND");
});

test("PostgreSQL-Messagingservice bestaetigt Einzel- und Sammelinbox idempotent", { timeout: 30_000 }, async (t) => {
  const { repositories } = await preparedRuntime(t);
  const published = [];
  const service = new PostgresMessagingService({ messaging: repositories.messaging, ops: repositories.ops, publish: (topic, data) => published.push({ topic, data }) });
  const principal = { id: "2", name: "Olivia Operator", role: "operator", roles: ["operator"] };
  await repositories.messaging.createEvent({
    contractId: "event-ack-service",
    eventType: "test.notice",
    operationId: "0199c800-0000-7000-8000-00000000f210",
    templateParameters: { subjectId: "m-seed", status: "ready" },
    recipients: ["2"],
  });
  const messageId = (await repositories.messaging.inbox("2")).find(({ eventId }) => eventId === "event-ack-service").id;
  const params = { operationId: "0199c800-0000-7000-8000-00000000f211", messageId };
  const first = await service.acknowledge(principal, params);
  assert.equal(first.changed, true);
  assert.equal(Number.isSafeInteger(first.acknowledgedAt), true);
  assert.equal((await service.acknowledge(principal, params)).repeated, true);
  const bulk = await service.acknowledgeAll(principal, { operationId: "0199c800-0000-7000-8000-00000000f212" });
  assert.equal(bulk.success, true);
  assert.equal(bulk.changedCount, 0);
  assert.equal(published.some(({ topic }) => topic === "messages:2"), true);
});

test("Identity-Session und Passworttausch laufen atomar und entfernen den alten Hash", { timeout: 30_000 }, async (t) => {
  const { cluster, repositories } = await preparedRuntime(t);
  const account = await repositories.identity.accountForLogin("player", { includeCredential: true });
  const session = await repositories.identity.createSession({
    accountId: account.accountId,
    authRevision: account.authRevision,
    loginSnapshot: account.login,
    ttlMs: 30 * 24 * 60 * 60 * 1000,
  });
  assert.equal((await repositories.identity.session(session.token)).personId, "3");

  const changed = await repositories.identity.replacePassword({
    accountId: account.accountId,
    expectedAuthRevision: account.authRevision,
    credentialSchema: "scrypt_v1",
    secretHash: "scrypt$v1$16384$8$1$replacement-salt$replacement-hash",
  });
  assert.equal(changed.authRevision, "2");
  assert.equal(await repositories.identity.session(session.token), null);

  const client = new Client(cluster.connectionConfig);
  await client.connect();
  try {
    const credentials = await client.query(`
      SELECT active, secret_hash, revoked_reason FROM identity.credentials
       WHERE account_id=$1::uuid ORDER BY created_at, id
    `, [account.accountId]);
    assert.equal(credentials.rows.length, 2);
    assert.deepEqual(credentials.rows[0], { active: false, secret_hash: null, revoked_reason: "replaced" });
    assert.equal(credentials.rows[1].active, true);
    assert.equal(credentials.rows[1].secret_hash.includes("replacement"), true);
  } finally {
    await client.end();
  }
});

test("PostgreSQL-Authservice fuehrt Login, Sessionrefresh und Passwortrotation ohne Legacy-Persistenz aus", { timeout: 30_000 }, async (t) => {
  const { repositories } = await preparedRuntime(t);
  const auth = new PostgresAuthService({
    repository: repositories.identity,
    rateLimitSecret: Buffer.alloc(32, 7),
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    sessionRefreshIntervalMs: 24 * 60 * 60 * 1000,
    sessionMaxPerUser: 10,
  });
  const legacyCredential = "a".repeat(64);
  const loggedIn = await auth.login({ login: "player", passwordHash: legacyCredential, ip: "127.0.0.1" });
  assert.equal(loggedIn.user.id, "3");
  assert.equal(loggedIn.user.role, "player");
  assert.equal(Number.isSafeInteger(loggedIn.session.expiresAt), true);
  assert.equal((await auth.getUserForToken(loggedIn.session.token)).principal.id, "3");

  const newCredential = "b".repeat(64);
  const changed = await auth.changeOwnPassword(loggedIn.session.token, legacyCredential, newCredential);
  assert.equal(changed.success, true);
  assert.equal(await auth.getUserForToken(loggedIn.session.token), null);
  assert.equal((await auth.getUserForToken(changed.session.token, { refreshSession: true })).user.id, "3");
  await auth.logout(changed.session.token);
  assert.equal(await auth.getUserForToken(changed.session.token), null);
  const playerAgain = await auth.login({ login: "player", passwordHash: newCredential, ip: "127.0.0.2" });
  assert.equal(playerAgain.user.id, "3");

  const adminCredential = "c".repeat(64);
  const adminAccount = await repositories.identity.accountForLogin("admin");
  await repositories.identity.replacePassword({
    accountId: adminAccount.accountId,
    expectedAuthRevision: adminAccount.authRevision,
    credentialSchema: "scrypt_v1",
    secretHash: await auth.createStoredPasswordHash(adminCredential),
  });
  const admin = await auth.login({ login: "admin", passwordHash: adminCredential, ip: "127.0.0.3" });
  assert.equal(admin.user.role, "admin");
  assert.equal((await auth.setPasswordSetupAllowed(admin.session.token, "3", true)).allowed, true);
  const setupCredential = "d".repeat(64);
  assert.equal((await auth.setupPassword("player", setupCredential)).success, true);
  await assert.rejects(auth.setupPassword("player", setupCredential), (error) => error.code === "PASSWORD_SETUP_INVALID");
  assert.equal((await auth.login({ login: "player", passwordHash: setupCredential, ip: "127.0.0.4" })).user.id, "3");
});

test("PostgreSQL-Praeferenzen erhalten leere Revisionen und alle Favoritenzieltypen idempotent", { timeout: 30_000 }, async (t) => {
  const { repositories } = await preparedRuntime(t);
  const service = new PostgresPreferenceService({ identity: repositories.identity, ops: repositories.ops });
  const favorites = [
    { type: "page", page: "index" },
    { type: "overlay", overlay: "profile-messages" },
    { type: "page", page: "Bewerbe", params: { history: "all" } },
    { type: "page", page: "Bewerbe", params: { history: "competition", id: "2" } },
    { type: "page", page: "RoundRobin", params: { id: "2", paarungslayout: 4 } },
    { type: "page", page: "bewerbsRaster", params: { id: "2" } },
    { type: "page", page: "hallzeiten", params: { id: "hall-seed" } },
    { type: "page", page: "navigator", params: { profil: "2" } },
  ];
  const operationId = "0199c800-0000-7000-8000-00000000f101";
  const first = await service.setUserFavorites("1", { operationId, expectedRevision: 1, favorites });
  assert.deepEqual(first, { success: true, favorites, revision: 2, repeated: false });
  const stored = await repositories.identity.userFavorites("1");
  assert.equal(stored.revision, 2);
  assert.deepEqual(stored.favorites.map(({ targetId, ...target }) => target), favorites);
  assert.equal(stored.updatedAt > 0, true);

  const emptied = await service.setUserFavorites("1", {
    operationId: "0199c800-0000-7000-8000-00000000f102",
    expectedRevision: 2,
    favorites: [],
  });
  assert.equal(emptied.revision, 3);
  assert.deepEqual(await repositories.identity.userFavorites("1"), { favorites: [], revision: 3, updatedAt: (await repositories.identity.userFavorites("1")).updatedAt });
  assert.deepEqual(await service.setUserFavorites("1", { operationId, expectedRevision: 1, favorites }), { success: true, favorites, revision: 2, repeated: true });
  await assert.rejects(service.setUserFavorites("1", {
    operationId: "0199c800-0000-7000-8000-00000000f103",
    expectedRevision: 1,
    favorites: [],
  }), (error) => error.code === "REVISION_CONFLICT" && error.status === 409);

  const target = { type: "overlay", overlay: "profile" };
  assert.deepEqual(await service.setUserStartPage("1", {
    operationId: "0199c800-0000-7000-8000-00000000f104",
    expectedRevision: 1,
    target,
  }), { success: true, target, revision: 2, repeated: false });
  const start = await repositories.identity.userStartPage("1");
  assert.deepEqual(start.target, target);
  assert.equal(start.revision, 2);
});

test("PostgreSQL-Frontenddiagnose erhaelt Settings- und Zielrevisionen ohne freie Payloadpersistenz", { timeout: 30_000 }, async (t) => {
  const { events, repositories } = await preparedRuntime(t);
  const service = await PostgresFrontendLoggingService.create({
    identityRepository: repositories.identity,
    appVersion: "test-version",
    now: () => Date.parse("2026-10-11T00:30:00.000Z"),
    log: (level, event, fields) => events.push({ level, event, fields }),
  });
  const initial = service.settingsSnapshot();
  assert.equal(initial.revision, 1);
  const settings = {
    ...initial,
    expectedRevision: initial.revision,
    enabled: true,
    includeAnonymous: true,
    sampleRatePercent: 100,
  };
  delete settings.revision;
  delete settings.maxTargetDurationMinutes;
  const updated = await service.updateSettings(settings);
  assert.equal(updated.revision, 2);
  assert.equal(service.getPolicy(null).enabled, true);

  const targetsRevision = service.targetsSnapshot().revision;
  const targeted = await service.setTarget({ expectedRevision: targetsRevision, personId: "3", level: "debug", durationMinutes: 60 }, { id: "1" });
  assert.equal(targeted.revision, targetsRevision + 1);
  assert.equal(service.getPolicy("3").targeted, true);
  const removed = await service.removeTarget({ expectedRevision: targeted.revision, personId: "3" });
  assert.deepEqual(removed, { personId: "3", removed: true, revision: targeted.revision + 1 });
  assert.equal(service.getPolicy("3").targeted, false);
  await assert.rejects(service.removeTarget({ expectedRevision: targetsRevision, personId: "2" }), (error) => error.code === "REVISION_CONFLICT");
});

test("Gemeinsame Transaktionsgrenze rollt Domaenenaenderungen vollstaendig zurueck", { timeout: 30_000 }, async (t) => {
  const { repositories, runtime } = await preparedRuntime(t);
  await assert.rejects(runtime.withTransaction("core.configuration.test", async (transaction) => {
    await transaction.query(`
      INSERT INTO core.configuration_entries(tenant_id, configuration_key, value)
      VALUES ($1::uuid, 'test.rollback', '{"written":true}'::jsonb)
    `, [runtime.context.tenantId]);
    throw Object.assign(new Error("EXPECTED_TEST_ABORT"), { code: "EXPECTED_TEST_ABORT" });
  }), (error) => error.code === "EXPECTED_TEST_ABORT");
  assert.equal(await repositories.core.configuration("test.rollback"), null);
});

test("PostgreSQL-Laufzeit verwendet LISTEN/NOTIFY ausschliesslich als verlierbaren Weckhinweis", { timeout: 30_000 }, async (t) => {
  const { cluster, runtime } = await preparedRuntime(t);
  let wake;
  const notified = new Promise((resolve) => { wake = resolve; });
  const unsubscribe = await runtime.listen("epiber_worker_wake", wake);
  assert.equal(runtime.status().listeners, 1);
  const client = new Client(cluster.connectionConfig);
  await client.connect();
  try {
    await client.query("SELECT pg_notify('epiber_worker_wake', '')");
    await Promise.race([notified, new Promise((_, reject) => setTimeout(() => reject(new Error("NOTIFY_TIMEOUT")), 2_000))]);
  } finally {
    await client.end();
    await unsubscribe();
  }
  assert.equal(runtime.status().listeners, 0);
});

test("Operations-Repository bindet Auditstart und Fachabschluss an kontrollierte Transaktionen", { timeout: 30_000 }, async (t) => {
  const { cluster, repositories } = await preparedRuntime(t);
  await assert.rejects(repositories.ops.startAudit({
    action: "identity.profile.update",
    before: { revision: "freie Personendaten" },
  }), (error) => error.code === "BEFORE_PROJECTION_VALUE_INVALID");
  await assert.rejects(repositories.ops.startAudit({ action: "identity.unregistered" }), (error) => error.code === "AUDIT_ACTION_NOT_REGISTERED");
  const operationId = "0199c800-0000-7000-8000-00000000aa01";
  const result = await repositories.ops.executeAudited({
    audit: {
      operationId,
      actorType: "user",
      actorPersonId: "1",
      action: "identity.profile.update",
      subjectType: "person",
      subjectId: "3",
      before: { revision: "1" },
    },
    transactionOperation: "identity.profile.update",
  }, async (transaction) => {
    await transaction.query("UPDATE identity.people SET revision=revision+1 WHERE tenant_id=$1::uuid AND contract_id='3'", ["0199c800-0000-7000-8000-000000000001"]);
    return { auditAfter: { revision: "2" }, changed: true };
  });
  assert.equal(result.changed, true);

  const client = new Client(cluster.connectionConfig);
  await client.connect();
  try {
    const audit = await client.query(`
      SELECT operation.status, operation.before_projection, operation.after_projection,
             array_agg(transition.transition ORDER BY transition.occurred_at) AS transitions
        FROM ops.audit_operations operation
        JOIN ops.audit_transitions transition ON transition.audit_operation_id=operation.id
       WHERE operation.operation_id=$1::uuid
       GROUP BY operation.id
    `, [operationId]);
    assert.equal(audit.rows[0].status, "success");
    assert.deepEqual(audit.rows[0].before_projection, { revision: "1" });
    assert.deepEqual(audit.rows[0].after_projection, { revision: "2" });
    assert.deepEqual(audit.rows[0].transitions, ["started", "success"]);
  } finally {
    await client.end();
  }
});

test("PostgreSQL-Auditadapter bindet bestehende Aktionen und entfernt private Projektionswerte", { timeout: 30_000 }, async (t) => {
  const { cluster, repositories } = await preparedRuntime(t);
  const adapter = new PostgresAuditAdapter({ ops: repositories.ops });
  const eventId = "0199c800-0000-7000-8000-00000000fa01";
  await adapter.record({
    eventId, actorType: "user", actorId: "1", actorName: "Ada Admin", role: "admin",
    action: "normalizePerson", targetType: "person", targetId: "2", targetName: "Olivia Operator",
    requestId: eventId, result: "started", before: { email: "private@example.test", role: "player" },
  });
  await adapter.record({
    eventId, actorType: "user", actorId: "1", actorName: "Ada Admin", role: "admin",
    action: "normalizePerson", targetType: "person", targetId: "2", targetName: "Olivia Operator",
    requestId: eventId, result: "success", after: { email: "changed@example.test", role: "player A" },
  });
  const client = new Client(cluster.connectionConfig);
  await client.connect();
  try {
    const stored = await client.query("SELECT action,status,before_projection,after_projection FROM ops.audit_operations WHERE operation_id=$1::uuid", [eventId]);
    assert.deepEqual(stored.rows[0], {
      action: "normalize_person",
      status: "success",
      before_projection: { email: "geaendert", role: "player" },
      after_projection: { email: "geaendert", role: "player A" },
    });
  } finally {
    await client.end();
  }
  assert.equal(adapter.status().open, 0);
});

test("Operations-Repository bindet Idempotenz an Akteur, Requesthash und kontrollierte Antwort", { timeout: 30_000 }, async (t) => {
  const { repositories, runtime } = await preparedRuntime(t);
  const operationId = "0199c800-0000-7000-8000-00000000dd01";
  const requestHash = Buffer.alloc(32, 9);
  const started = await repositories.ops.beginIdempotency({ operationId, actorPersonId: "1", command: "identity.profile.update", requestHash });
  assert.deepEqual(started, { repeated: false, status: "started", response: null, responseExpiresAt: null });
  await runtime.withTransaction("identity.profile.idempotent", async (transaction) => {
    await transaction.query("UPDATE identity.people SET revision=revision+1 WHERE tenant_id=$1::uuid AND contract_id='1'", [runtime.context.tenantId]);
    await repositories.ops.completeIdempotency(transaction, {
      operationId,
      command: "identity.profile.update",
      status: "success",
      response: { personId: "1", revision: "2" },
    });
  });
  const repeated = await repositories.ops.beginIdempotency({ operationId, actorPersonId: "1", command: "identity.profile.update", requestHash });
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.status, "success");
  assert.deepEqual(repeated.response, { personId: "1", revision: "2" });
  await assert.rejects(repositories.ops.beginIdempotency({ operationId, actorPersonId: "1", command: "identity.profile.update", requestHash: Buffer.alloc(32, 8) }), (error) => error.code === "IDEMPOTENCY_CONFLICT");
});

test("PostgreSQL-Spielbetrieb bindet Entry, Messaging, Audit und Idempotenz in eine Fachtransaktion", { timeout: 30_000 }, async (t) => {
  const { cluster, repositories } = await preparedRuntime(t);
  const service = new PostgresCompetitionService(repositories);
  const operationId = "0199c800-0000-7000-8000-00000000ee01";
  const principal = { type: "user", id: "3", name: "Peter Player", role: "player" };
  const first = await service.addEntry(principal, { operationId, bewerbId: "2" });
  assert.equal(first.success, true);
  assert.equal(first.alreadyPresent, false);
  assert.equal(first.repeated, false);
  const repeated = await service.addEntry(principal, { operationId, bewerbId: "2" });
  assert.deepEqual(repeated, { success: true, entryId: first.entryId, alreadyPresent: false, repeated: true });
  const removed = await service.removeEntry(principal, { operationId: "0199c800-0000-7000-8000-00000000ee02", bewerbId: "2" });
  assert.equal(removed.removed, true);
  assert.equal((await service.removeEntry(principal, { operationId: "0199c800-0000-7000-8000-00000000ee02", bewerbId: "2" })).repeated, true);
  const rejectedOperation = "0199c800-0000-7000-8000-00000000ee03";
  await assert.rejects(service.addEntry(principal, { operationId: rejectedOperation, bewerbId: "missing" }), (error) => error.code === "ENTRY_CONTEXT_NOT_FOUND");

  const client = new Client(cluster.connectionConfig);
  await client.connect();
  try {
    const state = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM play.competition_entries WHERE contract_id=$1) AS entries,
        (SELECT count(*)::integer FROM messaging.events WHERE source_operation_id IN ($2::uuid,'0199c800-0000-7000-8000-00000000ee02'::uuid)) AS events,
        (SELECT count(*)::integer FROM ops.outbox WHERE idempotency_key IN ('messaging:' || $2::text, 'messaging:0199c800-0000-7000-8000-00000000ee02')) AS outbox,
        (SELECT status FROM ops.audit_operations WHERE operation_id=$2::uuid) AS audit,
        (SELECT status FROM ops.idempotency_operations WHERE operation_id=$2::uuid) AS idempotency
    `, [first.entryId, operationId]);
    assert.deepEqual(state.rows[0], { entries: 1, events: 2, outbox: 2, audit: "success", idempotency: "success" });
    const rejected = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM messaging.events WHERE source_operation_id=$1::uuid) AS events,
        (SELECT status FROM ops.audit_operations WHERE operation_id=$1::uuid) AS audit,
        (SELECT status FROM ops.idempotency_operations WHERE operation_id=$1::uuid) AS idempotency
    `, [rejectedOperation]);
    assert.deepEqual(rejected.rows[0], { events: 0, audit: "failed", idempotency: "failed" });
  } finally {
    await client.end();
  }
});
