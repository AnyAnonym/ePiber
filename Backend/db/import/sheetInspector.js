"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SHEET_FIELDS = {
  Personen: ["ID", "Vorname", "Nachname", "GeburtsDatum", "GeschlechtID", "Geschlecht", "Aktiv", "E-Mail", "TelefonMobil", "Land", "PLZ", "Ort", "Adresse", "CD-ID", "Login", "PasswdHash", "KennwortVergessen", "Mitglied", "Admin", "Operator", "Role", "Notification"],
  Bewerb: ["ID", "BewerbsartID", "MatchtypID Standard", "Bezeichnung", "EntryStart", "EntryDeadline", "Bewerbsbeginn", "Bewerbsende", "Geschlecht", "Alterskategorie", "SortOrder"],
  Bewerbsart: ["ID", "Bezeichnung", "EntryListAvailable", "Rasterfunktion", "RoundRobin", "Spezifikum"],
  Matchtyp: ["ID", "Bezeichnung", "Gewinnsaetze", "Satzlaenge", "Satztiebreak", "Entscheidender Satz", "NoAd"],
  Matches1: ["Ignore", "ID", "MatchDate", "MatchStart", "MatchEnde", "ErgebnisErfasstAm", "ForderungDate", "Dauer", "BewerbID", "BewerbRunde", "MatchtypID", "Spieler1ID", "Spieler2ID", "Spieler3ID", "Spieler4ID", "Ergebnis", "Spieler1RangBeiErgebnis", "Spieler3RangBeiErgebnis", "PTN-Wertung", "Bemerkung"],
  "RL-Platzierung": ["ID", "BewerbID", "PersonID", "Rang", "RausgehangenAm", "RausgehangenLetztePlatzierung", "RausgehangenGrund"],
  Navigator: ["ID", "Name", "Ziel", "Profil"],
  EntryList: ["ID", "BewerbID", "PersonenID", "Entrydate", "GebuehrBezahlt"]
};

function parseSemicolonCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === "") quoted = true;
    else if (character === ";") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (quoted) throw Object.assign(new Error("CSV-Anfuehrung ist nicht geschlossen"), { code: "SOURCE_CSV_INVALID" });
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((values) => values.some((value) => value !== ""));
}

function inspectSheetCsv(root) {
  const summary = {};
  for (const [sheet, fields] of Object.entries(SHEET_FIELDS)) {
    const filename = path.join(root, "sheets", `${sheet}.csv`);
    const stat = fs.statSync(filename);
    if (stat.size > 64 * 1024 * 1024) throw Object.assign(new Error("CSV ist zu gross"), { code: "SOURCE_CSV_LIMIT", sheet });
    const rows = parseSemicolonCsv(fs.readFileSync(filename, "utf8"));
    if (!rows.length) throw Object.assign(new Error("CSV besitzt keine Kopfzeile"), { code: "SOURCE_CSV_HEADER_INVALID", sheet });
    const header = rows[0].map((value) => value.trim());
    if (new Set(header).size !== header.length || JSON.stringify(header.slice().sort()) !== JSON.stringify(fields.slice().sort())) {
      throw Object.assign(new Error("CSV-Kopfzeile weicht vom Vertrag ab"), { code: "SOURCE_CSV_HEADER_DRIFT", sheet });
    }
    if (rows.some((row) => row.length !== header.length)) throw Object.assign(new Error("CSV-Zeilenbreite ist ungueltig"), { code: "SOURCE_CSV_ROW_INVALID", sheet });
    summary[sheet] = { rowCount: rows.length - 1, columnCount: header.length };
  }
  return summary;
}

module.exports = { SHEET_FIELDS, inspectSheetCsv, parseSemicolonCsv };
