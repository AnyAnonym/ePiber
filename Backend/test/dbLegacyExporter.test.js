"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { exportLegacySource, rectangularRows } = require("../db/export/legacyExporter");
const { SHEET_FIELDS, parseSemicolonCsv } = require("../db/import/sheetInspector");
const { verifySourcePackage } = require("../db/import/sourcePackage");

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-exporter-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const sqliteFiles = {};
  for (const name of ["STATE_FILE", "MESSAGING_FILE", "SCORELOG_FILE", "AUDITLOG_FILE"]) {
    const filename = path.join(base, `${name}.sqlite`);
    const database = new DatabaseSync(filename); database.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample(value) VALUES ('safe'); PRAGMA user_version=7"); database.close();
    sqliteFiles[name] = filename;
  }
  return { base, root: path.join(base, "package"), sqliteFiles };
}

function sheetsClient({ mutateSecondRead = false } = {}) {
  const names = [...Object.keys(SHEET_FIELDS), "Logging", "ScoreLog"];
  let reads = 0;
  return { spreadsheets: {
    async get() { return { data: { spreadsheetId: "spreadsheet-export-test-123", properties: { title: "Privater Titel" }, sheets: names.map((title, index) => ({ properties: { sheetId: index + 1, title, gridProperties: { rowCount: 10, columnCount: 20 } } })) } }; },
    values: { async batchGet({ ranges }) {
      reads++;
      return { data: { valueRanges: ranges.map((range) => {
        const name = range.slice(1, -1).replaceAll("''", "'");
        const header = SHEET_FIELDS[name] || ["Value"];
        return { values: [header, header.map((_, index) => index === 0 && mutateSecondRead && reads > 1 ? "changed" : `value;${index}`)] };
      }) } };
    } },
    developerMetadata: { async search() { return { data: { matchedDeveloperMetadata: [{ developerMetadata: { metadataId: 2, metadataKey: "record", metadataValue: "safe-id", visibility: "DOCUMENT", location: { dimensionRange: { sheetId: 1, dimension: "ROWS", startIndex: 1, endIndex: 2 } } } }] } }; } },
  } };
}

test("Legacy-Exporter erzeugt ein verifiziertes, geschlossenes Quellpaket ohne freien Titel im Metadatensatz", async (t) => {
  const source = fixture(t), times = [new Date("2026-10-12T10:00:00.000Z"), new Date("2026-10-12T10:01:00.000Z")];
  const result = await exportLegacySource({
    root: source.root, spreadsheetId: "spreadsheet-export-test-123", credentialsFile: "unused",
    sqliteFiles: source.sqliteFiles, exportRunId: "real-analysis-test", sheetsClient: sheetsClient(), now: () => times.shift(),
  });
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(verifySourcePackage(source.root).manifest.exportRunId, "real-analysis-test");
  assert.deepEqual(parseSemicolonCsv(fs.readFileSync(path.join(source.root, "sheets", "Personen.csv"), "utf8"))[1].slice(0, 2), ["value;0", "value;1"]);
  const metadata = JSON.parse(fs.readFileSync(path.join(source.root, "metadata", "sheets.json"), "utf8"));
  assert.equal(metadata.title, undefined);
  assert.match(metadata.titleSha256, /^[0-9a-f]{64}$/);
  assert.equal(metadata.developerMetadata.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(source.root, "metadata", "sqlite.json"), "utf8"))["state.sqlite"].userVersion, 7);
});

test("Legacy-Exporter verwirft den Klartextstand bei einer Quellaenderung", async (t) => {
  const source = fixture(t);
  await assert.rejects(exportLegacySource({
    root: source.root, spreadsheetId: "spreadsheet-export-test-123", credentialsFile: "unused",
    sqliteFiles: source.sqliteFiles, exportRunId: "changed-analysis-test", sheetsClient: sheetsClient({ mutateSecondRead: true }),
  }), { code: "EXPORT_SOURCE_CHANGED" });
  assert.equal(fs.existsSync(source.root), false);
});

test("Legacy-Exporter fuellt nur von Google gekuerzte trailing Leerzellen auf", () => {
  assert.deepEqual(rectangularRows([["A", "B", "C"], ["1"], ["2", "3"]], "Test"), [["A", "B", "C"], ["1", "", ""], ["2", "3", ""]]);
  assert.throws(() => rectangularRows([["A"], ["1", "2"]], "Test"), { code: "EXPORT_SHEET_ROW_TOO_WIDE" });
});
