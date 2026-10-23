"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { projectCompetitions } = require("./postgresProjectionTestFixture");
const { dateOrInstant } = require("../db/import/transformCommon");
const { competitionLifecycle } = require("../competitionLifecycle");
const { validateTableValues } = require("../tableSchemas");
const { plainDate, legacyInstant } = require("../postgresProjectionService");
const { PostgresProjectionLoader } = require("../postgresProjectionLoader");
const { notificationChannels } = require("../messagingService");

test("Bewerbsgrenzen ueberstehen Import und Projektion im kompakten Live-Vertrag", async () => {
  const cases = [
    ["20260930", "20260930"], ["260930", "20260930"], ["30.09.2026", "20260930"], ["2026-09-30", "20260930"],
    ["20240229", "20240229"], ["20500930", "20500930"],
    ["20260711-2022", "20260711-2022"], ["260711-2022", "20260711-2022"],
    ["2026-07-11T18:22:00Z", "20260711-2022"],
    ["2026-10-25T00:30:00Z", "20261025-0230"], ["2026-10-25T01:30:00Z", "20261025-0230"],
    ["2026-03-29T00:30:00Z", "20260329-0130"], ["2026-03-29T01:30:00Z", "20260329-0330"],
    ["2026-12-31T23:30:00Z", "20270101-0030"], ["", ""],
  ];
  for (const [raw, expected] of cases) {
    const parsed = dateOrInstant(raw, "Bewerb:test", "Bewerbsende");
    const tables = await projectCompetitions([{
      id: "test", name: "Datumsvertrag",
      entryStartDate: parsed.date, entryStartsAt: parsed.instant,
      entryDeadlineDate: parsed.date, entryDeadlineAt: parsed.instant,
      competitionStartDate: parsed.date, competitionStartsAt: parsed.instant,
      competitionEndDate: parsed.date, competitionEndsAt: parsed.instant,
    }]);
    for (const field of ["EntryStart", "EntryDeadline", "Bewerbsbeginn", "Bewerbsende"]) {
      assert.equal(tables.bewerbe[1][tables.bewerbe[0].indexOf(field)], expected, `${raw}: ${field}`);
    }
    assert.equal(competitionLifecycle(expected).valid, true, raw);
    for (const [name, values] of Object.entries(tables)) assert.doesNotThrow(() => validateTableValues(name, values), name);
  }
});

test("Bewerbsende bleibt bis Tagesende beziehungsweise exakter Zeitgrenze aktiv", async () => {
  const tables = await projectCompetitions([
    { id: "day", name: "Kalendertag", competitionEndDate: "2026-09-30" },
    { id: "time", name: "Uhrzeit", competitionEndsAt: new Date("2026-07-11T18:22:00Z") },
    { id: "open", name: "Ohne Ende" },
  ]);
  const endIndex = tables.bewerbe[0].indexOf("Bewerbsende");
  const day = tables.bewerbe[1][endIndex], time = tables.bewerbe[2][endIndex];
  const dayEnd = new Date(2026, 8, 30, 23, 59, 59).getTime();
  assert.equal(competitionLifecycle(day, dayEnd).competitionEnded, false);
  assert.equal(competitionLifecycle(day, dayEnd + 1).competitionEnded, true);
  const timeEnd = new Date(2026, 6, 11, 20, 22).getTime();
  assert.equal(competitionLifecycle(time, timeEnd).competitionEnded, false);
  assert.equal(competitionLifecycle(time, timeEnd + 1).competitionEnded, true);
  assert.equal(competitionLifecycle(tables.bewerbe[3][endIndex], dayEnd + 1).competitionEnded, false);
});

test("Bewerbsgeschlechter und Altersgrenzen erfuellen den gemeinsamen Tabellenvertrag", async () => {
  const tables = await projectCompetitions([
    { id: "all", name: "Alle", genderCodes: [1, 2, 3], sortOrder: 0 },
    { id: "mixed", name: "Mixed", genderCodes: [1, 2], minimumAge: 60, sortOrder: -1 },
    { id: "youth", name: "Jugend", genderCodes: [2], maximumAge: 18 },
    { id: "open", name: "Offen" },
  ]);
  const pick = (field) => tables.bewerbe.slice(1).map((row) => row[tables.bewerbe[0].indexOf(field)]);
  assert.deepEqual(pick("Geschlecht"), ["1,2,3", "1,2", "2", ""]);
  assert.deepEqual(pick("Alterskategorie"), ["0+", "60+", "18-", "0+"]);
  assert.deepEqual(pick("SortOrder"), ["0", "-1", "", ""]);
  assert.doesNotThrow(() => validateTableValues("bewerbe", tables.bewerbe));
  assert.equal(plainDate("1980-05-01"), "01.05.1980");
  assert.equal(legacyInstant("2026-07-11T18:22:00Z"), "260711-2022");
});

test("Meldungskanaele, Geburtsdatum, Rollen und optionale Ranglisten-IDs bleiben kompatibel", async () => {
  const tables = await projectCompetitions([{ id: "2", name: "Rangliste" }], {
    people: [{ id: "1", firstName: "Ada", lastName: "Test", active: true, birthDate: "1980-05-01", role: "admin", member: "player A", assignedRoles: ["admin"], notificationChannels: ["email", "whatsapp"] }],
    rankings: [{ internalId: "0199c800-0000-7000-8000-000000000099", id: null, competitionId: "2", personId: "1", status: "withdrawn", rank: null, withdrawnAt: "2026-09-30T10:00:00Z", lastActiveRank: 4, withdrawalReason: "pause" }],
  });
  const person = Object.fromEntries(tables.players[0].map((name, index) => [name, tables.players[1][index]]));
  assert.equal(person.Notification, "Email|Whatsapp");
  assert.deepEqual(notificationChannels(person.Notification), ["Email", "Whatsapp"]);
  assert.equal(person.GeburtsDatum, "01.05.1980");
  assert.equal(person.Mitglied, "player A");
  assert.equal(person.Admin, "1");
  assert.equal(person.PasswdHash, "");
  assert.deepEqual(tables.rlPlatzierung[1], ["0199c800-0000-7000-8000-000000000099", "2", "1", "0", "260930-1200", "4", "pause"]);
  for (const [name, values] of Object.entries(tables)) assert.doesNotThrow(() => validateTableValues(name, values), name);
});

test("Ungueltige Projektionsdaten erhalten den letzten Stand und loggen nur kontrollierten Abschluss", async () => {
  const tables = await projectCompetitions([{ id: "2", name: "Rangliste", competitionEndDate: "2026-09-30" }]);
  const logs = [];
  let stored = null, fail = false, appliedSnapshots = 0;
  const loader = new PostgresProjectionLoader({
    projectionService: { load: () => fail ? projectCompetitions([{ id: "2", name: "Rangliste", competitionEndDate: "private-invalid-date" }]) : tables },
    dataStore: {
      setAllAuthoritative(values) { stored = values; appliedSnapshots++; return [{ table: "bewerbe", changed: true }]; },
    },
    log: (level, event, fields) => logs.push({ level, event, fields }),
  });
  await loader.initialLoad();
  fail = true;
  await assert.rejects(loader.refresh("test"), RangeError);
  assert.equal(stored, tables);
  assert.equal(appliedSnapshots, 1);
  assert.deepEqual(logs.map(({ fields }) => fields.result), ["success", "failed"]);
  assert.equal(loader.getStatus().lastErrorCode, "POSTGRES_PROJECTION_REFRESH_FAILED");
  assert.equal(JSON.stringify(logs).includes("private-invalid-date"), false);
});
