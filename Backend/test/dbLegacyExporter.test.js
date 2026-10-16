"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { exportLegacySource, rectangularRows } = require("../db/export/legacyExporter");
const { sanitizeSqlite } = require("../db/export/pajRefreshProfile");
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

function sheetsClient({ mutateSecondRead = false, refreshPerson = false, matchTypeTitle = "Matchtyp" } = {}) {
  const names = [...Object.keys(SHEET_FIELDS).map((name) => name === "Matchtyp" ? matchTypeTitle : name), "Logging", "ScoreLog"];
  let reads = 0;
  return { spreadsheets: {
    async get() { return { data: { spreadsheetId: "spreadsheet-export-test-123", properties: { title: "Privater Titel" }, sheets: names.map((title, index) => ({ properties: { sheetId: index + 1, title, gridProperties: { rowCount: 10, columnCount: 20 } } })) } }; },
    values: { async batchGet({ ranges }) {
      reads++;
      return { data: { valueRanges: ranges.map((range) => {
        const name = range.slice(1, -1).replaceAll("''", "'");
        const canonicalName = Object.keys(SHEET_FIELDS).find((candidate) => candidate.toLowerCase() === name.toLowerCase()) || name;
        const header = SHEET_FIELDS[canonicalName] || ["Value"];
         return { values: [header, header.map((field, index) => {
           if (index === 0 && mutateSecondRead && reads > 1) return "changed";
            if (canonicalName === "Personen" && refreshPerson) return ({ ID: "1", Vorname: "Real", Nachname: "Person", Aktiv: "1", Login: "real.login", PasswdHash: "ORIGINAL_CREDENTIAL_MUST_DISAPPEAR", KennwortVergessen: "x" })[field] || "";
           return `value;${index}`;
         })] };
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

test("Legacy-Exporter loest eindeutige Reiternamen unabhaengig von Grossschreibung auf", async (t) => {
  const source = fixture(t), times = [new Date("2026-10-12T10:00:00.000Z"), new Date("2026-10-12T10:01:00.000Z")];
  const result = await exportLegacySource({
    root: source.root, spreadsheetId: "spreadsheet-export-test-123", credentialsFile: "unused",
    sqliteFiles: source.sqliteFiles, exportRunId: "case-insensitive-sheet-test", sheetsClient: sheetsClient({ matchTypeTitle: "MatchTyp" }), now: () => times.shift(),
  });
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(path.join(source.root, "sheets", "Matchtyp.csv")), true);
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
  assert.deepEqual(rectangularRows([["ID", "BewerbID", "PersonenID", "Entrydate", "GebuehrBezahlt"], ["1", "2", "3", "4", "5", "unbenannter Nebenblock"]], "EntryList"), [["ID", "BewerbID", "PersonenID", "Entrydate", "GebuehrBezahlt"], ["1", "2", "3", "4", "5"]]);
});

test("PAJ-Refresh-Export entfernt Quellcredentials und erzeugt nur das gemeinsame Testcredential", async (t) => {
  const source = fixture(t), times = [new Date("2026-10-12T10:00:00.000Z"), new Date("2026-10-12T10:01:00.000Z")];
  const result = await exportLegacySource({
    root: source.root, spreadsheetId: "spreadsheet-export-test-123", credentialsFile: "unused",
    sqliteFiles: source.sqliteFiles, exportRunId: "paj-refresh-export-test", sheetsClient: sheetsClient({ refreshPerson: true }),
    profile: "paj-refresh-v1", testPasswordHash: "f".repeat(64), now: () => times.shift(),
  });
  assert.equal(result.profile, "paj-refresh-v1");
  const file = fs.readFileSync(path.join(source.root, "sheets", "Personen.csv"), "utf8");
  assert.doesNotMatch(file, /ORIGINAL_CREDENTIAL_MUST_DISAPPEAR/);
  const rows = parseSemicolonCsv(file), header = rows[0], person = Object.fromEntries(header.map((field, index) => [field, rows[1][index]]));
  assert.match(person.PasswdHash, /^scrypt\$v1\$16384\$8\$1\$/);
  assert.equal(person.KennwortVergessen, "");
  const verified = verifySourcePackage(source.root);
  assert.ok(verified.manifest.files.some(({ path: relative }) => relative === "metadata/paj-refresh.json"));
});

test("PAJ-Refresh bereinigt SQLite-Sicherheitsstate auch aus freien Dateiseiten", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-refresh-sanitize-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const stateFile = path.join(base, "state.sqlite"), messagingFile = path.join(base, "messaging.sqlite");
  const state = new DatabaseSync(stateFile);
  state.exec(`
    CREATE TABLE sessions(value TEXT); CREATE TABLE login_failures(value TEXT); CREATE TABLE operations(value TEXT);
    CREATE TABLE monitor_devices(monitor_id TEXT, label TEXT, token_hash TEXT, created_at INTEGER, updated_at INTEGER, last_seen_at INTEGER, revoked_at INTEGER);
    INSERT INTO sessions VALUES ('SESSION_SENTINEL'); INSERT INTO login_failures VALUES ('LIMIT_SENTINEL'); INSERT INTO operations VALUES ('OPERATION_SENTINEL');
    INSERT INTO monitor_devices VALUES ('monitor-1','Monitor','MONITOR_TOKEN_SENTINEL',1,1,NULL,NULL);
  `);
  state.close();
  const messaging = new DatabaseSync(messagingFile);
  messaging.exec(`
    CREATE TABLE event_ack_operations(value TEXT); CREATE TABLE message_bulk_ack_operations(value TEXT); CREATE TABLE event_interaction_operations(value TEXT);
    CREATE TABLE event_deliveries(status TEXT); INSERT INTO event_ack_operations VALUES ('ACK_SENTINEL'); INSERT INTO message_bulk_ack_operations VALUES ('BULK_SENTINEL');
    INSERT INTO event_interaction_operations VALUES ('INTERACTION_SENTINEL'); INSERT INTO event_deliveries VALUES ('pending');
  `);
  messaging.close();
  const options = { exportRunId: "sanitize-test", exportStartedAt: "2026-10-13T10:00:00.000Z" };
  sanitizeSqlite(stateFile, "state.sqlite", options);
  sanitizeSqlite(messagingFile, "messaging.sqlite", options);
  for (const sentinel of ["SESSION_SENTINEL", "LIMIT_SENTINEL", "OPERATION_SENTINEL", "MONITOR_TOKEN_SENTINEL", "ACK_SENTINEL", "BULK_SENTINEL", "INTERACTION_SENTINEL"]) {
    assert.equal(Buffer.concat([fs.readFileSync(stateFile), fs.readFileSync(messagingFile)]).includes(Buffer.from(sentinel)), false);
  }
  const verifiedState = new DatabaseSync(stateFile, { readOnly: true });
  assert.equal(verifiedState.prepare("SELECT count(*) AS count FROM sessions").get().count, 0);
  assert.equal(verifiedState.prepare("SELECT revoked_at IS NOT NULL AS revoked, length(token_hash) AS length FROM monitor_devices").get().revoked, 1);
  verifiedState.close();
  const verifiedMessaging = new DatabaseSync(messagingFile, { readOnly: true });
  assert.equal(verifiedMessaging.prepare("SELECT status FROM event_deliveries").get().status, "not_configured");
  verifiedMessaging.close();
});
