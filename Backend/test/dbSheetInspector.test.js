"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SHEET_FIELDS, inspectSheetCsv, parseSemicolonCsv } = require("../db/import/sheetInspector");

test("Sheet-Inspektor akzeptiert exakt bekannte Spalten und sichere CSV-Zitate", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-sheet-inspector-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "sheets"));
  for (const [sheet, fields] of Object.entries(SHEET_FIELDS)) fs.writeFileSync(path.join(root, "sheets", `${sheet}.csv`), `${fields.join(";")}\n`);
  const summary = inspectSheetCsv(root);
  assert.equal(summary.Personen.columnCount, SHEET_FIELDS.Personen.length);
  assert.deepEqual(parseSemicolonCsv('A;B\n"x;y";"z""q"\n'), [["A", "B"], ["x;y", 'z"q']]);
  fs.appendFileSync(path.join(root, "sheets", "Bewerb.csv"), "zu;kurz\n");
  assert.throws(() => inspectSheetCsv(root), (error) => error.code === "SOURCE_CSV_ROW_INVALID");
});
