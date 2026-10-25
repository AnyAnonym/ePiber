"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { WebSocket } = require("ws");
const { applyBootstrap } = require("../db/bootstrap");
const { runMigrations } = require("../db/migrationRunner");
const { applyFullDevelSeed, applyTechnicalSeed } = require("../db/seedRunner");
const { createRuntimeRepositories } = require("../db/createRuntimeRepositories");
const { RuntimeDatabase } = require("../db/runtimeDatabase");
const { repairNavigation } = require("../db/repairNavigation");
const { PostgresAuthService } = require("../postgresAuthService");
const { PostgresCompetitionService } = require("../postgresCompetitionService");
const { PostgresPlayService } = require("../postgresPlayService");
const { PostgresProjectionService } = require("../postgresProjectionService");
const { PostgresProjectionLoader } = require("../postgresProjectionLoader");
const { PostgresPreferenceService } = require("../postgresPreferenceService");
const { PostgresFrontendLoggingService } = require("../postgresFrontendLoggingService");
const { PostgresMessagingService } = require("../postgresMessagingService");
const { PostgresAuditAdapter } = require("../postgresAuditAdapter");
const { IDEMPOTENCY_CONTRACTS, LEGACY_AUDIT_CONTRACTS } = require("../postgresRuntimeContracts");
const dataStore = require("../dataStore");
const { createPostgresComponents } = require("../createPostgresComponents");
const { createPostgresApplication } = require("../server");
const { matchCompletionFingerprint } = require("../matchRules");
const { headerIndex, headerOf } = require("../tableUtils");
const { validateTableValues } = require("../tableSchemas");
const { notificationChannels } = require("../messagingService");
const { projectPeopleNormalization } = require("../peopleNormalization");
const { startPostgresTestCluster } = require("./postgresTestCluster");

async function preparedRuntime(t, { messageEventContracts = {} } = {}) {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-11T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-11T00:00:00.000Z", output: () => {} });
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 8, output: () => {} });
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
      ...messageEventContracts,
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
  assert.equal(runtime.status().generation, 8);
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
  for (const method of ["entries", "matches", "rankings"]) {
    const expected = (await Promise.all(competitions.map(({ id }) => repositories.play[method](id)))).flat();
    const bulk = await repositories.play[method](null, { all: true });
    const ordered = (rows) => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(ordered(bulk), ordered(expected), method);
    await assert.rejects(repositories.play[method](null));
  }
});

test("Schmale Personen- und Hallenlisten wahren bestehende Ausgabe und Zugriffsrechte", { timeout: 30_000 }, async (t) => {
  const { repositories } = await preparedRuntime(t);
  const people = await repositories.identity.people();
  assert.deepEqual(await repositories.identity.publicPlayers(), people.map(({ id, firstName, lastName, active }) => ({ id, firstName, lastName, active })));
  assert.deepEqual(await repositories.identity.memberDirectory(), people.filter(({ active }) => active).map(({ id, firstName, lastName, birthDate, email, phone }) => ({ id, firstName, lastName, birthDate, email, phone })));
  const grids = await repositories.venue.hallTimeGridsDetailed();
  for (const personId of ["1", "3", "missing"]) {
    const summaries = await repositories.venue.hallTimeGridSummaries(personId);
    assert.deepEqual(summaries, grids.map(({ id, name, active, publicJoinable, mode, revision, participants }) => ({ id, name, active, publicJoinable, mode, revision, joined: participants.some(({ id }) => id === personId) })));
    assert.deepEqual(await repositories.venue.hallTimeGridSummaries(personId, "hall-seed"), summaries.filter(({ id }) => id === "hall-seed"));
  }
  assert.deepEqual(await repositories.venue.hallTimeGridSummaries("1", "missing"), []);
});

test("PostgreSQL-Projektionsservice erzeugt alle acht bestehenden Tabellenvertraege ohne Credentialprojektion", { timeout: 30_000 }, async (t) => {
  const { repositories } = await preparedRuntime(t);
  const tables = await new PostgresProjectionService(repositories).load();
  assert.deepEqual(Object.keys(tables).sort(), ["bewerbe", "bewerbsart", "entryList", "matches1", "matchtyp", "navigator", "players", "rlPlatzierung"].sort());
  for (const [name, values] of Object.entries(tables)) assert.doesNotThrow(() => validateTableValues(name, values), name);
  for (const row of tables.players.slice(1)) {
    const value = row[tables.players[0].indexOf("Notification")];
    assert.equal(notificationChannels(value).join("|"), value);
  }
  assert.equal(tables.rlPlatzierung.slice(1).every((row) => typeof row[0] === "string" && row[0].length > 0), true);
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
  await repositories.venue.database.query("UPDATE venue.navigation_presets SET contract_id=NULL WHERE tenant_id=$1::uuid", [repositories.venue.context.tenantId]);
  const withoutLegacyId = await new PostgresProjectionService(repositories).load();
  assert.match(withoutLegacyId.navigator[1][0], /^[0-9a-f-]{36}$/);
  assert.doesNotThrow(() => validateTableValues("navigator", withoutLegacyId.navigator));
  assert.equal((await new PostgresProjectionService(repositories).load()).navigator[1][0], withoutLegacyId.navigator[1][0]);
});

test("Navigatorreparatur erhaelt Profil, Reihenfolge und Platzaktionen atomar und auditiert", { timeout: 30_000 }, async (t) => {
  const { repositories, events } = await preparedRuntime(t);
  const { venue } = repositories;
  const database = venue.database;
  await database.query("DELETE FROM venue.navigation_presets WHERE tenant_id=$1::uuid", [venue.context.tenantId]);
  for (const [id, target, profile] of [["z", "OL-Platz-1", "1"], ["a", "OL-Platz-2", "1"], ["b", "OL-Platzaktivierung", "1"], ["c", "OL-Ergebnis", "1"], ["other", "OL-Platz-1", "2"]]) {
    await database.query(`INSERT INTO venue.navigation_presets(tenant_id,contract_id,profile_code,label,enabled,problem_code,legacy_target)
      VALUES($1::uuid,$2,$3,$2,false,'NAVIGATION_TARGET_INVALID',$4)`, [venue.context.tenantId, id, profile, target]);
  }
  const order = ["z", "a", "b", "c"];
  const log = (level, event, fields) => events.push({ level, event, fields });
  assert.equal((await repairNavigation({ venue, profile: "1", order, log })).changedCount, 5);
  assert.equal((await venue.navigationPresets("1"))[0].sortOrder, null);
  await assert.rejects(repairNavigation({ venue, profile: "1", order: ["z"], apply: true, log }), { code: "NAVIGATION_REPAIR_SOURCE_MISMATCH" });
  assert.equal((await venue.navigationPresets("1"))[0].enabled, false);
  assert.equal((await repairNavigation({ venue, profile: "1", order, apply: true, log })).changedCount, 5);
  const tables = await new PostgresProjectionService(repositories).load();
  assert.deepEqual(tables.navigator.slice(1, 5).map((row) => [row[0], row[2]]), [["z", "OL-Platz-1"], ["a", "OL-Platz-2"], ["b", "OL-Platzaktivierung"], ["c", ""]]);
  assert.deepEqual(tables.navigator.at(-1), ["other", "other", "OL-Platz-1", "2"]);
  await database.query(`INSERT INTO venue.navigation_presets(tenant_id,contract_id,profile_code,label,target_type,competition_id)
    SELECT $1::uuid,'group-target','2','Gruppenphase','competition',id FROM play.competitions WHERE contract_id='rr-1'`, [venue.context.tenantId]);
  const groupTables = await new PostgresProjectionService(repositories).load();
  assert.equal(groupTables.navigator.find((row) => row[0] === "group-target")[2], "RoundRobin.html?id=rr-1");
  assert.equal((await repairNavigation({ venue, profile: "1", order, apply: true, log })).changedCount, 0);
  const audit = await database.query("SELECT status FROM ops.audit_operations WHERE action='navigation.repair' ORDER BY started_at");
  assert.deepEqual(audit.rows.map(({ status }) => status), ["failed", "success", "success"]);
  assert.equal(events.some(({ event }) => event === "navigation_repair_completed"), true);
  const unknownVenue = { context: venue.context, database: { ...database, withTransaction(operation, ...args) {
    if (operation === "navigation.repair") throw Object.assign(new Error("simulated unknown commit"), { code: "DB_COMMIT_OUTCOME_UNKNOWN" });
    return database.withTransaction(operation, ...args);
  } } };
  await assert.rejects(repairNavigation({ venue: unknownVenue, profile: "1", order, apply: true, log }), { code: "DB_COMMIT_OUTCOME_UNKNOWN" });
  assert.equal((await database.query("SELECT status FROM ops.audit_operations WHERE action='navigation.repair' ORDER BY started_at DESC LIMIT 1")).rows[0].status, "unknown");
  await assert.rejects(database.query(`INSERT INTO venue.navigation_presets(tenant_id,label,target_type,page_key) VALUES($1::uuid,'Invalid','court_assignment','3')`, [venue.context.tenantId]), { code: "23514" });
});

test("PostgreSQL-Projektionsloader laedt alle Tabellen atomar und ohne Polling", { timeout: 30_000 }, async (t) => {
  const { repositories } = await preparedRuntime(t);
  dataStore.resetForTests();
  t.after(() => dataStore.resetForTests());
  const events = [];
  const loader = new PostgresProjectionLoader({
    projectionService: new PostgresProjectionService(repositories),
    dataStore,
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

test("PostgreSQL-Komposition liefert die vollstaendige aktivierbare Serverlaufzeit", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 8, output: () => {} });
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
  assert.equal(components.capabilities.serverReady, true);
  assert.deepEqual(components.capabilities.missing, []);
  assert.equal(typeof components.authService.login, "function");
  assert.equal(typeof components.competitionService.addEntry, "function");
  assert.equal(typeof components.messagingService.addCompetitionHistoryComment, "function");
  assert.equal(components.auditLogRepository.status().backend, "postgres");
  const principal = { type: "user", id: "1", name: "Ada Admin", role: "admin" };
  const assignedCourt = await components.courtService.assign(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fd01", court: "1", expectedRevision: 2,
    homePlayerIds: ["1"], guestPlayerIds: ["2"],
  });
  assert.deepEqual(assignedCourt.court.homePlayerIds, ["1"]);
  const repeatedAssignment = await components.courtService.assign(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fd01", court: "1", expectedRevision: 2,
    homePlayerIds: ["1"], guestPlayerIds: ["2"],
  });
  assert.equal(repeatedAssignment.repeated, true);
  const inactiveCourt = await components.courtService.setActive(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fd02", court: "1", expectedRevision: 3, active: false,
  });
  assert.equal(inactiveCourt.court.aktiv, 0);
  const hallGrid = await components.hallTimeService.grid(principal, "hall-seed");
  assert.equal(hallGrid.grid.entries.length, 2);
  const hallBooking = await components.hallTimeService.setBooking(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fd03", gridId: "hall-seed",
    slotId: hallGrid.grid.slots[0].id, personId: "1", selected: false,
  });
  assert.equal(hallBooking.grid.entries.some(({ personId }) => personId === "1"), false);
  assert.equal(hallBooking.grid.entries.find(({ personId }) => personId === "2").status, "confirmed");
  const savedGrid = await components.hallTimeService.saveGrid(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fd04", expectedRevision: hallBooking.revision, gridId: "hall-seed",
    name: "Synthetische Hallenzeit", description: "PostgreSQL", mode: "fair_use", capacity: 1,
    waitlistEnabled: true, maxWaitlistEntries: 2, publicJoinable: true,
    fairUse: { base: 1, extendedDays: 14, percent: 50, openDays: 7 }, active: true,
    participantIds: ["1", "2"], slots: hallBooking.grid.slots.map(({ id, date, start, end }) => ({ id, date, start, end })),
  });
  assert.equal(savedGrid.grid.publicJoinable, true);
  await components.hallTimeService.setBooking(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fc11", gridId: "hall-seed",
    slotId: hallGrid.grid.slots[0].id, personId: "1", selected: true,
  });
  await components.hallTimeService.setBooking(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fc12", gridId: "hall-seed",
    slotId: hallGrid.grid.slots[0].id, personId: "2", selected: false,
  });
  const hallEvents = await components.repositories.messaging.database.query(`SELECT event_type,summary_snapshot FROM messaging.events WHERE source_operation_id=$1::uuid ORDER BY event_type`, ["0199c800-0000-7000-8000-00000000fc12"]);
  assert.deepEqual(hallEvents.rows.map(row => row.event_type), ["hall_time.booking.changed", "hall_time.waitlist.promoted"]);
  assert.ok(hallEvents.rows[0].summary_snapshot.includes("entfernt"));
  assert.ok(hallEvents.rows[1].summary_snapshot.includes("nachgerückt"));
  await components.projectionLoader.refresh("play-service-test");
  const player = { type: "user", id: "2", name: "Olivia Operator", role: "player" };
  const match = await components.playService.addMatch(player, {
    operationId: "0199c800-0000-7000-8000-00000000fd05", bewerbId: "2", opponentId: "1",
  });
  assert.equal(match.newMatchId.startsWith("m-"), true);
  await components.playService.setMatchAppointment(player, {
    operationId: "0199c800-0000-7000-8000-00000000fd06", matchId: match.newMatchId, matchDate: "261011-1800",
  });
  const matchValues = dataStore.get("matches1"), matchHeader = headerOf(matchValues);
  const matchRow = matchValues.slice(1).find((row) => String(row[headerIndex(matchHeader, "id")]) === match.newMatchId);
  const completed = await components.playService.setMatchResult(player, {
    operationId: "0199c800-0000-7000-8000-00000000fd07", matchId: match.newMatchId,
    kind: "regular", result: "6-0/6-0", matchStart: "261011-1800", matchEnd: "261011-1900",
    expectedFingerprint: matchCompletionFingerprint(matchRow, matchHeader),
  });
  assert.equal(completed.completionType, "regular");
  const rankings = await components.repositories.play.rankings("2");
  assert.equal(rankings.find(({ personId }) => personId === "2").rank, 1);
  assert.equal(rankings.find(({ personId }) => personId === "1").rank, 2);
  const firstCompletedValues = dataStore.get("matches1"), firstCompletedHeader = headerOf(firstCompletedValues);
  const firstCompletedRow = firstCompletedValues.slice(1).find((row) => String(row[headerIndex(firstCompletedHeader, "id")]) === match.newMatchId);
  const corrected = await components.playService.setMatchResult(player, {
    operationId: "0199c800-0000-7000-8000-00000000fd0b", matchId: match.newMatchId,
    kind: "regular", result: "6-1/6-1", matchStart: "261011-1800", matchEnd: "261011-1900",
    expectedFingerprint: matchCompletionFingerprint(firstCompletedRow, firstCompletedHeader),
  });
  assert.equal(corrected.result, "6-1/6-1");
  await components.playService.adminSetMatchEnd(principal, {
    operationId: "0199c800-0000-7000-8000-00000000feff", matchId: match.newMatchId,
    expectedFingerprint: components.playService.cachedFingerprint(match.newMatchId).fingerprint,
    matchEnd: "261011-2000", reason: "Integrationstest Spielendeberichtigung",
  });
  const completedValues = dataStore.get("matches1"), completedHeader = headerOf(completedValues);
  const completedRow = completedValues.slice(1).find((row) => String(row[headerIndex(completedHeader, "id")]) === match.newMatchId);
  const cleared = await components.playService.adminClearMatchResult(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fd0a", matchId: match.newMatchId,
    expectedFingerprint: matchCompletionFingerprint(completedRow, completedHeader), reason: "Integrationstest Rücknahme",
  });
  assert.equal(cleared.cleared, true);
  const restoredRankings = await components.repositories.play.rankings("2");
  assert.equal(restoredRankings.find(({ personId }) => personId === "1").rank, 1);
  assert.equal(restoredRankings.find(({ personId }) => personId === "2").rank, 2);
  const resultFingerprint = () => {
    const values = dataStore.get("matches1"), header = headerOf(values);
    return matchCompletionFingerprint(values.slice(1).find((row) => String(row[headerIndex(header, "id")]) === match.newMatchId), header);
  };
  for (const [index, kind] of ["regular", "retirement"].entries()) {
    await assert.rejects(components.playService.setMatchResult(player, {
      operationId: `0199c800-0000-7000-8000-00000000fe0${index}`, matchId: match.newMatchId,
      kind, result: kind === "regular" ? "6-0/6-0" : "", losingSide: 1,
      matchStart: "261011-1200", matchEnd: "261011-1900", expectedFingerprint: resultFingerprint(),
    }), { code: "MATCH_DURATION_CONFIRMATION_REQUIRED" });
  }
  for (const [index, scheduledAt] of ["2026-10-01T10:00:00Z", "2099-10-01T10:00:00Z", null].entries()) {
    await components.repositories.venue.database.query("UPDATE play.matches SET scheduled_at=$2::timestamptz WHERE contract_id=$1", [match.newMatchId, scheduledAt]);
    await components.projectionLoader.refresh("walkover-test");
    const params = {
      operationId: `0199c800-0000-7000-8000-00000000fe1${index}`, matchId: match.newMatchId,
      kind: "walkover", losingSide: 1, expectedFingerprint: resultFingerprint(),
    };
    const result = await components.playService.setMatchResult(player, params);
    assert.equal(result.completionType, "walkover");
    const stored = await components.repositories.venue.database.query(`SELECT r.play_started_at,r.play_ended_at,r.walkover_at,
      (SELECT count(*)::int FROM play.match_result_sets WHERE result_id=r.id) AS sets
      FROM play.matches m JOIN play.match_results r ON r.id=m.current_result_id WHERE m.contract_id=$1`, [match.newMatchId]);
    assert.equal(stored.rows[0].play_started_at, null);
    assert.equal(stored.rows[0].play_ended_at, null);
    assert.ok(stored.rows[0].walkover_at);
    assert.equal(stored.rows[0].sets, 0);
    await components.playService.adminClearMatchResult(principal, {
      operationId: `0199c800-0000-7000-8000-00000000fe2${index}`, matchId: match.newMatchId,
      expectedFingerprint: resultFingerprint(), reason: "Walkover-Test Ruecknahme",
    });
  }
  await components.playService.adminSetRankingChallengeDate(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fe31", matchId: match.newMatchId,
    challengeDate: "261010-1200", reason: "Integrationstest Forderungsdatum",
  });
  await components.playService.adminDeleteRankingChallenge(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fe32", matchId: match.newMatchId,
    reason: "Integrationstest Forderungsloeschung",
  });
  const history = await components.messagingService.competitionHistory(principal, { bewerbId: "2", limit: 50 });
  const outcome = history.entries.find(entry => entry.type === "match.result.set" && entry.result !== "W.O.");
  assert.ok(history.entries.some(entry => entry.summary === "Olivia Operator (2) hat Ada Admin (1) gefordert."));
  assert.ok(history.entries.some(entry => entry.summary.includes("Olivia Operator und Ada Admin haben den Spieltermin")));
  assert.ok(history.entries.some(entry => entry.type === "match.end.corrected" && entry.summary.includes("Olivia Operator")));
  assert.ok(history.entries.some(entry => entry.type === "ranking_challenge_date_changed" && entry.summary.includes("10.10.2026, 12:00 Uhr")));
  assert.ok(history.entries.some(entry => entry.type === "ranking_challenge_deleted" && entry.detail.includes("Forderungsloeschung")));
  assert.ok(outcome.summary.includes("gewinnt"));
  assert.equal(outcome.result, "6-0/6-0");
  const walkovers = history.entries.filter(entry => entry.type.startsWith("match.result.") && entry.result === "W.O.");
  assert.equal(walkovers.length, 3);
  assert.ok(walkovers.every(entry => entry.summary === "Ada Admin gewinnt durch W.O. von Olivia Operator."));
  const inbox = await components.repositories.messaging.inbox("1", { limit: 100 });
  const won = inbox.find(entry => entry.legacySubject === "Match gewonnen: Synthetische Rangliste");
  assert.ok(won);
  assert.equal(won.legacyBody, "Du gewinnst durch W.O. von Olivia Operator.");
  const lost = (await components.repositories.messaging.inbox("2", { limit: 100 })).find(entry => entry.legacySubject === "Match verloren: Synthetische Rangliste");
  assert.equal(lost.legacyBody, "Du verlierst durch W.O.");
  const hallNotice = (await components.repositories.messaging.inbox("2", { limit: 100 })).find(entry => entry.eventType === "hall_time.waitlist.promoted");
  assert.match(hallNotice.legacyBody, /Hallenzeit.*nachgerückt/);
  assert.match(hallNotice.legacyBody, /Uhr/);
  const allHistory = await components.messagingService.competitionHistory(principal, { limit: 100 });
  assert.ok(allHistory.entries.every(entry => entry.competitionId));
  assert.ok(!allHistory.entries.some(entry => entry.id === hallNotice.eventId));
  const normalizedPerson = projectPeopleNormalization(dataStore.get("players")).people.find(({ id }) => id === "2");
  const normalization = await components.playService.normalizePerson(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fd08", personId: "2",
    expectedFingerprint: normalizedPerson.fingerprint, changes: { phone: "0043 660 123456" },
  });
  assert.equal(normalization.changedFieldCount, 1);
  const createdPerson = await components.playService.reconcilePerson(principal, {
    operationId: "0199c800-0000-7000-8000-00000000fd09", action: "create", externalId: "999999",
    values: { firstName: "Petra", lastName: "Postgres", active: "1", member: "player" },
  });
  assert.equal(Number(createdPerson.personId) > 3, true);
  const reportHallTimes = await components.hallTimeService.reportingSnapshot(0, Date.now() + 365 * 24 * 60 * 60 * 1000);
  const reportOptions = components.messagingService.messagingReportOptions({ deployment: "paj", hallTimes: reportHallTimes });
  assert.equal(reportOptions.options.some(({ __value }) => __value === "personal"), true);
  const report = await components.messagingService.messagingReport({
    fromMs: 0, toMs: Date.now() + 365 * 24 * 60 * 60 * 1000, deployment: "paj", selection: ["all"], hallTimes: reportHallTimes,
  });
  assert.equal(report.totals.totalCount > 0, true);
  assert.ok(report.messages.some(message => message.projectionType === "match.result.set" && message.isResult));
  assert.ok(report.messages.some(message => message.projectionType === "match.challenge.created" && message.isChallenge));
  assert.ok(report.messages.some(message => message.projectionType === "match.challenge.date_changed" && message.isDateChange));
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
  const deleteParams = { operationId: "0199c800-0000-7000-8000-00000000fc05", monitorId: provisioned.monitor.monitorId };
  await assert.rejects(components.monitorBroker.delete(principal, deleteParams), { code: "MONITOR_NOT_REVOKED", status: 409 });
  assert.equal((await components.repositories.venue.listMonitors()).some(({ monitorId }) => monitorId === deleteParams.monitorId), true);
  await components.monitorBroker.revoke(principal, { ...deleteParams, operationId: "0199c800-0000-7000-8000-00000000fc06" });
  assert.equal((await components.monitorBroker.delete(principal, deleteParams)).deleted, true);
  assert.equal((await components.monitorBroker.delete(principal, deleteParams)).repeated, true);
  assert.equal(components.monitorBroker.listMonitors().some(({ monitorId }) => monitorId === deleteParams.monitorId), false);
  assert.equal(components.monitorBroker.commandStatus.has(deleteParams.monitorId), false);
  await components.monitorBroker.refresh();
  assert.equal(components.monitorBroker.listMonitors().some(({ monitorId }) => monitorId === deleteParams.monitorId), false);
  assert.equal(await components.repositories.venue.monitorByToken(provisioned.monitor.token), null);
  const commands = await components.repositories.venue.database.query("SELECT count(*)::integer AS count FROM venue.monitor_commands WHERE command_id=$1::uuid", [navigated.commandId]);
  assert.equal(commands.rows[0].count, 0);
  await assert.rejects(components.monitorBroker.delete(principal, { ...deleteParams, operationId: "0199c800-0000-7000-8000-00000000fc07" }), { code: "MONITOR_NOT_FOUND" });
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

test("PostgreSQL-only Serverkomposition startet, wird ready und beendet Pool sowie Listener", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  let app, restarted;
  t.after(async () => {
    try { await app?.shutdown("test-cleanup"); await restarted?.shutdown("restart-cleanup"); }
    finally { cluster.stop(); }
  });
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 8, output: () => {} });
  const client = new Client(cluster.connectionConfig); await client.connect();
  await client.query("UPDATE venue.courts SET active=false; UPDATE venue.court_live_state SET active=false"); await client.end();
  app = await createPostgresApplication({
    connectionConfig: cluster.connectionConfig,
    env: { ...process.env, EPIBER_TENANT_CODE: "devel-epiber", EPIBER_AUTH_RATE_LIMIT_SECRET: Buffer.alloc(32, 7).toString("base64url") },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  await app.initialize();
  assert.equal(app.status().ready, true);
  assert.equal(app.status().components.postgres_runtime, true);
  const address = app.server.address(), base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${base}/api/session`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:8080" },
    body: JSON.stringify({ login: "player", passwordHash: "a".repeat(64) }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { headers: { Origin: "http://localhost:8080", Cookie: cookie } });
  const messages = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  socket.send(JSON.stringify({ type: "hello", v: 2, protocol: 2, clientId: "postgres-test", deviceId: "postgres-test", pageType: "index", appVersion: require("../package.json").version }));
  await new Promise((resolve, reject) => { const deadline = setTimeout(() => reject(new Error("WELCOME_TIMEOUT")), 2000); const timer = setInterval(() => { if (messages.some(({ type }) => type === "welcome")) { clearInterval(timer); clearTimeout(deadline); resolve(); } }, 5); });
  socket.send(JSON.stringify({ type: "request", v: 2, id: "postgres-scoreboard", endpoint: "getScoreboardCourts", params: {} }));
  await new Promise((resolve, reject) => { const deadline = setTimeout(() => reject(new Error("RESPONSE_TIMEOUT")), 2000); const timer = setInterval(() => { if (messages.some(({ type, id }) => type === "response" && id === "postgres-scoreboard")) { clearInterval(timer); clearTimeout(deadline); resolve(); } }, 5); });
  const response = messages.find(({ type, id }) => type === "response" && id === "postgres-scoreboard");
  assert.equal(response.data.success, true);
  assert.equal(response.data.courts["1"].matchId, "m-seed");
  const request = (ws, endpoint, params = {}) => new Promise((resolve, reject) => {
    const id = require("node:crypto").randomUUID();
    const timer = setTimeout(() => { ws.off("message", receive); reject(new Error("RPC_TIMEOUT")); }, 3000);
    function receive(raw) {
      const message = JSON.parse(raw.toString());
      if (message.type !== "response" || message.id !== id) return;
      clearTimeout(timer); ws.off("message", receive); resolve(message);
    }
    ws.on("message", receive);
    ws.send(JSON.stringify({ type: "request", v: 2, id, endpoint, params }));
  });
  assert.equal((await request(socket, "projectionStatus")).data.error.code, "FORBIDDEN");
  assert.equal((await request(socket, "refreshProjections", { operationId: "0199c800-0000-7000-8000-00000000fda1" })).data.error.code, "FORBIDDEN");
  socket.close();
  await new Promise((resolve) => socket.once("close", resolve));

  const identity = app.authService.repository;
  const account = await identity.accountForLogin("admin");
  await identity.replacePassword({ accountId: account.accountId, expectedAuthRevision: account.authRevision,
    credentialSchema: "scrypt_v1", secretHash: await app.authService.createStoredPasswordHash("c".repeat(64)) });
  const adminLogin = await fetch(`${base}/api/session`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:8080" },
    body: JSON.stringify({ login: "admin", passwordHash: "c".repeat(64) }),
  });
  assert.equal(adminLogin.status, 200);
  const adminSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { headers: {
    Origin: "http://localhost:8080", Cookie: adminLogin.headers.get("set-cookie").split(";", 1)[0],
  } });
  t.after(() => adminSocket.terminate());
  await new Promise((resolve, reject) => { adminSocket.once("open", resolve); adminSocket.once("error", reject); });
  const welcome = new Promise((resolve) => adminSocket.once("message", resolve));
  adminSocket.send(JSON.stringify({ type: "hello", v: 2, protocol: 2, clientId: "projection-admin", deviceId: "projection-admin", pageType: "servicebereich", appVersion: require("../package.json").version }));
  assert.equal(JSON.parse((await welcome).toString()).type, "welcome");
  const status = (await request(adminSocket, "projectionStatus")).data;
  assert.equal(status.success, true);
  assert.equal(status.lastSuccessfulRefreshAt, app.projectionLoader.lastCompletedAt);
  assert.deepEqual(Object.keys(status.tables).sort(), Object.keys(dataStore.getAll()).sort());
  assert.equal((await request(adminSocket, "refreshProjections", { operationId: "0199c800-0000-7000-8000-00000000fda2" })).data.tableCount, 8);

  const originalLoad = app.projectionLoader.projectionService.load;
  app.projectionLoader.projectionService.load = async () => { throw new Error("PRIVATE_DB_FAILURE_MUST_NOT_LEAK"); };
  const failed = await request(adminSocket, "refreshProjections", { operationId: "0199c800-0000-7000-8000-00000000fda3" });
  assert.equal(failed.data.error.code, "DATA_REFRESH_FAILED");
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_DB_FAILURE/);
  const failedStatus = (await request(adminSocket, "projectionStatus")).data;
  assert.equal(failedStatus.lastControlledFailure.code, "POSTGRES_PROJECTION_REFRESH_FAILED");
  assert.equal(app.status().ready, true);
  app.projectionLoader.projectionService.load = originalLoad;

  const recordAudit = app.auditLogRepository.record.bind(app.auditLogRepository);
  let failAuditFinish = true;
  app.auditLogRepository.record = async (entry) => {
    if (entry.action === "refreshProjections" && entry.result === "success" && failAuditFinish) {
      failAuditFinish = false;
      throw new Error("simulated audit finish failure");
    }
    return recordAudit(entry);
  };
  assert.equal((await request(adminSocket, "refreshProjections", { operationId: "0199c800-0000-7000-8000-00000000fda4" })).data.error.code, "WRITE_OUTCOME_UNKNOWN");
  app.auditLogRepository.record = recordAudit;
  const auditClient = new Client(cluster.connectionConfig); await auditClient.connect();
  let refreshAudits;
  try {
    refreshAudits = await auditClient.query(`SELECT operation.status,operation.before_projection,operation.after_projection,transition.error_code
      FROM ops.audit_operations operation JOIN ops.audit_transitions transition
        ON transition.audit_operation_id=operation.id AND transition.transition=operation.status
      WHERE operation.action='refresh_projections' ORDER BY operation.started_at`);
  } finally { await auditClient.end(); }
  assert.deepEqual(refreshAudits.rows.map(({ status }) => status), ["failed", "success", "failed", "unknown"]);
  assert.equal(refreshAudits.rows[0].error_code, "FORBIDDEN");
  assert.deepEqual(Object.keys(refreshAudits.rows[1].after_projection).sort(), ["changedTableCount", "refreshedAt", "tableCount"]);
  assert.equal(refreshAudits.rows[2].error_code, "DATA_REFRESH_FAILED");
  assert.equal(refreshAudits.rows[3].after_projection, null);
  adminSocket.close(); await new Promise((resolve) => adminSocket.once("close", resolve));
  await app.shutdown("test");
  assert.equal(app.status().shuttingDown, true);
  restarted = await createPostgresApplication({
    connectionConfig: cluster.connectionConfig,
    env: { ...process.env, EPIBER_TENANT_CODE: "devel-epiber", EPIBER_AUTH_RATE_LIMIT_SECRET: Buffer.alloc(32, 7).toString("base64url") },
  });
  await new Promise((resolve) => restarted.server.listen(0, "127.0.0.1", resolve));
  await restarted.initialize();
  const restartAddress = restarted.server.address();
  const session = await fetch(`http://127.0.0.1:${restartAddress.port}/api/session`, { headers: { Cookie: cookie } });
  assert.equal((await session.json()).authenticated, true);
  await restarted.shutdown("restart-test");
});

test("PostgreSQL-Read-only-Abnahme blockiert HTTP- und WebSocket-Writes vor Audit und Fachlogik", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 8, output: () => {} });
  const before = new Client(cluster.connectionConfig); await before.connect();
  await before.query("UPDATE venue.courts SET active=false; UPDATE venue.court_live_state SET active=false");
  const auditCount = Number((await before.query("SELECT count(*) FROM ops.audit_operations")).rows[0].count);
  await before.end();
  const app = await createPostgresApplication({
    connectionConfig: cluster.connectionConfig,
    writeMode: "read_only",
    env: { ...process.env, EPIBER_TENANT_CODE: "devel-epiber", EPIBER_AUTH_RATE_LIMIT_SECRET: Buffer.alloc(32, 7).toString("base64url") },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  await app.initialize();
  assert.equal(app.status().writeMode, "read_only");
  const address = app.server.address(), base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${base}/api/session`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:8080" },
    body: JSON.stringify({ login: "player", passwordHash: "a".repeat(64) }),
  });
  assert.equal(login.status, 503);
  assert.equal((await login.json()).error.code, "READ_ONLY_MODE");

  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { headers: { Origin: "http://localhost:8080" } });
  const messages = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  socket.send(JSON.stringify({ type: "hello", v: 2, protocol: 2, clientId: "readonly-test", deviceId: "readonly-test", pageType: "index", appVersion: require("../package.json").version }));
  await new Promise((resolve) => { const timer = setInterval(() => { if (messages.some(({ type }) => type === "welcome")) { clearInterval(timer); resolve(); } }, 5); });
  socket.send(JSON.stringify({ type: "request", v: 2, id: "readonly-write", endpoint: "setMyFavorites", params: {} }));
  await new Promise((resolve) => { const timer = setInterval(() => { if (messages.some(({ id }) => id === "readonly-write")) { clearInterval(timer); resolve(); } }, 5); });
  assert.equal(messages.find(({ id }) => id === "readonly-write").data.error.code, "READ_ONLY_MODE");
  socket.send(JSON.stringify({ type: "request", v: 2, id: "readonly-read", endpoint: "players", params: {} }));
  await new Promise((resolve) => { const timer = setInterval(() => { if (messages.some(({ id }) => id === "readonly-read")) { clearInterval(timer); resolve(); } }, 5); });
  assert.equal(messages.find(({ id }) => id === "readonly-read").data.success, true);
  socket.close(); await new Promise((resolve) => socket.once("close", resolve));
  await app.shutdown("readonly-test");
  const after = new Client(cluster.connectionConfig); await after.connect();
  assert.equal(Number((await after.query("SELECT count(*) FROM ops.audit_operations")).rows[0].count), auditCount);
  await after.end();
});

test("PostgreSQL-Read-only-Abnahme startet mit der minimalen app_readonly-Datenbankrolle", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  const prefix = "readonly_runtime", database = "readonly_runtime_test";
  const passwords = Object.fromEntries(
    ["migrator", "app", "worker", "monitor", "backup", "refresh", "app_readonly"].map((suffix) => [suffix, `runtime-${suffix}-password`]),
  );
  const prepared = await applyBootstrap({ adminConnectionConfig: cluster.connectionConfig, prefix, database, passwords, output: () => {} });
  const ownerConnection = {
    ...cluster.connectionConfig, database, user: prepared.names.migrator, password: passwords.migrator,
    options: `-c role=${prepared.names.owner}`,
  };
  await runMigrations({ connectionConfig: ownerConnection, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: ownerConnection, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: ownerConnection, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await runMigrations({ connectionConfig: ownerConnection, command: "up", targetGeneration: 8, output: () => {} });
  await applyBootstrap({ adminConnectionConfig: cluster.connectionConfig, prefix, database, passwords, output: () => {} });
  const readOnlyPassword = passwords.app_readonly;
  const app = await createPostgresApplication({
    connectionConfig: { ...cluster.connectionConfig, database, user: prepared.names.app_readonly, password: readOnlyPassword },
    writeMode: "read_only",
    env: { ...process.env, EPIBER_TENANT_CODE: "devel-epiber", EPIBER_AUTH_RATE_LIMIT_SECRET: Buffer.alloc(32, 8).toString("base64url") },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  await app.initialize();
  assert.equal(app.status().ready, true);
  assert.equal(app.status().writeMode, "read_only");
  await app.shutdown("readonly-role-test");
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

test("PostgreSQL-Meldungssnapshots sind empfaengerspezifisch, idempotent und atomar", { timeout: 30_000 }, async (t) => {
  const { repositories, events } = await preparedRuntime(t);
  const message = {
    contractId: "event-personal", eventType: "test.notice", operationId: "0199c800-0000-7000-8000-00000000ab01",
    templateParameters: { subjectId: "m-seed", status: "ready" }, competitionId: "2", matchId: "m-seed",
    participants: [{ personId: "1", role: "winner" }, { personId: "2", role: "loser" }], recipients: ["1", "2"],
    summary: "Ada gewinnt gegen Olivia.",
    recipientMessages: [{ personId: "1", subject: "Gewonnen", body: "Du gewinnst. Ergebnis: 6-2/6-4." }, { personId: "2", subject: "Verloren", body: "Du verlierst. Ergebnis: 2-6/4-6." }],
  };
  assert.equal((await repositories.messaging.createEvent(message)).duplicate, false);
  assert.equal((await repositories.messaging.createEvent(message)).duplicate, true);
  const stored = (await repositories.messaging.inbox("2")).find(entry => entry.eventId === message.contractId);
  assert.equal(stored.legacyBody, message.recipientMessages[1].body);
  const service = new PostgresMessagingService({ messaging: repositories.messaging, ops: repositories.ops });
  assert.equal((await service.message({ id: "2" }, stored.id)).message.body, message.recipientMessages[1].body);
  assert.equal((await service.messages({ id: "2" }, { limit: 20 })).messages.find(entry => entry.id === stored.id).subject, "Verloren");
  await assert.rejects(repositories.messaging.createEvent({ ...message, recipientMessages: [{ ...message.recipientMessages[0], body: "Anderer Text" }] }), { code: "MESSAGE_OPERATION_CONFLICT" });
  await assert.rejects(repositories.messaging.createEvent({ ...message, recipientMessages: [] }), { code: "MESSAGE_OPERATION_CONFLICT" });
  await assert.rejects(repositories.messaging.createEvent({ ...message, recipientMessages: [{ personId: "3", subject: "Falsch", body: "Kein Empfaenger" }] }), { code: "MESSAGE_RECIPIENTS_INVALID" });
  await assert.rejects(repositories.messaging.createEvent({ ...message, recipientMessages: null }), { code: "MESSAGE_RECIPIENTS_INVALID" });
  await assert.rejects(repositories.messaging.createEvent({ ...message, contractId: "event-failed", operationId: "0199c800-0000-7000-8000-00000000ab02", recipients: ["1", "missing"], recipientMessages: [] }), { code: "MESSAGE_RECIPIENT_NOT_FOUND" });
  assert.ok(!(await repositories.messaging.competitionHistory("2", { limit: 100 })).events.some(entry => entry.id === "event-failed"));
  const logged = JSON.stringify(events);
  assert.ok(!logged.includes("Du gewinnst") && !logged.includes("Du verlierst") && !logged.includes("Anderer Text"));
  assert.ok(events.some(entry => entry.event === "postgres_messaging_event_completed" && entry.fields.result === "failed"));
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

  for (const member of ["player A", "player B"]) {
    await repositories.identity.database.query(`UPDATE identity.memberships SET classification=$2
      WHERE person_id=(SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id='3') AND valid_until IS NULL`, [repositories.identity.context.tenantId, member]);
    const existingSession = await auth.getUserForToken(loggedIn.session.token);
    assert.equal(existingSession.user.member, member);
    assert.equal(existingSession.user.role, member);
    assert.equal(existingSession.principal.roles.includes("player"), true);
    const newLogin = await auth.login({ login: "player", passwordHash: legacyCredential, ip: "127.0.0.1" });
    assert.equal(newLogin.user.member, member);
    assert.equal((await auth.requireRole(newLogin.session.token, ["player", "player a", "player b", "admin"])).principal.id, "3");
    await assert.rejects(auth.requireRole(newLogin.session.token, ["admin"]), { code: "FORBIDDEN" });
    await assert.rejects(auth.requireRole(newLogin.session.token, ["operator"]), { code: "FORBIDDEN" });
    await auth.logout(newLogin.session.token);
  }

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
  await assert.rejects(repositories.ops.beginIdempotency({ operationId, actorPersonId: "1", command: "identity.profile.update", requestHash: Buffer.alloc(32, 8) }), (error) => error.code === "IDEMPOTENCY_CONFLICT" && error.status === 409);
});

test("PostgreSQL-KO-Adminwarnung ist privat, atomar, idempotent und auf fehlende Folgematches begrenzt", { timeout: 30_000 }, async (t) => {
  const { MESSAGE_EVENT_CONTRACTS } = require("../postgresRuntimeContracts");
  const { randomUUID } = require("node:crypto");
  const { repositories, events } = await preparedRuntime(t, { messageEventContracts: MESSAGE_EVENT_CONTRACTS });
  const db = repositories.play.database, tenantId = repositories.play.context.tenantId;
  await db.query(`INSERT INTO identity.tenant_role_assignments(tenant_id,person_id,role_code)
    SELECT tenant_id,id,'admin' FROM identity.people WHERE tenant_id=$1::uuid AND contract_id IN ('3','4','5')`, [tenantId]);
  await db.query(`UPDATE identity.tenant_role_assignments SET revoked_at=clock_timestamp()
    WHERE person_id=(SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id='5') AND role_code='admin'`, [tenantId]);
  await db.query(`UPDATE play.match_participants SET participant_type='person',person_id=(SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id='1')
    WHERE match_id=(SELECT id FROM play.matches WHERE contract_id='ko-open') AND position_no=1
    AND side_id=(SELECT id FROM play.match_sides WHERE match_id=(SELECT id FROM play.matches WHERE contract_id='ko-open') AND side_no=1)`, [tenantId]);
  const loader = new PostgresProjectionLoader({ projectionService: new PostgresProjectionService(repositories), dataStore });
  await loader.initialLoad();
  const logs = [];
  const service = new PostgresPlayService({ ...repositories, projectionLoader: loader, log: (level, event, fields) => logs.push({ level, event, fields }) });
  const admin = { type: "user", id: "1", name: "Ada Admin", role: "admin" };
  const player = { type: "user", id: "2", name: "Olivia Operator", role: "player" };
  const params = () => ({ operationId: randomUUID(), matchId: "ko-open", kind: "walkover", losingSide: 2, expectedFingerprint: service.cachedFingerprint("ko-open").fingerprint });
  const warnings = async () => (await db.query("SELECT * FROM messaging.events WHERE event_type='ko_progression_required'")).rows;
  const clear = async () => service.adminClearMatchResult(admin, { operationId: randomUUID(), matchId: "ko-open", reason: "Test Ruecknahme", expectedFingerprint: service.cachedFingerprint("ko-open").fingerprint });

  // A final never expects a successor.
  assert.equal((await service.setMatchResult(player, params())).warningCode, undefined);
  assert.equal((await warnings()).length, 0);
  await clear();
  await db.query("UPDATE play.matches SET round_code='HF-P1' WHERE contract_id='ko-open'");
  await loader.refresh("missing-ko-test");
  const missing = params();
  const saved = await service.setMatchResult(player, missing);
  assert.equal(saved.warningCode, "KO_TARGET_MISSING");
  const repeated = await service.setMatchResult(player, missing);
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.warningCode, "KO_TARGET_MISSING");
  assert.equal((await warnings()).length, 1);
  const notice = (await repositories.messaging.inbox("1", { limit: 100 })).find(row => row.eventType === "ko_progression_required");
  assert.ok(notice);
  assert.equal(notice.competitionId, null);
  assert.equal(notice.readAt, null); // also unread if the administrator is the actor
  assert.equal(notice.acknowledgedAt, null);
  assert.match(notice.legacySubject, /KO-Fortschreibung erforderlich/);
  assert.match(notice.legacyBody, /Finale.*fehlt/);
  assert.equal((await repositories.messaging.inbox("2", { limit: 100 })).some(row => row.eventType === "ko_progression_required"), false);
  assert.equal((await repositories.messaging.inbox("3", { limit: 100 })).some(row => row.eventType === "ko_progression_required"), true);
  for (const id of ["4", "5"]) assert.equal((await repositories.messaging.inbox(id, { limit: 100 })).some(row => row.eventType === "ko_progression_required"), false);
  assert.equal((await warnings())[0].match_id, null);
  await service.setMatchResult(admin, params()); // correction creates one further notice
  assert.equal((await warnings()).length, 2);
  await clear();
  assert.equal((await warnings()).length, 2);

  // A message failure rolls back the result, history and idempotency together.
  const createEvent = repositories.messaging.createEvent.bind(repositories.messaging);
  repositories.messaging.createEvent = async (values, transaction) => {
    if (values.eventType === "ko_progression_required") throw Object.assign(new Error("Test failure"), { code: "MESSAGE_TEST_FAILURE" });
    return createEvent(values, transaction);
  };
  const failed = params();
  await assert.rejects(service.setMatchResult(player, failed), { code: "MESSAGE_TEST_FAILURE" });
  assert.equal((await db.query("SELECT current_result_id FROM play.matches WHERE contract_id='ko-open'")).rows[0].current_result_id, null);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM play.match_result_history WHERE operation_id=$1::uuid", [failed.operationId])).rows[0].count, 0);
  repositories.messaging.createEvent = createEvent;
  assert.equal((await service.setMatchResult(player, failed)).warningCode, "KO_TARGET_MISSING");
  await clear();

  // Inactive or revoked administrators must not receive new notices.
  await db.query("UPDATE identity.people SET active=false WHERE tenant_id=$1::uuid AND contract_id IN ('1','3')", [tenantId]);
  const before = (await warnings()).length;
  assert.equal((await service.setMatchResult(player, params())).warningCode, "KO_TARGET_MISSING");
  assert.equal((await warnings()).length, before);
  assert.ok(logs.some(row => row.event === "ko_progression_admin_notification_skipped" && row.fields.reason === "NO_ACTIVE_ADMINISTRATORS"));
  assert.ok(events.some(row => row.event === "postgres_messaging_event_completed" && row.fields.eventType === "ko_progression_required" && row.fields.result === "success"));
  assert.equal(JSON.stringify(logs).includes("Ada Admin"), false);
  await clear();
  await db.query("UPDATE identity.people SET active=true WHERE tenant_id=$1::uuid AND contract_id IN ('1','3')", [tenantId]);
  await db.query(`UPDATE play.match_participants SET participant_type='person',person_id=(SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id='3')
    WHERE match_id=(SELECT id FROM play.matches WHERE contract_id='ko-bye') AND participant_type='bye'`, [tenantId]);
  await loader.refresh("linked-ko-test");
  const linked = await service.setMatchResult(admin, { ...params(), matchId: "ko-bye", expectedFingerprint: service.cachedFingerprint("ko-bye").fingerprint });
  assert.equal(linked.warningCode, undefined);
  assert.equal((await warnings()).length, before);
  const target = await service.participants(db, (await db.query("SELECT id FROM play.matches WHERE contract_id='ko-open'")).rows[0].id);
  assert.equal(target.find(person => person.side_no === 1).person_id, "1");
  for (const match of [
    { competition_type_id: "2", bracket_size: 4, round_code: "HF-P1" },
    { competition_type_id: "rr", bracket_size: 4, round_robin: true, round_code: "G1" },
    { competition_type_id: "ko", bracket_size: null, round_code: "HF-P1" },
  ]) assert.equal(await service.missingKoTargetMessage(null, admin, {}, match), false);
});

test("PostgreSQL-Neueinstieg persistiert Ranggrenze, Folgeversuche, Jahresfrist und reversible Einreihung", { timeout: 30_000 }, async (t) => {
  const { MESSAGE_EVENT_CONTRACTS } = require("../postgresRuntimeContracts");
  const { repositories } = await preparedRuntime(t, { messageEventContracts: MESSAGE_EVENT_CONTRACTS });
  const db = repositories.play.database;
  await db.query("UPDATE play.competitions SET competition_end_date=NULL WHERE contract_id='2'");
  await db.query(`INSERT INTO identity.people(tenant_id,contract_id,first_name,last_name,active)
    SELECT $1::uuid,n::text,'Test','Einsteiger',true FROM generate_series(99,127) n`, [repositories.play.context.tenantId]);
  await db.query(`INSERT INTO play.ranking_entries(competition_id,person_id,status,rank)
    SELECT c.id,p.id,'active',p.contract_id::int-97 FROM play.competitions c
    JOIN identity.people p ON p.tenant_id=$1::uuid AND p.contract_id::int BETWEEN 100 AND 127 WHERE c.contract_id='2'`, [repositories.play.context.tenantId]);
  const loader = new PostgresProjectionLoader({ projectionService: new PostgresProjectionService(repositories), dataStore });
  await loader.initialLoad();
  let now = Date.now();
  const service = new PostgresPlayService({ ...repositories, projectionLoader: loader, now: () => now });
  const player = { type: "user", id: "99", name: "Test", role: "player" };
  const admin = { type: "user", id: "1", name: "Admin", role: "admin" };
  const { randomUUID } = require("node:crypto");
  const fingerprint = (id) => {
    const values = dataStore.get("matches1"), header = headerOf(values);
    return matchCompletionFingerprint(values.slice(1).find(row => row[headerIndex(header, "id")] === id), header);
  };
  const challenge = async (opponentId) => (await service.addMatch(player, { operationId: randomUUID(), bewerbId: "2", opponentId })).newMatchId;
  const finish = async (matchId, losingSide) => service.setMatchResult(player, { operationId: randomUUID(), matchId, kind: "walkover", losingSide, expectedFingerprint: fingerprint(matchId) });
  const clear = async (matchId) => service.adminClearMatchResult(admin, { operationId: randomUUID(), matchId, reason: "Test Ruecknahme", expectedFingerprint: fingerprint(matchId) });
  const first = await challenge("105"); // rank 8 -> minimum rank 18
  await finish(first, 1);
  let state = service.rankingChallengeState(player, "2");
  assert.equal(state.mode, "newcomer");
  assert.equal(state.entryRestriction.minimumRank, 18);
  assert.equal(state.entryRestriction.active, true);
  const firstExpiry = state.entryRestriction.expiresAt;
  assert.equal(service.challengeEligibility(player, "2", "105").allowed, false);
  const eligibility = service.challengeEligibility.bind(service);
  service.challengeEligibility = () => ({ allowed: true });
  await assert.rejects(challenge("105"), { code: "CHALLENGE_NOT_ALLOWED" });
  service.challengeEligibility = eligibility;
  now += 8 * 24 * 60 * 60 * 1000;
  assert.equal(service.challengeEligibility(player, "2", "114").allowed, false); // rank 17
  assert.equal(service.challengeEligibility(player, "2", "115").allowed, true); // rank 18
  // A fresh service and fresh DB projection retain the same restriction.
  await loader.refresh("restart-test");
  const fresh = new PostgresPlayService({ ...repositories, projectionLoader: loader, now: () => now });
  assert.equal(fresh.rankingChallengeState(player, "2").entryRestriction.minimumRank, 18);
  const second = await challenge("115");
  await finish(second, 1);
  assert.equal(service.rankingChallengeState(player, "2").entryRestriction.minimumRank, 28);
  await clear(second);
  assert.equal(service.rankingChallengeState(player, "2").entryRestriction.minimumRank, 18);
  await service.adminDeleteRankingChallenge(admin, { operationId: randomUUID(), matchId: second, reason: "Test Forderung entfernen" });
  now = firstExpiry;
  assert.equal(service.rankingChallengeState(player, "2").entryRestriction.active, false);
  assert.equal(service.challengeEligibility(player, "2", "105").allowed, true);
  // Returning to the first loss and correcting to a win exercises inserted IDs,
  // correction reversal and deletion of the newly inserted ranking row.
  now = Date.now();
  await finish(first, 2);
  assert.equal((await repositories.play.rankings("2")).find(row => row.personId === "99").rank, 8);
  await clear(first);
  assert.equal((await repositories.play.rankings("2")).some(row => row.personId === "99"), false);
  await service.adminDeleteRankingChallenge(admin, { operationId: randomUUID(), matchId: first, reason: "Test Forderung entfernen" });
  // Target 35 is absent: immediate placement at the end, not a negative rank.
  const last = await challenge("122"); // rank 25
  await finish(last, 1);
  const ranks = await repositories.play.rankings("2");
  assert.equal(ranks.find(row => row.personId === "99").rank, 31);
  assert.equal(new Set(ranks.filter(row => row.status === "active").map(row => row.rank)).size, 31);
  await clear(last);
  assert.equal((await repositories.play.rankings("2")).some(row => row.personId === "99"), false);
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
  const entryMessages = (await repositories.messaging.inbox("3")).filter(entry => entry.eventType.startsWith("competition.entry."));
  assert.equal(entryMessages.length, 2);
  assert.ok(entryMessages.every(entry => entry.legacySubject.includes("Synthetische Rangliste") && entry.legacyBody.includes("Bewerb Synthetische Rangliste")));
  const rejectedOperation = "0199c800-0000-7000-8000-00000000ee03";
  await assert.rejects(service.addEntry(principal, { operationId: rejectedOperation, bewerbId: "missing" }), (error) => error.code === "ENTRY_CONTEXT_NOT_FOUND");

  const client = new Client(cluster.connectionConfig);
  await client.connect();
  try {
    const state = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM play.competition_entries WHERE contract_id=$1) AS entries,
        (SELECT count(*)::integer FROM messaging.events WHERE source_operation_id IN ($2::uuid,'0199c800-0000-7000-8000-00000000ee02'::uuid)) AS events,
         (SELECT count(*)::integer FROM ops.outbox WHERE idempotency_key IN ('messaging:' || $2::text || ':competition.entry.created', 'messaging:0199c800-0000-7000-8000-00000000ee02:competition.entry.withdrawn')) AS outbox,
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
