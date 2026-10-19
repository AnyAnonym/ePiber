"use strict";

const { Temporal } = require("@js-temporal/polyfill");

function plainDate(value) {
  if (!value) return "";
  const date = Temporal.PlainDate.from(String(value));
  return `${String(date.day).padStart(2, "0")}.${String(date.month).padStart(2, "0")}.${date.year}`;
}

function legacyInstant(value) {
  if (!value) return "";
  const instant = Temporal.Instant.from(value instanceof Date ? value.toISOString() : String(value));
  const local = instant.toZonedDateTimeISO("Europe/Vienna");
  return `${String(local.year % 100).padStart(2, "0")}${String(local.month).padStart(2, "0")}${String(local.day).padStart(2, "0")}-${String(local.hour).padStart(2, "0")}${String(local.minute).padStart(2, "0")}`;
}

function boundary(date, instant) {
  if (date) return Temporal.PlainDate.from(String(date)).toString().replaceAll("-", "");
  if (!instant) return "";
  const local = Temporal.Instant.from(instant instanceof Date ? instant.toISOString() : String(instant)).toZonedDateTimeISO("Europe/Vienna");
  return `${local.toPlainDate().toString().replaceAll("-", "")}-${String(local.hour).padStart(2, "0")}${String(local.minute).padStart(2, "0")}`;
}

function participantValue(participant) {
  if (!participant) return "";
  if (participant.type === "open_bracket") return "PRE";
  if (participant.type === "bye") return "BYE";
  return participant.personId || "";
}

function resultString(match) {
  if (!match.completionType || match.completionType === "walkover") return "";
  return match.sets.map((set) => `${set.sideOneGames}-${set.sideTwoGames}${set.loserTiebreakPoints === null ? "" : `(${set.loserTiebreakPoints})`}`).join("/");
}

class PostgresProjectionService {
  constructor({ identity, play, venue }) {
    this.identity = identity;
    this.play = play;
    this.venue = venue;
  }

  async load() {
    const [people, competitionTypes, matchFormats, competitions, navigation] = await Promise.all([
      this.identity.people(), this.play.competitionTypes(), this.play.matchFormats(), this.play.competitions(), this.venue.navigationPresets(null),
    ]);
    const [entriesByCompetition, matchesByCompetition, rankingsByCompetition] = await Promise.all([
      Promise.all(competitions.map((competition) => this.play.entries(competition.id))),
      Promise.all(competitions.map((competition) => this.play.matches(competition.id))),
      Promise.all(competitions.map((competition) => this.play.rankings(competition.id))),
    ]);
    const tables = {
      players: [["ID", "Vorname", "Nachname", "GeburtsDatum", "GeschlechtID", "Geschlecht", "Aktiv", "E-Mail", "TelefonMobil", "Land", "PLZ", "Ort", "Adresse", "CD-ID", "Login", "PasswdHash", "KennwortVergessen", "Mitglied", "Admin", "Operator", "Role", "Notification"]],
      bewerbe: [["ID", "BewerbsartID", "MatchtypID Standard", "Bezeichnung", "EntryStart", "EntryDeadline", "Bewerbsbeginn", "Bewerbsende", "Geschlecht", "Alterskategorie", "SortOrder"]],
      bewerbsart: [["ID", "Bezeichnung", "EntryListAvailable", "Rasterfunktion", "RoundRobin", "Spezifikum"]],
      matchtyp: [["ID", "Bezeichnung", "Gewinnsaetze", "Satzlaenge", "Satztiebreak", "Entscheidender Satz", "NoAd"]],
      matches1: [["Ignore", "ID", "MatchDate", "MatchStart", "MatchEnde", "ErgebnisErfasstAm", "ForderungDate", "Dauer", "BewerbID", "BewerbRunde", "MatchtypID", "Spieler1ID", "Spieler2ID", "Spieler3ID", "Spieler4ID", "Ergebnis", "Spieler1RangBeiErgebnis", "Spieler3RangBeiErgebnis", "PTN-Wertung", "Bemerkung"]],
      rlPlatzierung: [["ID", "BewerbID", "PersonID", "Rang", "RausgehangenAm", "RausgehangenLetztePlatzierung", "RausgehangenGrund"]],
      navigator: [["ID", "Name", "Ziel", "Profil"]],
      entryList: [["ID", "BewerbID", "PersonenID", "Entrydate", "GebuehrBezahlt"]],
    };

    for (const person of people) {
      const roles = new Set(person.assignedRoles || []);
      tables.players.push([
        person.id, person.firstName || "", person.lastName, person.birthDate ? plainDate(person.birthDate) : "",
        person.gender || "", "", person.active ? "1" : "0", person.email || "", person.phone || "",
        person.countryLabel || "", person.postalCode || "", person.city || "", person.addressLine || "", person.clubdeskId || "",
        person.login || "", "", person.passwordSetupAllowed ? "x" : "", person.member || "",
        roles.has("admin") ? "1" : "", roles.has("operator") ? "1" : "", person.role,
        (person.notificationChannels || []).map((channel) => ({ email: "Email", whatsapp: "Whatsapp" })[channel]).filter(Boolean).join("|"),
      ]);
    }
    for (const type of competitionTypes) {
      tables.bewerbsart.push([type.id, type.name, type.entryListAvailable ? "1" : "", type.bracketSize || "", type.roundRobin ? "1" : "", type.specificCode || ""]);
    }
    for (const format of matchFormats) {
      const deciding = format.decidingSetType === "full_set" ? "vollstaendiger Satz" : format.decidingSetType === "match_tiebreak_10" ? "MT10" : "MT7";
      tables.matchtyp.push([format.id, format.name, String(format.setsToWin), `0-${format.setTargetGames}`, `${format.setTiebreakAtGames}-${format.setTiebreakAtGames}`, deciding, format.noAd ? "J" : "N"]);
    }
    for (const competition of competitions) {
      const age = competition.minimumAge !== null ? `${competition.minimumAge}+` : competition.maximumAge !== null ? `${competition.maximumAge}-` : "0+";
      tables.bewerbe.push([
        competition.id, competition.competitionTypeId, competition.defaultMatchFormatId || "", competition.name,
        boundary(competition.entryStartDate, competition.entryStartsAt), boundary(competition.entryDeadlineDate, competition.entryDeadlineAt),
        boundary(competition.competitionStartDate, competition.competitionStartsAt), boundary(competition.competitionEndDate, competition.competitionEndsAt),
        competition.genderCodes.join(","), age, competition.sortOrder === null ? "" : String(competition.sortOrder),
      ]);
    }
    for (const entries of entriesByCompetition) for (const entry of entries) {
      tables.entryList.push([entry.id, entry.competitionId, entry.personId, legacyInstant(entry.enteredAt), entry.legacyFeeStatus || ""]);
    }
    for (const rankings of rankingsByCompetition) for (const ranking of rankings) {
      tables.rlPlatzierung.push([
        ranking.id || ranking.internalId, ranking.competitionId, ranking.personId, ranking.status === "active" ? String(ranking.rank) : "0",
        legacyInstant(ranking.withdrawnAt), ranking.lastActiveRank === null ? "" : String(ranking.lastActiveRank), ranking.withdrawalReason || "",
      ]);
    }
    for (const matches of matchesByCompetition) for (const match of matches) {
      const slots = new Map(match.participants.map((participant) => [`${participant.sideNo}:${participant.positionNo}`, participant]));
      const values = [1, 2, 3, 4].map((index) => participantValue(slots.get(`${index <= 2 ? 1 : 2}:${index <= 2 ? index : index - 2}`)));
      if (match.completionType && match.completionType !== "regular") {
        const losingSide = 3 - match.winnerSideNo;
        const index = losingSide === 1 ? 0 : 2;
        values[index] = `${values[index]} [${match.completionType === "walkover" ? "wo" : "ret"}]`;
      }
      tables.matches1.push([
        match.isIgnored ? "1" : "", match.id, legacyInstant(match.completionType === "walkover" ? match.walkoverAt : match.scheduledAt),
        legacyInstant(match.playStartedAt), legacyInstant(match.playEndedAt), legacyInstant(match.firstCapturedAt), legacyInstant(match.challengedAt),
        match.reservedDurationMinutes === null ? "" : String(match.reservedDurationMinutes), match.competitionId, match.roundCode || "",
        match.formatBindingSource === "match_override" ? match.matchFormatId : "", ...values, resultString(match), "", "", "", match.note || "",
      ]);
    }
    for (const item of navigation) {
      let target = "";
      if (!item.enabled) target = "";
      else if (item.targetType === "court_assignment") target = `OL-Platz-${item.pageKey}`;
      else if (item.targetType === "court_activation") target = "OL-Platzaktivierung";
      else if (item.targetType === "page") target = `${item.pageKey}.html`;
      else if (item.competitionId) {
        const page = item.pageKey || (item.targetType === "ranking" ? "rangliste" : item.targetType === "entry_list" ? "entryList" : item.roundRobin ? "RoundRobin" : "bewerbsRaster");
        target = `${page}.html?id=${encodeURIComponent(item.competitionId)}`;
      } else if (item.hallTimeGridId) target = `hallzeiten.html?id=${encodeURIComponent(item.hallTimeGridId)}`;
      tables.navigator.push([item.id || "", item.label, target, item.profileCode || "1"]);
    }
    return tables;
  }
}

module.exports = { PostgresProjectionService, legacyInstant, plainDate };
