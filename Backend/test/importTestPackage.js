"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { loadImportContracts } = require("../db/importContracts");
const { SHEET_FIELDS } = require("../db/import/sheetInspector");
const { SQLITE_FILES } = require("../db/import/sourceInspector");
const { verifySourcePackage, writeSourceManifest } = require("../db/import/sourcePackage");

function csvValue(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeSheet(root, name, records) {
  const fields = SHEET_FIELDS[name];
  const lines = [fields, ...records.map((record) => fields.map((field) => record[field] ?? ""))];
  fs.writeFileSync(path.join(root, "sheets", `${name}.csv`), `${lines.map((row) => row.map(csvValue).join(";")).join("\n")}\n`, { mode: 0o600 });
}

function createImportTestPackage(t, { unknownState = false, invalidEmail = false, approveEmailWarning = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-import-package-"));
  t?.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "sheets"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, "sqlite"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, "metadata"), { recursive: true, mode: 0o700 });

  writeSheet(root, "Personen", [
    { ID: "1", Vorname: "Ada", Nachname: "Import", GeburtsDatum: "01.01.1980", GeschlechtID: "1", Aktiv: "1", "E-Mail": invalidEmail ? "ungueltig" : "ada@example.test", TelefonMobil: "0043 660 1234567", Land: "AT", PLZ: "4062", Ort: "Piberbach", Adresse: "Testweg 1", "CD-ID": "101", Login: "ada", PasswdHash: "a".repeat(64), Mitglied: "player", Admin: "1" },
    { ID: "2", Vorname: "Berta", Nachname: "Import", GeburtsDatum: "02.02.1985", GeschlechtID: "2", Aktiv: "1", Login: "berta", PasswdHash: "b".repeat(64), Mitglied: "player B" },
  ]);
  writeSheet(root, "Bewerbsart", [{ ID: "2", Bezeichnung: "Rangliste", EntryListAvailable: "1", Rasterfunktion: "", RoundRobin: "", Spezifikum: "ranking" }]);
  writeSheet(root, "Matchtyp", [{ ID: "1", Bezeichnung: "Normal", Gewinnsaetze: "2", Satzlaenge: "0-6", Satztiebreak: "6-6", "Entscheidender Satz": "vollstaendiger Satz", NoAd: "N" }]);
  writeSheet(root, "Bewerb", [{ ID: "2", BewerbsartID: "2", "MatchtypID Standard": "1", Bezeichnung: "Import-Rangliste", EntryStart: "01.01.2026", EntryDeadline: "30.09.2026", Bewerbsbeginn: "01.01.2026", Bewerbsende: "31.12.2026", Geschlecht: "", Alterskategorie: "0+", SortOrder: "1" }]);
  writeSheet(root, "EntryList", [{ ID: "entry-1", BewerbID: "2", PersonenID: "1", Entrydate: "2026-09-01T08:00:00Z", GebuehrBezahlt: "" }]);
  writeSheet(root, "RL-Platzierung", [
    { ID: "rank-1", BewerbID: "2", PersonID: "1", Rang: "1" },
    { ID: "rank-2", BewerbID: "2", PersonID: "2", Rang: "2" },
  ]);
  writeSheet(root, "Matches1", [{ Ignore: "", ID: "match-1", MatchDate: "261001-1000", MatchStart: "261001-1000", MatchEnde: "261001-1115", ErgebnisErfasstAm: "261001-1120", ForderungDate: "260901-1000", Dauer: "90", BewerbID: "2", BewerbRunde: "R1", MatchtypID: "", Spieler1ID: "1", Spieler2ID: "", Spieler3ID: "2", Spieler4ID: "", Ergebnis: "6-3/6-4", Spieler1RangBeiErgebnis: "1", Spieler3RangBeiErgebnis: "2", "PTN-Wertung": "", Bemerkung: "" }]);
  writeSheet(root, "Navigator", [{ ID: "nav-1", Name: "Scoreboard", Ziel: "/scoreboard.html", Profil: "1" }]);

  const { matrix } = loadImportContracts();
  for (const [source, relative] of Object.entries(SQLITE_FILES)) {
    const database = new DatabaseSync(path.join(root, ...relative.split("/")));
    for (const [table, contract] of Object.entries(matrix.sources[source])) {
      database.exec(`CREATE TABLE "${table}" (${Object.keys(contract.fields).map((field) => `"${field}" TEXT`).join(", ")})`);
    }
    if (source === "state.sqlite") {
      database.prepare("INSERT INTO monitor_devices VALUES (?,?,?,?,?,?,?)").run("monitor-1", "Importmonitor", "c".repeat(64), "1791622800000", "1791626400000", "1791626400000", null);
      database.prepare("INSERT INTO operations VALUES (?,?,?,?,?,?)").run("user:1", "11111111-1111-4111-8111-111111111111", "setMyFavorites", "d".repeat(64), '{"status":"success","success":true}', "1791626400000");
    }
    if (source === "scorelog.sqlite") {
      database.prepare("INSERT INTO score_log_sequence VALUES (?,?,?)").run("paj", "1", "1");
      database.prepare("INSERT INTO score_log VALUES (?,?,?,?,?,?,?,?,?,?)").run("22222222-2222-4222-8222-222222222222", "paj", "1", "1", "2026-10-01T09:00:00.000Z", "1-0/0-0/0-0/15-0", "match-1", "1", "2", "1790845200000");
    }
    if (source === "messaging.sqlite") {
      database.prepare("INSERT INTO competition_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("event-1", "2", "1790845200000", "challenge", "match", "source-1", "1", "Ada Import", "Forderung", "Details", "{}", "1790845200000");
      database.prepare("INSERT INTO event_participants VALUES (?,?,?,?,?,?,?,?)").run("event-1", "2", "challenged", "Berta Import", "message-1", "challenge", "Forderung", "Details");
      database.prepare("INSERT INTO event_receipts VALUES (?,?,?)").run("event-1", "2", "1790845300000");
      database.prepare("INSERT INTO event_deliveries VALUES (?,?,?,?,?)").run("event-1", "2", "email", "delivered", "1790845400000");
      database.prepare("INSERT INTO messaging_revisions VALUES (?,?)").run("2", "3");
      database.prepare("INSERT INTO event_comments VALUES (?,?,?,?,?,?,?,?,?,?)").run("comment-1", "event-1", "1", "Ada Import", "Synthetischer Kommentar", "visible", "1790845500000", null, null, null);
      database.prepare("INSERT INTO comment_reactions VALUES (?,?,?,?,?,?)").run("comment-1", "2", "Berta Import", "+1", "1790845600000", "1790845600000");
      database.prepare("INSERT INTO event_reactions VALUES (?,?,?,?,?,?)").run("event-1", "1", "Ada Import", "ok", "1790845700000", "1790845700000");
      database.exec("INSERT INTO competition_history_revision(singleton, revision) VALUES ('1', '1')");
    }
    if (source === "audit.sqlite") {
      database.prepare("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        "audit-event-1", "2026-10-01T09:00:00.000Z", "user", "1", "Ada Import", "admin", "login.success", "session", "session-1", "", "request-1", "33333333-3333-4333-8333-333333333333", "success", null, null, null, "127.0.0.1", "", "", "paj", "1790845200000", "1790845201000"
      );
    }
    if (source === "state.sqlite" && unknownState) database.prepare("INSERT INTO app_state(key,value_json,revision,updated_at) VALUES (?,?,?,?)").run("unknown:test", "{}", "1", "1791626400000");
    database.close();
  }
  fs.writeFileSync(path.join(root, "metadata", "sheets.json"), "{}\n", { mode: 0o600 });
  fs.writeFileSync(path.join(root, "metadata", "sqlite.json"), "{}\n", { mode: 0o600 });
  writeSourceManifest(root, { exportRunId: `synthetic-${unknownState ? "blocked" : "complete"}`, exportStartedAt: "2026-10-10T10:00:00.000Z", exportCompletedAt: "2026-10-10T10:01:00.000Z" });
  if (approveEmailWarning) {
    const verified = verifySourcePackage(root);
    fs.writeFileSync(path.join(root, "exception-manifest.json"), `${JSON.stringify({
      manifestVersion: 1,
      exportRunId: verified.manifest.exportRunId,
      sourceManifestSha256: verified.manifestSha256,
      approvedBy: "synthetic-test",
      approvedAt: "2026-10-10T10:02:00.000Z",
      rules: [{ code: "PERSON_EMAIL_DISCARDED", source: "Personen", projection: "Personen", handling: "discard", reasonCode: "SYNTHETIC_INVALID_EMAIL", validation: "contact.email.discarded" }],
    }, null, 2)}\n`, { mode: 0o600 });
  }
  return root;
}

module.exports = { createImportTestPackage };
