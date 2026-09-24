const test = require("node:test");
const assert = require("node:assert/strict");
const { StateRepository } = require("../stateRepository.js");
const { HallTimeService } = require("../hallTimeService.js");
const { MessagingRepository } = require("../messagingRepository.js");
const { MessagingService } = require("../messagingService.js");

const admin = { id: "admin-1", name: "Admin", role: "admin", roles: ["admin"] };
const players = ["p1", "p2", "p3"].map((id, index) => ({ id, name: `Spieler ${index + 1}`, role: "player" }));
const operation = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function setup(start = Date.parse("2026-01-01T12:00:00Z"), overrides = {}) {
  const repository = new StateRepository(":memory:"); repository.init();
  let now = start;
  const messages = [];
  const logs = [];
  const service = new HallTimeService({
    repository,
    now: () => now,
    messagingService: overrides.messagingService || { ensureMessage: async (message) => { messages.push(message); } },
    log: (level, event, fields) => logs.push({ level, event, fields }),
  });
  return { repository, service, messages, logs, setNow: (value) => { now = value; } };
}

function gridRequest(revision, overrides = {}) {
  return {
    operationId: operation(1), expectedRevision: revision, name: "Winterhalle", description: "Regeln",
    mode: "equal", capacity: 1, waitlistEnabled: true, fairUse: { base: 1, extendedDays: 7, percent: 50, openDays: 2 },
    maxWaitlistEntries: 2, publicJoinable: false,
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
  assert.equal(context.messages[0].subject, "Du bist auf einen Fixplatz nachgerückt");
  assert.equal(context.messages[0].contextName, "Winterhalle");
  assert.deepEqual(context.service.history(players[1], gridId).entries.slice(0, 2).map(({ action }) => action), ["waitlist_promoted", "booking_removed"]);
  const report = context.service.reportingSnapshot(0, Date.parse("2026-02-01T00:00:00Z"), names);
  assert.deepEqual(report.grids, [{ id: gridId, name: "Winterhalle" }]);
  assert.equal(report.entries.some(({ action, gridName, personName, summary }) => action === "waitlist_promoted" && gridName === "Winterhalle" && personName === "Spieler 2" && summary.includes("nachgerückt")), true);
  assert.deepEqual(context.service.reportingSnapshot(Date.parse("2026-02-01T00:00:00Z"), Date.parse("2026-03-01T00:00:00Z")).entries, []);
  assert.throws(() => context.service.grid({ id: "other", role: "player" }, gridId), { code: "FORBIDDEN" });
  context.repository.close();
});

test("FairUse zaehlt Gruen und Gelb und oeffnet kalendertagsgenau", async () => {
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
  const history = context.service.history(admin, created.grid.id).entries;
  const distribution = history.find(({ action }) => action === "distribution_replaced");
  assert.equal(distribution.batchId, operation(9));
  assert.deepEqual(distribution.summary, {
    slotCount: 2, assignedCount: 4, promotedCount: 0, removedCount: 0, unchangedCount: 0,
  });
  assert.equal(distribution.changes.length, 4);
  assert.equal(distribution.changes.every(({ from, to, slot }) => from === "red" && to === "confirmed" && slot.date), true);
  const reversed = new Map(distributed.grid.entries.map((entry) => [JSON.stringify([entry.slotId, entry.personId]), entry.status]));
  for (const change of distribution.changes) {
    const key = JSON.stringify([change.slotId, change.personId]);
    if (change.from === "red") reversed.delete(key); else reversed.set(key, change.from);
  }
  assert.deepEqual([...reversed], []);
  assert.equal(Object.hasOwn(context.service.history(players[0], created.grid.id).entries.find(({ action }) => action === "distribution_replaced"), "changes"), false);
  assert.equal(history.some(({ action }) => action === "assigned_by_distribution"), false);
  const distributionLog = context.logs.find(({ event, fields }) => event === "hall_time_history_recorded" && fields.action === "distribution_replaced");
  assert.equal(distributionLog.fields.changeCount, 4);
  assert.equal(distributionLog.fields.assignedCount, 4);
  assert.equal(Object.hasOwn(distributionLog.fields, "personName"), false);
  const historyLogCount = context.logs.filter(({ event }) => event === "hall_time_history_recorded").length;
  const repeated = context.service.distribute(admin, { operationId: operation(9), gridId: created.grid.id, expectedRevision: created.revision });
  assert.equal(repeated.repeated, true);
  assert.equal(context.logs.filter(({ event }) => event === "hall_time_history_recorded").length, historyLogCount);
  assert.equal(context.messages.length, 0);
  context.repository.close();
});

test("Gleichberechtigte Verteilung mischt gemeinsame Gruppen bei gleicher Einsatzanzahl", () => {
  const context = setup();
  const group = Array.from({ length: 8 }, (_, index) => ({ id: `g${index + 1}`, name: `Gruppe ${index + 1}`, role: "player" }));
  const names = new Map(group.map(({ id, name }) => [id, name]));
  const slots = Array.from({ length: 8 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, 20 + (index * 7))).toISOString().slice(0, 10), start: "19:00", end: "21:00",
  }));
  const created = context.service.saveGrid(admin, gridRequest(0, {
    capacity: 4, participantIds: group.map(({ id }) => id), slots,
  }), names);
  const distributed = context.service.distribute(admin, { operationId: operation(17), gridId: created.grid.id, expectedRevision: created.revision });
  const groups = distributed.grid.slots.map((slot) => distributed.grid.entries
    .filter((entry) => entry.slotId === slot.id && entry.status === "confirmed")
    .map(({ personId }) => personId).sort());
  const counts = group.map(({ id }) => groups.filter((members) => members.includes(id)).length);
  const pairCounts = new Map();
  for (const members of groups) {
    for (let left = 0; left < members.length; left++) {
      for (let right = left + 1; right < members.length; right++) {
        const key = [members[left], members[right]].sort().join(":");
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  assert.ok(new Set(groups.map((members) => members.join(":"))).size > 2);
  assert.equal(pairCounts.size, 28);
  assert.ok(Math.max(...pairCounts.values()) - Math.min(...pairCounts.values()) <= 2, JSON.stringify({ groups, pairs: [...pairCounts] }));
  for (const { id } of group) {
    const appearances = groups.flatMap((members, index) => members.includes(id) ? [index] : []);
    assert.ok(appearances.slice(1).every((value, index) => value - appearances[index] <= 3), `${id}: ${appearances}`);
  }
  context.repository.close();
});

test("Admin-Verhinderungen erzeugen zuerst nur eine Vorschau und werden kontrolliert uebernommen", () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, { capacity: 2 }), names);
  const [firstSlot, secondSlot] = created.grid.slots;
  const constrained = context.service.saveConstraints(admin, {
    operationId: operation(18), gridId: created.grid.id, expectedRevision: created.revision,
    constraints: [
      { personId: "p1", slotId: firstSlot.id, kind: "unavailable" },
      { personId: "p2", slotId: secondSlot.id, kind: "avoid" },
    ],
  });
  assert.equal(constrained.grid.constraints.length, 2);
  assert.equal(context.service.reportingSnapshot(0, Date.parse("2026-02-01T00:00:00Z")).entries
    .find(({ action }) => action === "distribution_constraints_updated").summary, "Admin hat Termineinschränkungen für die Verteilung vorgenommen");
  assert.deepEqual(context.service.grid(players[0], created.grid.id).grid.constraints, [
    { personId: "p1", slotId: firstSlot.id, kind: "unavailable" },
    { personId: "p2", slotId: secondSlot.id, kind: "avoid" },
  ]);
  const previewed = context.service.previewDistribution(admin, { gridId: created.grid.id, expectedRevision: constrained.revision });
  assert.equal(previewed.preview.quality, "complete");
  assert.equal(previewed.preview.openPlaceCount, 0);
  assert.equal(previewed.preview.softConflictCount, 0);
  assert.equal(previewed.preview.entries.some(({ slotId, personId }) => slotId === firstSlot.id && personId === "p1"), false);
  assert.equal(context.service.adminGrids(admin).grids[0].entries.length, 0);
  const applied = context.service.applyDistributionPreview(admin, {
    operationId: operation(19), gridId: created.grid.id, expectedRevision: constrained.revision,
    previewHash: previewed.preview.previewHash,
  });
  assert.equal(applied.grid.entries.length, 4);
  assert.throws(() => context.service.applyDistributionPreview(admin, {
    operationId: operation(20), gridId: created.grid.id, expectedRevision: applied.revision,
    previewHash: "a".repeat(64),
  }), { code: "HALL_TIME_PREVIEW_STALE" });
  context.repository.close();
});

test("Unvollstaendige Verteilung bleibt reine Vorschau und kann nicht uebernommen werden", () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, { capacity: 3, slots: [gridRequest(0).slots[0]] }), names);
  const slotId = created.grid.slots[0].id;
  const constrained = context.service.saveConstraints(admin, {
    operationId: operation(21), gridId: created.grid.id, expectedRevision: created.revision,
    constraints: [{ personId: "p1", slotId, kind: "unavailable" }],
  });
  const previewed = context.service.previewDistribution(admin, { gridId: created.grid.id, expectedRevision: constrained.revision });
  assert.equal(previewed.preview.quality, "incomplete");
  assert.equal(previewed.preview.openPlaceCount, 1);
  assert.throws(() => context.service.applyDistributionPreview(admin, {
    operationId: operation(22), gridId: created.grid.id, expectedRevision: constrained.revision,
    previewHash: previewed.preview.previewHash,
  }), { code: "HALL_TIME_DISTRIBUTION_INCOMPLETE" });
  assert.equal(context.service.adminGrids(admin).grids[0].entries.length, 0);
  context.repository.close();
});

test("Unvermeidbarer weicher Wunsch bleibt vollstaendig und wird transparent ausgewiesen", () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, { participantIds: ["p1"], slots: [gridRequest(0).slots[0]] }), names);
  const slotId = created.grid.slots[0].id;
  const constrained = context.service.saveConstraints(admin, {
    operationId: operation(23), gridId: created.grid.id, expectedRevision: created.revision,
    constraints: [{ personId: "p1", slotId, kind: "avoid" }],
  });
  const preview = context.service.previewDistribution(admin, { gridId: created.grid.id, expectedRevision: constrained.revision }).preview;
  assert.equal(preview.quality, "warning");
  assert.equal(preview.openPlaceCount, 0);
  assert.equal(preview.softConflictCount, 1);
  assert.deepEqual(preview.softConflicts.map(({ personId, slot }) => [personId, slot.id]), [["p1", slotId]]);
  context.repository.close();
});

test("Vermeidbarer weicher Wunsch wird bei gleich guter Einsatzverteilung global aufgeloest", () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const slots = Array.from({ length: 3 }, (_, index) => ({ date: `2026-01-${20 + index}`, start: "19:00", end: "21:00" }));
  const created = context.service.saveGrid(admin, gridRequest(0, { participantIds: ["p1", "p2"], slots }), names);
  const constrained = context.service.saveConstraints(admin, {
    operationId: operation(25), gridId: created.grid.id, expectedRevision: created.revision,
    constraints: [{ personId: "p2", slotId: created.grid.slots[1].id, kind: "avoid" }],
  });
  const preview = context.service.previewDistribution(admin, { gridId: created.grid.id, expectedRevision: constrained.revision }).preview;
  const counts = ["p1", "p2"].map((personId) => preview.entries.filter((entry) => entry.personId === personId).length);
  assert.equal(preview.quality, "complete");
  assert.equal(preview.softConflictCount, 0);
  assert.equal(preview.entries.some(({ slotId, personId }) => slotId === created.grid.slots[1].id && personId === "p2"), false);
  assert.equal(Math.max(...counts) - Math.min(...counts), 1);
  assert.equal(context.logs.find(({ event }) => event === "hall_time_distribution_preview_completed").fields.softConflictCount, 0);
  context.repository.close();
});

test("Vorausschauende Reparatur nutzt knappe Verfuegbarkeit fuer eine moegliche Gleichverteilung", () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const slots = Array.from({ length: 3 }, (_, index) => ({ date: `2026-01-${20 + index}`, start: "19:00", end: "21:00" }));
  const created = context.service.saveGrid(admin, gridRequest(0, { slots }), names);
  const constrained = context.service.saveConstraints(admin, {
    operationId: operation(24), gridId: created.grid.id, expectedRevision: created.revision,
    constraints: created.grid.slots.slice(1).map(({ id: slotId }) => ({ personId: "p3", slotId, kind: "unavailable" })),
  });
  const preview = context.service.previewDistribution(admin, { gridId: created.grid.id, expectedRevision: constrained.revision }).preview;
  assert.equal(preview.spread, 0);
  assert.equal(preview.entries.some(({ slotId, personId }) => slotId === created.grid.slots[0].id && personId === "p3"), true);
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

test("Rasterteilnehmer aendern fremde Zukunftseintraege mit nachvollziehbarem Akteur", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, { capacity: 2 }), names);
  const slotId = created.grid.slots[0].id;

  const added = await context.service.setBooking(players[0], {
    operationId: operation(14), gridId: created.grid.id, slotId, personId: players[1].id, selected: true,
  });
  assert.equal(added.grid.entries.some(({ personId }) => personId === players[1].id), true);
  const entry = context.service.history(players[0], created.grid.id).entries[0];
  assert.equal(entry.action, "booking_added");
  assert.equal(entry.actorId, players[0].id);
  assert.equal(entry.actorName, players[0].name);
  assert.equal(entry.personId, players[1].id);
  assert.equal(entry.personName, players[1].name);
  assert.equal(context.messages.length, 1);
  assert.equal(context.messages[0].recipientId, players[1].id);
  assert.equal(context.messages[0].type, "hall_time_booking_changed");
  assert.equal(context.messages[0].externalDelivery, false);
  assert.equal(context.messages[0].acknowledgedAt, undefined);
  assert.equal(context.messages[0].subject, "Du wurdest angemeldet");
  assert.equal(context.messages[0].contextName, "Winterhalle");
  assert.match(context.messages[0].body, /Spieler 1 hat dich.*eingetragen/);

  await context.service.setBooking(players[0], {
    operationId: operation(15), gridId: created.grid.id, slotId, personId: players[1].id, selected: false,
  });
  assert.equal(context.messages.length, 2);
  assert.equal(context.messages[1].recipientId, players[1].id);
  assert.equal(context.messages[1].subject, "Du wurdest abgemeldet");
  assert.match(context.messages[1].body, /Spieler 1 hat dich.*abgemeldet/);
  assert.equal(context.service.history(players[1], created.grid.id).entries[0].action, "booking_removed");
  await assert.rejects(
    context.service.setBooking({ id: "other", name: "Andere Person", role: "player" }, {
      operationId: operation(16), gridId: created.grid.id, slotId, personId: players[1].id, selected: true,
    }),
    { code: "FORBIDDEN" },
  );
  context.repository.close();
});

test("Fremde Wartelisteneintragung erzeugt eine ungelesene persoenliche Meldung", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, { capacity: 1 }), names);
  const slotId = created.grid.slots[0].id;
  await context.service.setBooking(players[0], { operationId: operation(20), gridId: created.grid.id, slotId, selected: true });
  await context.service.setBooking(players[0], { operationId: operation(21), gridId: created.grid.id, slotId, personId: players[1].id, selected: true });
  assert.equal(context.messages.length, 1);
  assert.equal(context.messages[0].recipientId, players[1].id);
  assert.equal(context.messages[0].subject, "Du wurdest auf die Warteliste gesetzt");
  assert.match(context.messages[0].body, /auf die Warteliste gesetzt/);
  await context.service.setBooking(players[0], { operationId: operation(29), gridId: created.grid.id, slotId, personId: players[1].id, selected: false });
  assert.equal(context.messages.length, 2);
  assert.equal(context.messages[1].subject, "Du wurdest von der Warteliste entfernt");
  assert.match(context.messages[1].body, /von der Warteliste entfernt/);
  context.repository.close();
});

test("FairUse zaehlt nur reservierende Teilnehmer im Durchschnitt und bleibt fuer Wartelisten verbindlich", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const slots = Array.from({ length: 5 }, (_, index) => ({ date: `2026-01-${20 + index}`, start: "19:00", end: "21:00" }));
  const created = context.service.saveGrid(admin, gridRequest(0, {
    mode: "fair_use", capacity: 2, fairUse: { base: 2, extendedDays: 7, percent: 50, openDays: 2 }, slots,
  }), names);
  for (const [index, person] of [players[0], players[0], players[1], players[1]].entries()) {
    await context.service.setBooking(person, { operationId: operation(30 + index), gridId: created.grid.id, slotId: created.grid.slots[index].id, selected: true });
  }
  context.setNow(Date.parse("2026-01-17T12:00:00Z"));
  const third = await context.service.setBooking(players[0], { operationId: operation(34), gridId: created.grid.id, slotId: created.grid.slots[4].id, selected: true });
  assert.equal(third.grid.entries.filter(({ personId }) => personId === players[0].id).length, 3);

  const strict = setup();
  const strictGrid = strict.service.saveGrid(admin, gridRequest(0, {
    mode: "fair_use", capacity: 1, fairUse: { base: 1, extendedDays: 7, percent: 50, openDays: 2 },
  }), names);
  await strict.service.setBooking(players[0], { operationId: operation(35), gridId: strictGrid.grid.id, slotId: strictGrid.grid.slots[0].id, selected: true });
  await strict.service.setBooking(players[1], { operationId: operation(36), gridId: strictGrid.grid.id, slotId: strictGrid.grid.slots[1].id, selected: true });
  await assert.rejects(
    strict.service.setBooking(players[0], { operationId: operation(37), gridId: strictGrid.grid.id, slotId: strictGrid.grid.slots[1].id, selected: true }),
    { code: "HALL_TIME_FAIR_USE_LIMIT" },
  );
  context.repository.close();
  strict.repository.close();
});

test("Parametriertes Wartelistenlimit begrenzt gelbe Eintraege pro Person", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, {
    capacity: 1, maxWaitlistEntries: 2,
    slots: Array.from({ length: 3 }, (_, index) => ({ date: `2026-01-${20 + index}`, start: "19:00", end: "21:00" })),
  }), names);
  for (let index = 0; index < 3; index++) {
    await context.service.setBooking(players[1], { operationId: operation(40 + index * 2), gridId: created.grid.id, slotId: created.grid.slots[index].id, selected: true });
    const request = { operationId: operation(41 + index * 2), gridId: created.grid.id, slotId: created.grid.slots[index].id, selected: true };
    if (index < 2) await context.service.setBooking(players[0], request);
    else await assert.rejects(context.service.setBooking(players[0], request), { code: "HALL_TIME_WAITLIST_LIMIT" });
  }
  assert.equal(context.service.grid(players[0], created.grid.id).grid.entries.filter(({ personId, status }) => personId === players[0].id && status === "waitlist").length, 2);
  context.repository.close();
});

test("Oeffentliche Hallengruppe kann im eigenen Profil betreten und ohne aktuelle Eintraege verlassen werden", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, { participantIds: [players[0].id], publicJoinable: true }), names);
  assert.deepEqual(context.service.publicGroups(players[1]).groups, [{ id: created.grid.id, name: "Winterhalle", joined: false }]);
  const joined = context.service.setPublicMembership(players[1], {
    operationId: operation(50), expectedRevision: created.revision, gridId: created.grid.id, selected: true,
  }, { id: players[1].id, name: players[1].name });
  assert.equal(joined.selected, true);
  assert.equal(context.service.visibleGrids(players[1]).grids[0].id, created.grid.id);
  assert.equal(context.service.adminGrids(admin).grids[0].participants.some(({ id }) => id === players[1].id), true);
  assert.equal(context.service.history(players[1], created.grid.id).entries[0].action, "group_joined");
  const slotId = created.grid.slots[0].id;
  const booked = await context.service.setBooking(players[1], { operationId: operation(51), gridId: created.grid.id, slotId, selected: true });
  assert.throws(() => context.service.setPublicMembership(players[1], {
    operationId: operation(52), expectedRevision: booked.revision, gridId: created.grid.id, selected: false,
  }, { id: players[1].id, name: players[1].name }), { code: "HALL_TIME_GROUP_ACTIVE_ENTRIES" });
  const removed = await context.service.setBooking(players[1], { operationId: operation(53), gridId: created.grid.id, slotId, selected: false });
  const left = context.service.setPublicMembership(players[1], {
    operationId: operation(54), expectedRevision: removed.revision, gridId: created.grid.id, selected: false,
  }, { id: players[1].id, name: players[1].name });
  assert.equal(left.selected, false);
  assert.equal(context.service.visibleGrids(players[1]).grids.length, 0);
  context.repository.close();
});

test("Fremde Halleneintragung bleibt bis zur persoenlichen Quittierung ungelesen", async () => {
  const repository = new StateRepository(":memory:"); repository.init();
  const messagingRepository = new MessagingRepository(":memory:"); messagingRepository.init();
  const messagingService = new MessagingService({ repository: messagingRepository, now: () => Date.parse("2026-01-01T12:00:00Z"), log: () => {} });
  const service = new HallTimeService({ repository, messagingService, now: () => Date.parse("2026-01-01T12:00:00Z") });
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = service.saveGrid(admin, gridRequest(0, { capacity: 2 }), names);
  await service.setBooking(players[0], { operationId: operation(23), gridId: created.grid.id, slotId: created.grid.slots[0].id, personId: players[1].id, selected: true });
  assert.equal(messagingService.summary(players[1]).unreadCount, 1);
  const message = messagingRepository.listForRecipient(players[1].id, { limit: 20 }).messages[0];
  assert.equal(message.acknowledgedAt, null);
  messagingService.acknowledge(players[1], { operationId: operation(24), messageId: message.id });
  assert.equal(messagingService.summary(players[1]).unreadCount, 0);
  await service.setBooking(players[0], { operationId: operation(25), gridId: created.grid.id, slotId: created.grid.slots[0].id, personId: players[1].id, selected: false });
  assert.equal(messagingService.summary(players[1]).unreadCount, 1);
  const removal = messagingRepository.listForRecipient(players[1].id, { limit: 20 }).messages[0];
  assert.equal(removal.acknowledgedAt, null);
  assert.match(removal.body, /abgemeldet/);
  messagingRepository.close();
  repository.close();
});

test("Fehler der persoenlichen Hallenmeldung bleibt kontrolliert geloggt", async () => {
  const messagingError = Object.assign(new Error("unavailable"), { code: "MESSAGING_WRITE_FAILED" });
  const context = setup(Date.parse("2026-01-01T12:00:00Z"), { messagingService: { ensureMessage: async () => { throw messagingError; } } });
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, { capacity: 2 }), names);
  const result = await context.service.setBooking(players[0], { operationId: operation(22), gridId: created.grid.id, slotId: created.grid.slots[0].id, personId: players[1].id, selected: true });
  assert.equal(result.grid.entries.some(({ personId }) => personId === players[1].id), true);
  assert.deepEqual(context.logs.at(-1), {
    level: "warn", event: "hall_time_foreign_booking_message_failed",
    fields: { gridId: created.grid.id, slotId: created.grid.slots[0].id, recipientId: players[1].id, errorCode: "MESSAGING_WRITE_FAILED" },
  });
  assert.equal(JSON.stringify(context.logs).includes(players[1].name), false);
  context.repository.close();
});

test("Hallenzeiten speichern strukturierte Teilnehmer nach Nachname und Vorname sortiert", () => {
  const context = setup();
  const people = new Map([
    ["p1", { firstName: "Anna", lastName: "Zeller", name: "Zeller Anna" }],
    ["p2", { firstName: "Berta", lastName: "Aigner", name: "Aigner Berta" }],
    ["p3", { firstName: "Clara", lastName: "Aigner", name: "Aigner Clara" }],
  ]);
  const created = context.service.saveGrid(admin, gridRequest(0), people);
  assert.deepEqual(created.grid.participants.map(({ id, name }) => [id, name]), [
    ["p2", "Aigner Berta"], ["p3", "Aigner Clara"], ["p1", "Zeller Anna"],
  ]);
  context.repository.close();
});

test("Hallenzeiten-Historie projiziert alle bekannten Personen als Vorname Nachname", async () => {
  const context = setup();
  const people = new Map([
    ["p1", { firstName: "Anna", lastName: "Zeller", name: "Zeller Anna" }],
    ["p2", { firstName: "Berta", lastName: "Aigner", name: "Aigner Berta" }],
    ["p3", { firstName: "Clara", lastName: "Aigner", name: "Aigner Clara" }],
  ]);
  const created = context.service.saveGrid(admin, gridRequest(0), people);
  await context.service.setBooking(
    { ...players[0], firstName: "Anna", lastName: "Zeller", name: "Zeller Anna" },
    { operationId: operation(23), gridId: created.grid.id, slotId: created.grid.slots[0].id, personId: "p2", selected: true },
  );
  const snapshot = context.repository.getState("hall-times:v1", { grids: [] });
  const booking = snapshot.value.grids[0].history.find(({ action }) => action === "booking_added");
  booking.actorName = "Zeller Anna";
  booking.personName = "Aigner Berta";
  const createdEntry = snapshot.value.grids[0].history.find(({ action }) => action === "grid_created");
  createdEntry.actorName = "Admin Anna";
  context.repository.setState("hall-times:v1", snapshot.value, snapshot.revision);

  const historyNames = new Map([...people, [admin.id, "Anna Admin"]]);
  const history = context.service.history(admin, created.grid.id, historyNames).entries;
  assert.equal(history.find(({ action }) => action === "booking_added").actorName, "Anna Zeller");
  assert.equal(history.find(({ action }) => action === "booking_added").personName, "Berta Aigner");
  assert.equal(history.find(({ action }) => action === "grid_created").actorName, "Anna Admin");
  context.repository.close();
});

test("Rasteraenderungen bleiben als eigener Einstellungseintrag historisiert", () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0), names);
  context.service.saveGrid(admin, gridRequest(created.revision, {
    operationId: operation(24), gridId: created.grid.id, description: "Neue Einstellung",
  }), names);
  const entry = context.service.history(admin, created.grid.id).entries[0];
  assert.equal(entry.action, "grid_updated");
  assert.equal(entry.actorName, "Admin");
  context.repository.close();
});

test("Terminbezogene Historie behaelt ihren Snapshot nach Entfernen eines Zukunftstermins", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0), names);
  const booked = await context.service.setBooking(players[0], {
    operationId: operation(26), gridId: created.grid.id, slotId: created.grid.slots[0].id, selected: true,
  });
  context.service.saveGrid(admin, gridRequest(booked.revision, {
    operationId: operation(27), gridId: created.grid.id,
    slots: [{ ...created.grid.slots[1] }],
  }), names);
  const booking = context.service.history(admin, created.grid.id).entries.find(({ action }) => action === "booking_added");
  assert.deepEqual(booking.slot, created.grid.slots[0]);
  context.repository.close();
});

test("Hallenzeiten-Historie behaelt hoechstens 10000 Eintraege", () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0), names);
  const snapshot = context.repository.getState("hall-times:v1", { grids: [] });
  snapshot.value.grids[0].history = Array.from({ length: 10000 }, (_, index) => ({
    id: `old-${index}`, at: index, action: "grid_updated", actorId: admin.id, actorName: admin.name,
    personId: "", personName: "", slotId: "", from: "red", to: "red", detail: "",
  }));
  const seeded = context.repository.setState("hall-times:v1", snapshot.value, snapshot.revision);
  context.service.saveGrid(admin, gridRequest(seeded.revision, {
    operationId: operation(25), gridId: created.grid.id, description: "Limit",
  }), names);
  const history = context.service.history(admin, created.grid.id).entries;
  assert.equal(history.length, 10000);
  assert.equal(history.at(-1).id, "old-1");
  context.repository.close();
});

test("Hallenzeiten projizieren aktuelle Rastergauges ohne Personendimension", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0, { capacity: 2 }), names);
  await context.service.setBooking(players[0], {
    operationId: operation(28), gridId: created.grid.id, slotId: created.grid.slots[0].id, selected: true,
  });
  const status = context.service.metricsStatus();
  assert.equal(status.historyLimit, 10000);
  assert.deepEqual(status.grids[0], {
    id: created.grid.id,
    name: "Winterhalle",
    mode: "equal",
    active: true,
    participants: 3,
    futureSlots: 2,
    capacity: 4,
    confirmed: 1,
    waitlist: 0,
    historyEntries: 2,
  });
  assert.equal(JSON.stringify(status).includes("Spieler"), false);
  context.repository.close();
});

test("Administrator loescht alle Stati, ohne vergangene oder zukuenftige Termine zu entfernen", async () => {
  const context = setup();
  const names = new Map(players.map(({ id, name }) => [id, name]));
  const created = context.service.saveGrid(admin, gridRequest(0), names);
  const slotId = created.grid.slots[0].id;
  const booked = await context.service.setBooking(players[0], {
    operationId: operation(18), gridId: created.grid.id, slotId, selected: true,
  });
  const request = { operationId: operation(19), gridId: created.grid.id, expectedRevision: booked.revision };
  const cleared = context.service.clearAllStatuses(admin, request);
  assert.equal(cleared.deletedEntryCount, 1);
  assert.deepEqual(cleared.grid.slots, created.grid.slots);
  assert.deepEqual(cleared.grid.entries, []);
  const history = context.service.history(admin, created.grid.id).entries;
  assert.equal(history[0].action, "all_statuses_cleared");
  assert.equal(history.find(({ action }) => action === "booking_added").slot.date, "2026-01-20");
  const repeated = context.service.clearAllStatuses(admin, request);
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.deletedEntryCount, 1);
  assert.equal(context.service.history(admin, created.grid.id).entries.filter(({ action }) => action === "all_statuses_cleared").length, 1);
  context.repository.close();
});
