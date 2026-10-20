"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { approveWarnings, transformSource } = require("../db/import/importRunner");
const { ensureHistoricalPerson, normalizePlayTimes, validateLegacyCompletion } = require("../db/import/sheetTransformer");
const { dateOrInstant } = require("../db/import/transformCommon");
const { createImportTestPackage } = require("./importTestPackage");

test("synthetisches Quellpaket wird deterministisch, typisiert und datensparsam transformiert", (t) => {
  const root = createImportTestPackage(t);
  const first = transformSource(root), second = transformSource(root);
  assert.equal(first.status, "ready");
  assert.equal(first.plan.transformedSha256, second.plan.transformedSha256);
  assert.equal(first.plan.tables.people.length, 2);
  assert.equal(first.plan.tables.matches.length, 1);
  assert.equal(first.plan.tables.match_result_sets.length, 2);
  assert.equal(first.plan.tables.notification_preferences.length, 4);
  assert.equal(first.plan.tables.monitor_devices.length, 1);
  assert.equal(first.plan.tables.idempotency_operations.length, 1);
  assert.equal(first.plan.tables.score_events.length, 1);
  assert.equal(first.plan.tables.events.length, 1);
  assert.deepEqual({
    sourceType: first.plan.tables.events[0].source_type,
    sourceId: first.plan.tables.events[0].source_contract_id,
    actorId: first.plan.tables.events[0].actor_contract_id_snapshot,
    actorName: first.plan.tables.events[0].actor_name_snapshot,
    summary: first.plan.tables.events[0].summary_snapshot,
    detail: first.plan.tables.events[0].detail_snapshot,
  }, {
    sourceType: "match",
    sourceId: "source-1",
    actorId: "1",
    actorName: "Ada Import",
    summary: "Forderung",
    detail: "Details",
  });
  assert.equal(first.plan.tables.comments[0].moderation_status, "visible");
  assert.deepEqual(first.plan.tables.history_revision, [{ singleton: true, revision: 1 }]);
  assert.equal(first.plan.tables.audit_operations.length, 1);
  assert.deepEqual(first.findings, []);
});

test("Navigatorimport erhaelt Quellreihenfolge, Profile, Platzaktionen und Gruppenphasenziel", (t) => {
  const targets = ["scoreboard.html", "OL-Platz-1", "OL-Platz-2", "OL-Platzaktivierung", "RoundRobin.html?id=2", "OL-Ergebnis", "players.html", "https://example.test/index.html"];
  const result = transformSource(createImportTestPackage(t, { navigatorRows: targets.map((Ziel, index) => ({ ID: `nav-${20 - index}`, Name: `Eintrag ${index}`, Ziel, Profil: index === 2 ? "2" : "1" })) }));
  const rows = result.plan.tables.navigation_presets;
  assert.deepEqual(rows.map(({ sort_order }) => sort_order), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(rows.map(({ target_type }) => target_type), ["page", "court_assignment", "court_assignment", "court_activation", "competition", null, null, null]);
  assert.deepEqual(rows.slice(1, 4).map(({ page_key }) => page_key), ["1", "2", null]);
  assert.equal(rows[2].profile_code, "2");
  assert.equal(rows[4].page_key, "RoundRobin");
  assert.equal(rows[5].enabled, false);
  assert.equal(rows[5].legacy_target, "OL-Ergebnis");
});

test("nichtpositive historische Matchdauer behaelt den Start ohne ein Ende zu erfinden", () => {
  const findings = new Map(), value = normalizePlayTimes("261001-1000", "261001-1000", "Matches1:2", findings);
  assert.match(value.playStartedAt, /^2026-10-01T08:00:00/);
  assert.equal(value.playEndedAt, null);
  assert.equal([...findings.values()][0].code, "MATCH_NONPOSITIVE_DURATION_END_DISCARDED");
});

test("sechsstelliges Legacy-Bewerbsdatum verwendet dieselbe 2000er-Konvention wie Legacy-Zeitstempel", () => {
  assert.deepEqual(dateOrInstant("260923", "Bewerb:12", "Bewerbsende"), { date: "2026-09-23", instant: null });
});

test("verwaiste numerische Matchpersonen werden ohne erfundene Identitaet inaktiv erhalten", () => {
  const tables = { people: [] }, refs = { people: new Map() }, findings = new Map();
  const id = ensureHistoricalPerson("99", "Matches1:2", tables, refs, findings);
  assert.equal(ensureHistoricalPerson("99", "Matches1:3", tables, refs, findings), id);
  assert.deepEqual(tables.people, [{ id, tenant_id: "0199c800-0000-7000-8000-000000000001", contract_id: "99", first_name: null, last_name: "Historischer Spieler", birth_date: null, gender_code: null, active: false }]);
  assert.equal([...findings.values()][0].code, "MATCH_PERSON_PLACEHOLDER_CREATED");
  assert.throws(() => ensureHistoricalPerson("alt", "Matches1:4", tables, refs, findings), { code: "MATCH_PERSON_REFERENCE_MISSING" });
});

test("historischer 7-6-Satz ohne Tie-Break-Detail wird nur im Import ohne erfundene Punktzahl akzeptiert", () => {
  const result = validateLegacyCompletion({ kind: "regular", result: "6-2/6-7/6-3" }, { winningSets: 2, setTarget: 6, decidingSet: "vollstaendiger Satz" });
  assert.equal(result.completion.valid, true);
  assert.equal(result.missingTiebreakDetails, 1);
  assert.equal(result.completion.result, "6-2/6-7/6-3");
  assert.equal(result.completion.sets[1].tiebreakLoserPoints, null);
  const retirement = validateLegacyCompletion({ kind: "retirement", result: "7-6/2-6/1-1", losingSide: 2 }, { winningSets: 2, setTarget: 6, decidingSet: "vollstaendiger Satz" });
  assert.equal(retirement.completion.valid, true);
  assert.equal(retirement.completion.sets[0].tiebreakLoserPoints, null);
  const legacyMatchTiebreak = validateLegacyCompletion({ kind: "regular", result: "6-3/3-6/10-7" }, { winningSets: 2, setTarget: 6, decidingSet: "vollstaendiger Satz" });
  assert.equal(legacyMatchTiebreak.completion.valid, true);
  assert.equal(legacyMatchTiebreak.decidingSetOverride, "MT10");
  const legacyLongSet = validateLegacyCompletion({ kind: "regular", result: "7-6(4)/6-4" }, { winningSets: 2, setTarget: 4, decidingSet: "MT7" });
  assert.equal(legacyLongSet.completion.valid, true);
  assert.equal(legacyLongSet.setTargetOverride, 6);
});

test("unbekannter persistenter State blockiert ohne Ausgabe seines Werts", (t) => {
  const result = transformSource(createImportTestPackage(t, { unknownState: true }));
  assert.equal(result.status, "blocked");
  assert.equal(result.plan, null);
  assert.deepEqual(result.findings, [{ code: "STATE_KEY_UNKNOWN", source: "state.sqlite:app_state", projection: "key", severity: "blocker", count: 1, ruleVersion: 1 }]);
  assert.doesNotMatch(JSON.stringify(result), /unknown:test/);
});

test("Warnungen benoetigen eine exakt paketgebundene versionierte Freigabe", (t) => {
  const unapprovedRoot = createImportTestPackage(t, { invalidEmail: true });
  const unapproved = transformSource(unapprovedRoot);
  assert.equal(unapproved.status, "ready");
  assert.throws(() => approveWarnings(unapprovedRoot, unapproved), (error) => error.code === "IMPORT_WARNINGS_UNAPPROVED");

  const approvedRoot = createImportTestPackage(t, { invalidEmail: true, approveEmailWarning: true });
  const approved = transformSource(approvedRoot);
  assert.equal(approveWarnings(approvedRoot, approved).rules.length, 1);
});
