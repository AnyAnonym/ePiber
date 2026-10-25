"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { sanitizePeopleRows, sanitizeSqlite } = require("../db/export/pajRefreshProfile");
const { SHEET_FIELDS } = require("../db/import/sheetInspector");

test("Offline-PAJ-Refresh entfernt Quellcredentials und erzeugt nur Testcredentials", () => {
  const header = SHEET_FIELDS.Personen;
  const person = (id, login) => header.map((field) => ({ ID: id, Login: login, PasswdHash: "ORIGINAL_CREDENTIAL_MUST_DISAPPEAR", KennwortVergessen: "x" })[field] || "");
  const rows = [header, person("1", "test.login"), person("2", "")];
  const passwordIndex = header.indexOf("PasswdHash"), authorizationIndex = header.indexOf("KennwortVergessen");
  const result = sanitizePeopleRows(rows, { clientHash: "f".repeat(64), exportRunId: "offline-profile-test" });
  assert.equal(result.credentialCount, 1);
  assert.match(result.rows[1][passwordIndex], /^scrypt\$v1\$16384\$8\$1\$/);
  assert.equal(result.rows[2][passwordIndex], "");
  assert.equal(result.rows[1][authorizationIndex], "");
  assert.equal(result.rows[2][authorizationIndex], "");
  assert.equal(JSON.stringify(result).includes("ORIGINAL_CREDENTIAL_MUST_DISAPPEAR"), false);
  assert.equal(rows[1][passwordIndex], "ORIGINAL_CREDENTIAL_MUST_DISAPPEAR");
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
