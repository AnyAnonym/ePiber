"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { analyzeRealSource } = require("../db/import/realAnalysis");
const { createImportTestPackage } = require("./importTestPackage");

test("Realanalyse berichtet nur Zaehler, Hashes und die ereignisgebundene Score-Dublettenregel", (t) => {
  const result = analyzeRealSource(createImportTestPackage(t));
  assert.equal(result.status, "ready");
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
  assert.match(result.transformedSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.score, {
    eventCount: 1,
    duplicateEventIdGroups: 0,
    duplicateSourceSequenceGroups: 0,
    repeatedScoreGroups: 0,
    invalidActiveRows: 0,
    deduplicationRule: "event_id_and_source_instance_court_sequence",
    scoreTextIsNotIdentity: true,
  });
  assert.equal(JSON.stringify(result).includes("Ada Import"), false);
});
