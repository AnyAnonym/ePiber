"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { REQUIRED_TABLES, loadImportContracts } = require("../db/importContracts");

test("SQLite-Source-to-Target-Matrix ist geschlossen und deckt alle aktiven Tabellen", () => {
  const { matrix, exceptionSchema } = loadImportContracts();
  for (const [source, tables] of Object.entries(REQUIRED_TABLES)) {
    assert.deepEqual(Object.keys(matrix.sources[source]).sort(), tables.slice().sort());
  }
  assert.equal(matrix.sources["state.sqlite"].sessions.disposition, "discard_cutover_state");
  assert.equal(matrix.sources["scorelog.sqlite"].score_log.fields.score, "venue.score_events:parse_eight_components");
  assert.deepEqual(exceptionSchema.properties.rules.items.properties.handling.enum, ["discard", "archive_only", "transform"]);
});
