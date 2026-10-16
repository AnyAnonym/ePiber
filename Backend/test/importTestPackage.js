"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { loadImportContracts } = require("../db/importContracts");
const { SHEET_FIELDS } = require("../db/import/sheetInspector");
const { SQLITE_FILES } = require("../db/import/sourceInspector");
const { verifySourcePackage, writeSourceManifest } = require("../db/import/sourcePackage");
const { deriveCredential, writeProfileMetadata } = require("../db/export/pajRefreshProfile");

function csvValue(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeSheet(root, name, records) {
  const fields = SHEET_FIELDS[name];
  const lines = [fields, ...records.map((record) => fields.map((field) => record[field] ?? ""))];
  fs.writeFileSync(path.join(root, "sheets", `${name}.csv`), `${lines.map((row) => row.map(csvValue).join(";")).join("\n")}\n`, { mode: 0o600 });
}

function createImportTestPackage(t, { unknownState = false, invalidEmail = false, approveEmailWarning = false, withLegacyState = false, pajRefresh = false, refreshPasswordHash = "f".repeat(64), oldHistorical = false, allRoles = false, legacyMessagingWithoutVisibility = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-import-package-"));
  t?.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "sheets"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, "sqlite"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, "metadata"), { recursive: true, mode: 0o700 });

  const exportRunId = pajRefresh ? "synthetic-paj-refresh" : `synthetic-${unknownState ? "blocked" : "complete"}`;
  const people = [
    { ID: "1", Vorname: "Ada", Nachname: "Import", GeburtsDatum: "01.01.1980", GeschlechtID: "1", Aktiv: "1", "E-Mail": invalidEmail ? "ungueltig" : "ada@example.test", TelefonMobil: "0043 660 1234567", Land: "AT", PLZ: "4062", Ort: "Piberbach", Adresse: "Testweg 1", "CD-ID": "101", Login: "ada", PasswdHash: pajRefresh ? deriveCredential(refreshPasswordHash, exportRunId, "1") : "a".repeat(64), Mitglied: "player", Admin: "1" },
    { ID: "2", Vorname: "Berta", Nachname: "Import", GeburtsDatum: "02.02.1985", GeschlechtID: "2", Aktiv: "1", Login: "berta", PasswdHash: pajRefresh ? deriveCredential(refreshPasswordHash, exportRunId, "2") : "b".repeat(64), Mitglied: "player B" },
  ];
  if (allRoles) people.push(
    { ID: "3", Vorname: "Paula", Nachname: "Player", Aktiv: "1", Login: "player", PasswdHash: deriveCredential(refreshPasswordHash, exportRunId, "3"), Mitglied: "player" },
    { ID: "4", Vorname: "Anton", Nachname: "PlayerA", Aktiv: "1", Login: "player.a", PasswdHash: deriveCredential(refreshPasswordHash, exportRunId, "4"), Mitglied: "player A" },
    { ID: "5", Vorname: "Olivia", Nachname: "Operator", Aktiv: "1", Login: "operator", PasswdHash: deriveCredential(refreshPasswordHash, exportRunId, "5"), Mitglied: "player", Operator: "1" },
  );
  writeSheet(root, "Personen", people);
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
    if (source === "messaging.sqlite" && legacyMessagingWithoutVisibility) database.exec("ALTER TABLE event_participants DROP COLUMN inbox_visible");
    if (source === "state.sqlite") {
      database.prepare("INSERT INTO monitor_devices VALUES (?,?,?,?,?,?,?)").run("monitor-1", "Importmonitor", "c".repeat(64), "1791622800000", "1791626400000", "1791626400000", pajRefresh ? "1791626400000" : null);
      if (!pajRefresh) database.prepare("INSERT INTO operations VALUES (?,?,?,?,?,?)").run("user:1", "11111111-1111-4111-8111-111111111111", "setMyFavorites", "d".repeat(64), '{"status":"success","success":true}', "1791626400000");
      if (withLegacyState) {
        const state = database.prepare("INSERT INTO app_state(key,value_json,revision,updated_at) VALUES (?,?,?,?)");
        state.run("hall-times:v1", JSON.stringify({ grids: [{ id: "hall-1", name: "Synthetische Halle", description: "", mode: "fair_use", active: true, publicJoinable: true, capacity: 1, waitlistEnabled: true, maxWaitlistEntries: 2, fairUse: { base: 1, extendedDays: 7, percent: 50, openDays: 1 }, createdAt: 1790841600000, updatedAt: 1790845200000, participants: [{ id: "1", firstName: "Ada", lastName: "Import", name: "Ada Import" }], slots: [{ id: "slot-1", date: "2026-10-20", start: "18:00", end: "19:00" }], entries: [{ slotId: "slot-1", personId: "1", status: "confirmed", queuedAt: 1790845200000 }], constraints: [], history: [{ id: "44444444-4444-4444-8444-444444444444", at: 1790845200000, action: "booking_added", actorId: "1", actorName: "Ada Import", personId: "1", personName: "Ada Import", slotId: "slot-1", from: "red", to: "confirmed", detail: "" }] }] }), "2", "1790845200000");
        state.run("court:1", JSON.stringify({ matchId: "match-1", bewerbId: "2", matchtypId: "1", displayRules: null, bewerb: "Import-Rangliste", homePlayerIds: ["1"], guestPlayerIds: ["2"], homePlayer: "Ada Import", guestPlayer: "Berta Import", dateTime: "2026-10-01T08:00:00.000Z", runde: "R1", aktiv: 0, automaticActivation: { matchId: "match-1", matchDate: "2026-10-01T08:00:00.000Z", status: "finished" } }), "2", "1790845200000");
        state.run("monitor-target:monitor-1", JSON.stringify({ monitorId: "monitor-1", path: "/scoreboard.html", commandId: "55555555-5555-4555-8555-555555555555", issuedAt: 1790845200000 }), "2", "1790845200000");
        state.run("favorites:1", JSON.stringify([{ type: "page", page: "index", targetId: "favorite-test" }, { type: "page", page: "hallzeiten", params: { id: "hall-1" }, targetId: "favorite-hall" }]), "2", "1790845200000");
        state.run("start-page:1", JSON.stringify({ type: "page", page: "scoreboard" }), "2", "1790845200000");
        state.run("match-result-ranking:match-1", JSON.stringify({ before: [{ personId: "1", beforeRank: 1 }, { personId: "2", beforeRank: 2 }], after: [{ personId: "1", afterRank: 2 }, { personId: "2", afterRank: 1 }] }), "2", "1790845200000");
        state.run("record-metadata-intent:synthetic", JSON.stringify({ status: "confirmed", at: 1790845200000, metadataId: 1 }), "1", "1790845200000");
      }
    }
    if (source === "scorelog.sqlite") {
      database.prepare("INSERT INTO score_log_sequence VALUES (?,?,?)").run("paj", "1", "1");
      database.prepare("INSERT INTO score_log VALUES (?,?,?,?,?,?,?,?,?,?)").run("22222222-2222-4222-8222-222222222222", "paj", "1", "1", "2026-10-01T09:00:00.000Z", "1-0/0-0/0-0/15-0", "match-1", "1", "2", "1790845200000");
    }
    if (source === "messaging.sqlite") {
      database.prepare("INSERT INTO competition_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("event-1", "2", "1790845200000", "challenge", "match", "source-1", "1", "Ada Import", "Forderung", "Details", "{}", "1790845200000");
      if (legacyMessagingWithoutVisibility) database.prepare("INSERT INTO event_participants VALUES (?,?,?,?,?,?,?,?)").run("event-1", "2", "challenged", "Berta Import", "message-1", "challenge", "Forderung", "Details");
      else database.prepare("INSERT INTO event_participants VALUES (?,?,?,?,?,?,?,?,?)").run("event-1", "2", "challenged", "Berta Import", "message-1", "challenge", "Forderung", "Details", "1");
      database.prepare("INSERT INTO event_receipts VALUES (?,?,?)").run("event-1", "2", oldHistorical ? "1600000000000" : "1790845300000");
      database.prepare("INSERT INTO event_deliveries VALUES (?,?,?,?,?)").run("event-1", "2", "email", pajRefresh ? "not_configured" : "delivered", oldHistorical ? "1600000000000" : "1790845400000");
      database.prepare("INSERT INTO messaging_revisions VALUES (?,?)").run("2", "3");
      database.prepare("INSERT INTO event_comments VALUES (?,?,?,?,?,?,?,?,?,?)").run("comment-1", "event-1", "1", "Ada Import", "Synthetischer Kommentar", "visible", "1790845500000", null, null, null);
      database.prepare("INSERT INTO comment_reactions VALUES (?,?,?,?,?,?)").run("comment-1", "2", "Berta Import", "+1", "1790845600000", "1790845600000");
      database.prepare("INSERT INTO event_reactions VALUES (?,?,?,?,?,?)").run("event-1", "1", "Ada Import", "ok", "1790845700000", "1790845700000");
      database.exec("INSERT INTO competition_history_revision(singleton, revision) VALUES ('1', '1')");
    }
    if (source === "audit.sqlite") {
      database.prepare("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        "audit-event-1", oldHistorical ? "2020-09-13T12:26:40.000Z" : "2026-10-01T09:00:00.000Z", "user", "1", "Ada Import", "admin", "login.success", "session", "session-1", "", "request-1", "33333333-3333-4333-8333-333333333333", "success", null, null, null, "127.0.0.1", "", "", "paj", oldHistorical ? "1600000000000" : "1790845200000", oldHistorical ? "1600000001000" : "1790845201000"
      );
    }
    if (source === "state.sqlite" && unknownState) database.prepare("INSERT INTO app_state(key,value_json,revision,updated_at) VALUES (?,?,?,?)").run("unknown:test", "{}", "1", "1791626400000");
    database.close();
  }
  fs.writeFileSync(path.join(root, "metadata", "sheets.json"), "{}\n", { mode: 0o600 });
  fs.writeFileSync(path.join(root, "metadata", "sqlite.json"), "{}\n", { mode: 0o600 });
  if (pajRefresh) writeProfileMetadata(root, { credentialCount: people.filter(({ Login: value }) => value).length, revokedMonitorCount: 1, disabledDeliveryCount: 1 });
  writeSourceManifest(root, { exportRunId, exportStartedAt: "2026-10-10T10:00:00.000Z", exportCompletedAt: "2026-10-10T10:01:00.000Z" });
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
