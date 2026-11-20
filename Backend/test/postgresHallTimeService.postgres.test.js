"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { runMigrations } = require("../db/migrationRunner");
const { applyFullDevelSeed, applyTechnicalSeed } = require("../db/seedRunner");
const { createPostgresComponents } = require("../createPostgresComponents");
const { startPostgresTestCluster } = require("./postgresTestCluster");

test("PostgreSQL-Hallenraster erlaubt Teilnehmern fremde Buchungen mit unveraenderten Schutzregeln", { timeout: 30_000 }, async (t) => {
  const cluster = startPostgresTestCluster();
  t.after(() => cluster.stop());
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 6, output: () => {} });
  await applyTechnicalSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await applyFullDevelSeed({ connectionConfig: cluster.connectionConfig, asOf: "2026-10-12T00:00:00.000Z", output: () => {} });
  await runMigrations({ connectionConfig: cluster.connectionConfig, command: "up", targetGeneration: 8, output: () => {} });
  const components = await createPostgresComponents({
    connectionConfig: cluster.connectionConfig, expectedTenantCode: "devel-epiber", sourceInstance: "devel",
    rateLimitSecret: Buffer.alloc(32, 5), sessionTtlMs: 86400000, sessionRefreshIntervalMs: 3600000, sessionMaxPerUser: 10,
  });
  t.after(() => components.runtime.close());
  const service = components.hallTimeService;
  // The first date has already passed; later dates must remain editable.
  service.now = () => Date.parse("2099-01-15T12:00:00Z");
  const admin = { type: "user", id: "1", name: "Ada Admin", role: "admin" };
  const player = { type: "user", id: "2", name: "Olivia Operator", role: "player" };
  const outsider = { type: "user", id: "4", name: "Nicht zugeordnet", role: "player" };
  const database = components.repositories.venue.database;
  async function grid(overrides = {}) {
    const saved = await service.saveGrid(admin, {
      operationId: crypto.randomUUID(), expectedRevision: 0, name: `Test ${crypto.randomUUID()}`,
      description: "Berechtigungsregression", active: true, mode: "equal", capacity: 1,
      participantIds: ["1", "2", "3"], waitlistEnabled: true, maxWaitlistEntries: 1, publicJoinable: false,
      fairUse: { base: 1, extendedDays: 7, percent: 50, openDays: 2 },
      slots: ["2099-01-13", "2099-01-20", "2099-01-27"].map((date) => ({ date, start: "19:00", end: "21:00" })),
      ...overrides,
    });
    return saved.grid;
  }
  function booking(principal, value, index, personId, selected, operationId = crypto.randomUUID()) {
    return service.setBooking(principal, { operationId, gridId: value.id, slotId: value.slots[index].id, personId, selected });
  }

  await t.test("Fremde Abmeldung und eigene Anmeldung nach erstem Termin, Historie, Inbox und Idempotenz", async () => {
    const value = await grid();
    await booking(admin, value, 1, "3", true);
    const operationId = crypto.randomUUID();
    const removed = await booking(player, value, 1, "3", false, operationId);
    assert.equal(removed.grid.entries.length, 0);
    const repeated = await booking(player, value, 1, "3", false, operationId);
    assert.equal(repeated.repeated, true);
    assert.equal(repeated.revision, removed.revision);
    const own = await booking(player, value, 1, "2", true);
    assert.equal(own.grid.entries.find(({ personId }) => personId === "2").status, "confirmed");
    const history = await database.query(`SELECT history.actor_person_id=actor.id AS correct_actor,item.person_contract_id_snapshot AS target
      FROM venue.hall_time_history history JOIN identity.people actor ON actor.contract_id='2'
      JOIN venue.hall_time_history_items item ON item.history_id=history.id WHERE history.operation_id=$1::uuid`, [operationId]);
    assert.deepEqual(history.rows, [{ correct_actor: true, target: "3" }]);
    const events = await database.query(`SELECT summary_snapshot,actor_person_id=actor.id AS correct_actor
      FROM messaging.events event JOIN identity.people actor ON actor.contract_id='2'
      WHERE source_operation_id=$1::uuid`, [operationId]);
    assert.equal(events.rowCount, 1);
    assert.equal(events.rows[0].correct_actor, true);
    assert.match(events.rows[0].summary_snapshot, /entfernt/);
    assert.doesNotMatch(events.rows[0].summary_snapshot, /Administrator/);
    const inbox = await components.repositories.messaging.inbox("3", { limit: 100 });
    assert.ok(inbox.some((item) => item.eventType === "hall_time.booking.changed"));
  });

  await t.test("Teilnehmer darf andere anmelden und Warteliste rueckt atomar nach", async () => {
    const value = await grid();
    const added = await booking(player, value, 1, "3", true);
    assert.equal(added.grid.entries[0].status, "confirmed");
    await booking(player, value, 1, "2", true);
    const removed = await booking(player, value, 1, "3", false);
    assert.equal(removed.grid.entries.find(({ personId }) => personId === "2").status, "confirmed");
  });

  await t.test("Nichtteilnehmer, ausgetretene Akteure und nicht zugeordnete Zielpersonen bleiben gesperrt", async () => {
    const value = await grid();
    await booking(player, value, 1, "3", true);
    const revision = (await service.grid(player, value.id)).grid.revision;
    for (const [actor, target, selected] of [[outsider, "3", false], [outsider, "4", true], [player, "4", true]]) {
      await assert.rejects(booking(actor, value, 1, target, selected), { code: "FORBIDDEN" });
    }
    assert.equal((await service.grid(player, value.id)).grid.revision, revision);
    await database.query(`UPDATE venue.hall_time_grid_participants SET left_at=clock_timestamp()
      WHERE grid_id=(SELECT id FROM venue.hall_time_grids WHERE contract_id=$1)
      AND person_id=(SELECT id FROM identity.people WHERE contract_id='2')`, [value.id]);
    await assert.rejects(booking(player, value, 1, "3", false), { code: "FORBIDDEN" });
    // Admin corrections do not require the administrator to participate.
    const adminOnly = await grid({ participantIds: ["2", "3"] });
    await booking(admin, adminOnly, 1, "3", true);
  });

  await t.test("Vergangenheit bleibt fuer eigene und fremde Buchungen gesperrt, Admin darf korrigieren", async () => {
    const value = await grid();
    await booking(admin, value, 0, "3", true);
    await assert.rejects(booking(player, value, 0, "3", false), { code: "HALL_TIME_PAST_LOCKED" });
    await assert.rejects(booking(player, value, 0, "2", true), { code: "HALL_TIME_PAST_LOCKED" });
    await booking(admin, value, 0, "3", false);
    await booking(player, value, 1, "3", true);
    service.now = () => Date.parse("2099-01-20T20:00:00Z"); // Exact end, 21:00 Vienna.
    try {
      await assert.rejects(booking(player, value, 1, "3", false), { code: "HALL_TIME_PAST_LOCKED" });
    } finally { service.now = () => Date.parse("2099-01-15T12:00:00Z"); }
  });

  await t.test("Fair Use und Wartelistenlimit gelten auch fuer fremde Anmeldungen", async () => {
    const fair = await grid({ mode: "fair_use" });
    await booking(player, fair, 1, "3", true);
    await assert.rejects(booking(player, fair, 2, "3", true), { code: "HALL_TIME_FAIR_USE_LIMIT" });
    const waiting = await grid();
    await booking(admin, waiting, 1, "1", true);
    await booking(admin, waiting, 2, "1", true);
    await booking(player, waiting, 1, "3", true);
    await assert.rejects(booking(player, waiting, 2, "3", true), { code: "HALL_TIME_WAITLIST_LIMIT" });
    const full = await grid({ waitlistEnabled: false });
    await booking(admin, full, 1, "1", true);
    await assert.rejects(booking(player, full, 1, "3", true), { code: "HALL_TIME_SLOT_FULL" });
  });

  await t.test("Fehlgeschlagene Fremdbenachrichtigung rollt Buchung und Historie gemeinsam zurueck", async (t) => {
    const value = await grid();
    const operationId = crypto.randomUUID();
    const failure = new Error("simulated messaging failure");
    const mocked = t.mock.method(components.messagingService, "createDomainEvent", async () => { throw failure; });
    await assert.rejects(booking(player, value, 1, "3", true, operationId), (error) => error === failure);
    mocked.mock.restore();
    const unchanged = (await service.grid(player, value.id)).grid;
    assert.equal(unchanged.revision, value.revision);
    assert.equal(unchanged.entries.length, 0);
    const history = await database.query("SELECT 1 FROM venue.hall_time_history WHERE operation_id=$1::uuid", [operationId]);
    assert.equal(history.rowCount, 0);
    const retried = await booking(player, value, 1, "3", true, operationId);
    assert.equal(retried.grid.entries[0].status, "confirmed");
  });
});
