"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { approveWarnings, transformSource } = require("../db/import/importRunner");
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
