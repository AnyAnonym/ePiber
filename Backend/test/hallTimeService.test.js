const test = require("node:test");
const assert = require("node:assert/strict");
const { StateRepository } = require("../stateRepository.js");
const { HallTimeService } = require("../hallTimeService.js");

const admin = { id: "admin-1", name: "Admin", role: "admin", roles: ["admin"] };
const players = ["p1", "p2", "p3"].map((id, index) => ({ id, name: `Spieler ${index + 1}`, role: "player" }));
const operation = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function setup(start = Date.parse("2026-01-01T12:00:00Z")) {
  const repository = new StateRepository(":memory:"); repository.init();
  let now = start;
  const messages = [];
  const service = new HallTimeService({
    repository,
    now: () => now,
    messagingService: { ensureMessage: async (message) => { messages.push(message); } },
  });
  return { repository, service, messages, setNow: (value) => { now = value; } };
}

function gridRequest(revision, overrides = {}) {
  return {
    operationId: operation(1), expectedRevision: revision, name: "Winterhalle", description: "Regeln",
    mode: "equal", capacity: 1, waitlistEnabled: true, fairUse: { base: 1, extendedDays: 7, percent: 50, openDays: 2 },
    active: true, participantIds: players.map(({ id }) => id),
    slots: [{ date: "2026-01-20", start: "19:00", end: "21:00" }, { date: "2026-01-27", start: "19:00", end: "21:00" }],
    ...overrides,
  };
}

test("Fixplatz, Warteliste und atomisches Nachruecken bleiben nachvollziehbar", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0), names);
  const gridId = created.grid.id;
  const slotId = created.grid.slots[0].id;

  const first = await context.service.setBooking(players[0], { operationId: operation(2), gridId, slotId, selected: true });
  assert.equal(first.grid.entries[0].status, "confirmed");
  const second = await context.service.setBooking(players[1], { operationId: operation(3), gridId, slotId, selected: true });
  assert.deepEqual(second.grid.entries.find(({ personId }) => personId === "p2"), { slotId, personId: "p2", status: "waitlist", waitlistPosition: 1 });

  const removed = await context.service.setBooking(players[0], { operationId: operation(4), gridId, slotId, selected: false });
  assert.equal(removed.grid.entries.find(({ personId }) => personId === "p2").status, "confirmed");
  assert.equal(context.messages.length, 1);
  assert.match(context.messages[0].subject, /Fixplatz/);
  assert.deepEqual(context.service.history(players[1], gridId).entries.slice(0, 2).map(({ action }) => action), ["waitlist_promoted", "booking_removed"]);
  assert.throws(() => context.service.grid({ id: "other", role: "player" }, gridId), { code: "FORBIDDEN" });
  context.repository.close();
});

test("FairUse zaehlt Gruen und Gelb ueber alle Teilnehmer und oeffnet kalendertagsgenau", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, {
    mode: "fair_use", capacity: 3,
    slots: [{ date: "2026-01-20", start: "17:00", end: "19:00" }, { date: "2026-01-20", start: "19:00", end: "21:00" }],
  }), names);
  const gridId = created.grid.id;
  await context.service.setBooking(players[0], { operationId: operation(5), gridId, slotId: created.grid.slots[0].id, selected: true });
  await assert.rejects(
    context.service.setBooking(players[0], { operationId: operation(6), gridId, slotId: created.grid.slots[1].id, selected: true }),
    { code: "HALL_TIME_FAIR_USE_LIMIT" },
  );
  context.setNow(Date.parse("2026-01-17T23:00:00Z")); // 18.01. 00:00 in Wien, zwei Kalendertage vor dem ersten Termin
  const opened = await context.service.setBooking(players[0], { operationId: operation(7), gridId, slotId: created.grid.slots[1].id, selected: true });
  assert.equal(opened.grid.entries.filter(({ personId }) => personId === "p1").length, 2);
  context.repository.close();
});

test("Gleichberechtigte Neuverteilung ersetzt Zukunft und haelt Summendifferenz klein", () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, { capacity: 2 }), names);
  const distributed = context.service.distribute(admin, { operationId: operation(9), gridId: created.grid.id, expectedRevision: created.revision });
  const counts = players.map(({ id }) => distributed.grid.entries.filter(({ personId, status }) => personId === id && status === "confirmed").length);
  assert.equal(distributed.grid.entries.length, 4);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  assert.equal(context.service.history(admin, created.grid.id).entries.some(({ action }) => action === "distribution_replaced"), true);
  context.repository.close();
});

test("Nicht nachgerueckte Wartelistenplaetze werden nach Terminende rot", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, {
    slots: [{ date: "2026-01-02", start: "19:00", end: "21:00" }],
  }), names);
  const slotId = created.grid.slots[0].id;
  await context.service.setBooking(players[0], { operationId: operation(10), gridId: created.grid.id, slotId, selected: true });
  await context.service.setBooking(players[1], { operationId: operation(11), gridId: created.grid.id, slotId, selected: true });
  context.setNow(Date.parse("2026-01-02T20:01:00Z"));
  const after = context.service.grid(players[1], created.grid.id).grid;
  assert.equal(after.entries.some(({ personId }) => personId === "p2"), false);
  assert.equal(context.service.history(players[1], created.grid.id).entries[0].action, "waitlist_expired");
  context.repository.close();
});

test("An- und Abmeldung erzeugen ohne Nachruecken jeweils genau einen Historieneintrag", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, { capacity: 2 }), names);
  const slotId = created.grid.slots[0].id;
  await context.service.setBooking(players[0], { operationId: operation(12), gridId: created.grid.id, slotId, selected: true });
  await context.service.setBooking(players[0], { operationId: operation(13), gridId: created.grid.id, slotId, selected: false });
  const actions = context.service.history(players[0], created.grid.id).entries.map(({ action }) => action);
  assert.equal(actions.filter((action) => action === "booking_added").length, 1);
  assert.equal(actions.filter((action) => action === "booking_removed").length, 1);
  context.repository.close();
});
