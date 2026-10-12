"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SHEET_FIELDS, canonicalizeSheetHeader, inspectSheetCsv, parseSemicolonCsv } = require("../db/import/sheetInspector");

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

test("Sheet-Inspektor kanonisiert die real beobachteten Legacy-Header ohne unbekannte Spalten freizugeben", () => {
  assert.deepEqual(canonicalizeSheetHeader("Personen", ["ID", "Vorname", "Nachname", "GeburtsDatum", "GeschlechtID", "Aktiv", "E-Mail", "TelefonMobil", "Land", "PLZ", "Ort", "Adresse", "CD-ID", "Login", "passwdHash", "kennwortVergessen", "Mitglied", "Admin", "Operator", "Role", "Notification", "PTN", "Avatar"]),
    ["ID", "Vorname", "Nachname", "GeburtsDatum", "GeschlechtID", "Aktiv", "E-Mail", "TelefonMobil", "Land", "PLZ", "Ort", "Adresse", "CD-ID", "Login", "PasswdHash", "KennwortVergessen", "Mitglied", "Admin", "Operator", "Role", "Notification", null, null]);
  assert.deepEqual(canonicalizeSheetHeader("Bewerb", ["ID", "BewerbsartID", "MatchtypID Standard", "Bezeichnung", "Entrystart", "Entrydeadline", "Bewerbsbeginn", "Bewerbsende", "Geschlecht", "Alterskategorie", "SortOrder"]).slice(4, 6), ["EntryStart", "EntryDeadline"]);
  assert.equal(canonicalizeSheetHeader("Matchtyp", ["ID", "Bezeichnung", "Gewinnsaetze", "Satzlaenge", "Satztiebreak", "Satztiebreak", "Entscheidender Satz", "NoAd"])[5], "Satztiebreak");
  assert.throws(() => canonicalizeSheetHeader("Personen", [...SHEET_FIELDS.Personen, "Freitext"]), { code: "SOURCE_CSV_HEADER_DRIFT" });
});
