"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Temporal } = require("@js-temporal/polyfill");
const { parseParticipantId, validateCompletion } = require("../../matchResultRules");
const { canonicalizeSheetHeader, parseSemicolonCsv } = require("./sheetInspector");
const {
  SECTION_ID, TENANT_ID, contractId, dateOnly, dateOrInstant, email, fail, instant,
  integer, legacyBoolean, login, stableUuid, text,
} = require("./transformCommon");

const ORDER = ["Personen", "Bewerbsart", "Matchtyp", "Bewerb", "EntryList", "RL-Platzierung", "Matches1", "Navigator"];

function finding(findings, code, source, severity = "info", count = 1) {
  const key = `${code}\0${source}\0${severity}`;
  const current = findings.get(key) || { code, source, projection: source, severity, count: 0, ruleVersion: 1 };
  current.count += count;
  findings.set(key, current);
}

function validateLegacyCompletion(params, rules) {
  const direct = validateCompletion(params, rules);
  if (direct.valid || !["regular", "retirement"].includes(params.kind)) return { completion: direct, missingTiebreakDetails: 0, decidingSetOverride: null, setTargetOverride: null };
  const tiebreakWinnerGames = rules.setTarget === 4 ? 4 : 7;
  const tiebreakLoserGames = tiebreakWinnerGames - 1;
  let missingTiebreakDetails = 0;
  const normalized = String(params.result).split("/").map((token) => {
    const match = token.match(/^(\d+)-(\d+)$/);
    if (!match) return token;
    const values = [Number(match[1]), Number(match[2])];
    if (Math.max(...values) !== tiebreakWinnerGames || Math.min(...values) !== tiebreakLoserGames) return token;
    missingTiebreakDetails++;
    return `${token}(0)`;
  }).join("/");
  const normalizedParams = { ...params, result: normalized };
  if (missingTiebreakDetails) {
    const retried = validateCompletion(normalizedParams, rules);
    if (retried.valid) return {
      completion: { ...retried, result: params.result, sets: retried.sets.map((set) => set.tiebreakLoserPoints === 0 ? { ...set, tiebreakLoserPoints: null } : set) },
      missingTiebreakDetails, decidingSetOverride: null, setTargetOverride: null,
    };
  }
  if (rules.setTarget === 4) {
    const retried = validateCompletion(normalizedParams, { ...rules, setTarget: 6 });
    if (retried.valid) return {
      completion: { ...retried, result: params.result, sets: retried.sets.map((set) => set.tiebreakLoserPoints === 0 ? { ...set, tiebreakLoserPoints: null } : set) },
      missingTiebreakDetails, decidingSetOverride: null, setTargetOverride: 6,
    };
  }
  const last = normalized.split("/").at(-1)?.match(/^(\d+)-(\d+)$/);
  const high = last ? Math.max(Number(last[1]), Number(last[2])) : 0;
  const decidingSetOverride = high >= 10 ? "MT10" : high >= 7 ? "MT7" : null;
  if (rules.decidingSet !== "vollstaendiger Satz" || !decidingSetOverride) return { completion: direct, missingTiebreakDetails: 0, decidingSetOverride: null, setTargetOverride: null };
  const retried = validateCompletion(normalizedParams, { ...rules, decidingSet: decidingSetOverride });
  if (!retried.valid) return { completion: direct, missingTiebreakDetails: 0, decidingSetOverride: null, setTargetOverride: null };
  return {
    completion: { ...retried, result: params.result, sets: retried.sets.map((set) => set.tiebreakLoserPoints === 0 ? { ...set, tiebreakLoserPoints: null } : set) },
    missingTiebreakDetails, decidingSetOverride, setTargetOverride: null,
  };
}

function ensureHistoricalPerson(contract, source, result, refs, findings) {
  if (refs.people.has(contract)) return refs.people.get(contract);
  if (!/^[1-9]\d*$/.test(contract)) fail("MATCH_PERSON_REFERENCE_MISSING", source, "participant");
  const id = stableUuid("person", contract);
  result.people.push({ id, tenant_id: TENANT_ID, contract_id: contract, first_name: null, last_name: "Historischer Spieler", birth_date: null, gender_code: null, active: false });
  refs.people.set(contract, id);
  refs.peopleDetails?.set(contract, { id, firstName: null, lastName: "Historischer Spieler" });
  finding(findings, "MATCH_PERSON_PLACEHOLDER_CREATED", "Matches1");
  return id;
}

function normalizePlayTimes(startValue, endValue, source, findings) {
  const playStartedAt = instant(startValue, source, "MatchStart"), parsedEnd = instant(endValue, source, "MatchEnde");
  if (playStartedAt && parsedEnd && Temporal.Instant.compare(Temporal.Instant.from(parsedEnd), Temporal.Instant.from(playStartedAt)) <= 0) {
    finding(findings, "MATCH_NONPOSITIVE_DURATION_END_DISCARDED", "Matches1");
    return { playStartedAt, playEndedAt: null };
  }
  return { playStartedAt, playEndedAt: parsedEnd };
}

function loadRows(root, sheet) {
  const rows = parseSemicolonCsv(fs.readFileSync(path.join(root, "sheets", `${sheet}.csv`), "utf8"));
  const header = canonicalizeSheetHeader(sheet, rows[0]);
  return rows.slice(1).filter((row) => row.some((value) => String(value).trim())).map((row, index) => ({
    source: `${sheet}:${index + 2}`,
    value: header.reduce((result, field, fieldIndex) => {
      if (field && !Object.hasOwn(result, field)) result[field] = row[fieldIndex] ?? "";
      return result;
    }, {}),
  }));
}

function unique(map, id, source) {
  if (map.has(id)) fail("SOURCE_ID_DUPLICATE", source, "id");
}

function credentials(hash, source) {
  const value = String(hash ?? "").trim();
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return { schema: "legacy_sha256", hash: value.toLowerCase() };
  if (/^scrypt\$v1\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(value)) return { schema: "scrypt_v1", hash: value };
  fail("PERSON_CREDENTIAL_INVALID", source, "PasswdHash");
}

function roles(row, source) {
  const modern = [row.Mitglied, row.Admin, row.Operator].some((value) => String(value ?? "").trim());
  const membership = String(row.Mitglied ?? "").trim();
  const admin = String(row.Admin ?? "").trim();
  const operator = String(row.Operator ?? "").trim();
  const legacy = String(row.Role ?? "").trim();
  if (modern) {
    if (membership && !["player", "player A", "player B"].includes(membership)) fail("PERSON_ROLE_INVALID", source, "Mitglied");
    if (admin && admin !== "1") fail("PERSON_ROLE_INVALID", source, "Admin");
    if (operator && operator !== "1") fail("PERSON_ROLE_INVALID", source, "Operator");
    return { membership: membership || null, admin: admin === "1", operator: operator === "1" || admin === "1" };
  }
  if (legacy && !["player", "player A", "player B", "admin", "operator"].includes(legacy)) fail("PERSON_ROLE_INVALID", source, "Role");
  return {
    membership: legacy.startsWith("player") ? legacy : null,
    admin: legacy === "admin",
    operator: legacy === "admin" || legacy === "operator",
  };
}

function transformPeople(rows, result, refs, findings) {
  const logins = new Set(), clubdesk = new Set();
  for (const { source, value: row } of rows) {
    const contract = contractId(row.ID, source, { numeric: true });
    unique(refs.people, contract, source);
    const id = stableUuid("person", contract);
    const active = legacyBoolean(row.Aktiv, source, "Aktiv");
    const firstName = text(row.Vorname, { max: 100, source, projection: "Vorname" });
    const lastName = text(row.Nachname, { max: 100, required: true, source, projection: "Nachname" });
    let gender = String(row.GeschlechtID ?? "").trim() || String(row.Geschlecht ?? "").trim();
    gender = gender ? integer(gender, source, "GeschlechtID", { min: 1, max: 3 }) : null;
    result.people.push({ id, tenant_id: TENANT_ID, contract_id: contract, first_name: firstName, last_name: lastName, birth_date: dateOnly(row.GeburtsDatum, source, "GeburtsDatum"), gender_code: gender, active });
    refs.people.set(contract, id);
    refs.peopleDetails.set(contract, { id, firstName, lastName });

    const mail = email(row["E-Mail"]);
    if (String(row["E-Mail"] ?? "").trim() && !mail) finding(findings, "PERSON_EMAIL_DISCARDED", "Personen", "warning");
    if (mail) result.person_contacts.push({ id: stableUuid("contact-email", contract), person_id: id, contact_type: "email", contact_value: mail, active: true });
    const mobile = String(row.TelefonMobil ?? "").trim();
    if (mobile && !/^00\d{1,4} \d{1,6} [\d ]+$/.test(mobile)) finding(findings, "PERSON_MOBILE_DISCARDED", "Personen", "warning");
    else if (mobile) result.person_contacts.push({ id: stableUuid("contact-mobile", contract), person_id: id, contact_type: "mobile", contact_value: mobile, active: true });
    const address = [row.Land, row.PLZ, row.Ort, row.Adresse].map((part) => String(part ?? "").trim());
    if (address.some(Boolean)) {
      if (address[1] && !/^\d{4}$/.test(address[1])) fail("PERSON_POSTAL_CODE_INVALID", source, "PLZ");
      result.person_addresses.push({ id: stableUuid("address", contract), person_id: id, country_label: address[0] || null, postal_code: address[1] || null, city: address[2] || null, address_line: address[3] || null, active: true });
    }
    const external = String(row["CD-ID"] ?? "").trim();
    if (external) {
      if (!/^[1-9][0-9]{0,63}$/.test(external) || clubdesk.has(external)) fail("PERSON_CLUBDESK_INVALID", source, "CD-ID");
      clubdesk.add(external);
      result.person_external_identifiers.push({ id: stableUuid("clubdesk", contract), tenant_id: TENANT_ID, person_id: id, provider: "clubdesk", external_value: external, active: true });
    }
    const canonicalLogin = login(row.Login, source);
    if (canonicalLogin && logins.has(canonicalLogin)) fail("PERSON_LOGIN_DUPLICATE", source, "Login");
    if (canonicalLogin) logins.add(canonicalLogin);
    const credential = credentials(row.PasswdHash, source);
    if (canonicalLogin || credential) {
      const accountId = stableUuid("account", contract);
      result.user_accounts.push({ id: accountId, tenant_id: TENANT_ID, person_id: id, login: canonicalLogin, active });
      refs.accounts.set(contract, accountId);
      if (credential) result.credentials.push({ id: stableUuid("credential", contract), account_id: accountId, credential_type: "password", credential_schema: credential.schema, secret_hash: credential.hash, active: true });
    }
    if (String(row.KennwortVergessen ?? "").trim()) finding(findings, "PERSON_PASSWORD_AUTHORIZATION_DISCARDED", "Personen");
    const assigned = roles(row, source);
    if (assigned.membership) result.memberships.push({ id: stableUuid("membership", contract), section_id: SECTION_ID, person_id: id, classification: assigned.membership, active });
    for (const role of [assigned.admin && "admin", assigned.operator && "operator"].filter(Boolean)) {
      if (role === "operator" && assigned.admin) continue;
      result.tenant_role_assignments.push({ id: stableUuid(`role-${role}`, contract), tenant_id: TENANT_ID, person_id: id, role_code: role });
    }
    const notification = String(row.Notification ?? "").trim();
    const enabled = new Set(notification ? notification.split("|").map((item) => item.trim().toLowerCase()) : []);
    if ([...enabled].some((item) => !["email", "whatsapp"].includes(item))) finding(findings, "PERSON_NOTIFICATION_INVALID", "Personen", "warning");
    for (const channel of ["email", "whatsapp"]) result.notification_preferences.push({ person_id: id, channel, enabled: enabled.has(channel), revision: 1 });
  }
}

function transformCompetitionTypes(rows, result, refs) {
  for (const { source, value: row } of rows) {
    const contract = contractId(row.ID, source);
    unique(refs.competitionTypes, contract, source);
    const id = stableUuid("competition-type", contract), versionId = stableUuid("competition-type-version", contract);
    const raster = String(row.Rasterfunktion ?? "").trim();
    let bracketSize = null;
    if (raster) {
      bracketSize = integer(raster, source, "Rasterfunktion", { min: 2 });
      if ((bracketSize & (bracketSize - 1)) !== 0) fail("COMPETITION_TYPE_BRACKET_INVALID", source, "Rasterfunktion");
    }
    result.competition_types.push({ id, tenant_id: TENANT_ID, contract_id: contract, name: text(row.Bezeichnung, { required: true, source, projection: "Bezeichnung" }), active: true });
    result.competition_type_versions.push({ id: versionId, competition_type_id: id, version_no: 1, entry_list_available: legacyBoolean(row.EntryListAvailable, source, "EntryListAvailable"), bracket_size: bracketSize, round_robin: legacyBoolean(row.RoundRobin, source, "RoundRobin"), specific_code: text(row.Spezifikum, { max: 100, source, projection: "Spezifikum" }) });
    refs.competitionTypes.set(contract, versionId);
  }
}

function transformMatchFormats(rows, result, refs) {
  for (const { source, value: row } of rows) {
    const contract = contractId(row.ID, source, { numeric: true });
    unique(refs.matchFormats, contract, source);
    const target = String(row.Satzlaenge).trim() === "0-4" ? 4 : String(row.Satzlaenge).trim() === "0-6" ? 6 : 0;
    const tie = String(row.Satztiebreak).trim() === "3-3" ? 3 : String(row.Satztiebreak).trim() === "6-6" ? 6 : 0;
    const deciding = { "vollstaendiger Satz": "full_set", MT10: "match_tiebreak_10", MT7: "match_tiebreak_7" }[String(row["Entscheidender Satz"]).trim()];
    const sets = integer(row.Gewinnsaetze, source, "Gewinnsaetze", { min: 2, max: 3 });
    if (!target || tie !== target && tie !== target - 1 || !deciding || !["J", "N"].includes(String(row.NoAd).trim())) fail("MATCH_FORMAT_RULE_INVALID", source, "rules");
    const id = stableUuid("match-format", contract), versionId = stableUuid("match-format-version", contract);
    result.match_formats.push({ id, tenant_id: TENANT_ID, contract_id: contract, name: text(row.Bezeichnung, { required: true, source, projection: "Bezeichnung" }), active: true });
    result.match_format_versions.push({ id: versionId, match_format_id: id, version_no: 1, sets_to_win: sets, set_target_games: target, set_tiebreak_at_games: tie, deciding_set_type: deciding, no_ad: row.NoAd.trim() === "J" });
    refs.matchFormats.set(contract, { id: versionId, matchFormatId: id, setTiebreakAtGames: tie, noAd: row.NoAd.trim() === "J", rules: { winningSets: sets, setTarget: target, decidingSet: deciding === "full_set" ? "vollstaendiger Satz" : deciding.endsWith("10") ? "MT10" : "MT7" } });
  }
}

function transformCompetitions(rows, result, refs) {
  for (const { source, value: row } of rows) {
    const contract = contractId(row.ID, source);
    unique(refs.competitions, contract, source);
    const typeVersion = refs.competitionTypes.get(String(row.BewerbsartID).trim());
    if (!typeVersion) fail("COMPETITION_TYPE_REFERENCE_MISSING", source, "BewerbsartID");
    const format = String(row["MatchtypID Standard"] ?? "").trim();
    if (format && !refs.matchFormats.has(format)) fail("MATCH_FORMAT_REFERENCE_MISSING", source, "MatchtypID Standard");
    const boundaries = {};
    for (const [field, dateColumn, instantColumn] of [["EntryStart", "entry_start_date", "entry_starts_at"], ["EntryDeadline", "entry_deadline_date", "entry_deadline_at"], ["Bewerbsbeginn", "competition_start_date", "competition_starts_at"], ["Bewerbsende", "competition_end_date", "competition_ends_at"]]) {
      const parsed = dateOrInstant(row[field], source, field);
      boundaries[dateColumn] = parsed.date;
      boundaries[instantColumn] = parsed.instant;
    }
    const age = String(row.Alterskategorie ?? "").trim();
    let minimum = null, maximum = null;
    if (age && age !== "0+") {
      const match = age.match(/^(\d{1,3})([+-])$/);
      if (!match || Number(match[1]) > 150) fail("COMPETITION_AGE_INVALID", source, "Alterskategorie");
      if (match[2] === "+") minimum = Number(match[1]); else maximum = Number(match[1]);
    }
    const id = stableUuid("competition", contract);
    result.competitions.push({ id, section_id: SECTION_ID, contract_id: contract, competition_type_version_id: typeVersion, default_match_format_version_id: format ? refs.matchFormats.get(format).id : null, name: text(row.Bezeichnung, { required: true, source, projection: "Bezeichnung" }), ...boundaries, minimum_age: minimum, maximum_age: maximum, sort_order: /^-?\d+$/.test(String(row.SortOrder ?? "").trim()) ? Number(row.SortOrder) : null });
    const genders = String(row.Geschlecht ?? "").trim();
    if (genders) for (const code of genders.split(/[|,]/).map((item) => item.trim())) result.competition_gender_eligibility.push({ competition_id: id, gender_code: integer(code, source, "Geschlecht", { min: 1, max: 3 }) });
    refs.competitions.set(contract, { id, defaultFormat: format ? refs.matchFormats.get(format) : null });
  }
}

function transformEntries(rows, result, refs) {
  const active = new Set();
  for (const { source, value: row } of rows) {
    const contract = contractId(row.ID, source);
    const competition = refs.competitions.get(String(row.BewerbID).trim()), person = refs.people.get(String(row.PersonenID).trim());
    if (!competition || !person) fail("ENTRY_REFERENCE_MISSING", source, "reference");
    const key = `${competition.id}:${person}`;
    if (active.has(key)) fail("ENTRY_DUPLICATE_ACTIVE", source, "reference");
    active.add(key);
    result.competition_entries.push({ id: stableUuid("entry", contract), competition_id: competition.id, person_id: person, contract_id: contract, entered_at: instant(row.Entrydate, source, "Entrydate", { optional: false }), status: "active", withdrawn_at: null, legacy_fee_status: text(row.GebuehrBezahlt, { max: 100, source, projection: "GebuehrBezahlt" }) });
  }
}

function transformRankings(rows, result, refs) {
  const seen = new Set(), ranks = new Set();
  for (const { source, value: row } of rows) {
    const competition = refs.competitions.get(String(row.BewerbID).trim()), person = refs.people.get(String(row.PersonID).trim());
    if (!competition || !person) fail("RANKING_REFERENCE_MISSING", source, "reference");
    const key = `${competition.id}:${person}`;
    if (seen.has(key)) fail("RANKING_PERSON_DUPLICATE", source, "reference");
    seen.add(key);
    const rank = integer(row.Rang, source, "Rang", { min: 0 });
    if (rank > 0 && ranks.has(`${competition.id}:${rank}`)) fail("RANKING_RANK_DUPLICATE", source, "Rang");
    ranks.add(`${competition.id}:${rank}`);
    const withdrawn = rank === 0;
    result.ranking_entries.push({ id: stableUuid("ranking", `${competition.id}:${person}`), competition_id: competition.id, person_id: person, contract_id: contractId(row.ID, source, { optional: true }), status: withdrawn ? "withdrawn" : "active", rank: withdrawn ? null : rank, last_active_rank: withdrawn ? integer(row.RausgehangenLetztePlatzierung, source, "RausgehangenLetztePlatzierung", { min: 1 }) : null, withdrawn_at: withdrawn ? instant(row.RausgehangenAm, source, "RausgehangenAm", { optional: false }) : null, withdrawal_reason: withdrawn ? text(row.RausgehangenGrund, { min: 3, max: 500, required: true, source, projection: "RausgehangenGrund" }) : null });
  }
}

function legacyFormatOverride(result, refs, format, { decidingSet, setTarget }) {
  const rules = { ...format.rules, decidingSet: decidingSet || format.rules.decidingSet, setTarget: setTarget || format.rules.setTarget };
  const key = `${format.id}:${rules.setTarget}:${rules.decidingSet}`;
  if (refs.legacyDecidingFormats.has(key)) return refs.legacyDecidingFormats.get(key);
  const id = stableUuid("match-format-version-legacy", key);
  const versionNo = rules.setTarget === 6
    ? ({ "vollstaendiger Satz": 4, MT10: 5, MT7: 6 }[rules.decidingSet])
    : ({ MT10: 2, MT7: 3 }[rules.decidingSet]);
  result.match_format_versions.push({
    id, match_format_id: format.matchFormatId, version_no: versionNo,
    sets_to_win: rules.winningSets, set_target_games: rules.setTarget,
    set_tiebreak_at_games: rules.setTarget === 4 ? 3 : 6,
    deciding_set_type: rules.decidingSet === "vollstaendiger Satz" ? "full_set" : rules.decidingSet === "MT10" ? "match_tiebreak_10" : "match_tiebreak_7", no_ad: format.noAd,
  });
  const value = { ...format, id, rules };
  refs.legacyDecidingFormats.set(key, value);
  return value;
}

function transformMatches(rows, result, refs, findings) {
  for (const { source, value: row } of rows) {
    const contract = contractId(row.ID, source), competition = refs.competitions.get(String(row.BewerbID).trim());
    if (!competition) fail("MATCH_COMPETITION_REFERENCE_MISSING", source, "BewerbID");
    const override = String(row.MatchtypID ?? "").trim();
    let format = override ? refs.matchFormats.get(override) : competition.defaultFormat;
    if (!format) fail("MATCH_FORMAT_REFERENCE_MISSING", source, "MatchtypID");
    const participants = [row.Spieler1ID, row.Spieler2ID, row.Spieler3ID, row.Spieler4ID].map(parseParticipantId);
    const markers = participants.map((item, index) => item.marker ? { marker: item.marker, side: index < 2 ? 1 : 2 } : null).filter(Boolean);
    if (markers.length > 1 || markers.some((marker) => marker.side === 1 && !participants[0].marker || marker.side === 2 && !participants[2].marker)) fail("MATCH_COMPLETION_MARKER_INVALID", source, "participants");
    const kind = markers[0]?.marker === "wo" ? "walkover" : markers[0]?.marker === "ret" ? "retirement" : String(row.Ergebnis ?? "").trim() ? "regular" : null;
    const legacyCompletion = kind ? validateLegacyCompletion({ kind, result: String(row.Ergebnis ?? "").trim(), losingSide: markers[0]?.side }, format.rules) : null;
    const completion = legacyCompletion?.completion || null;
    if (legacyCompletion?.missingTiebreakDetails) finding(findings, "MATCH_TIEBREAK_DETAIL_MISSING", "Matches1", "info", legacyCompletion.missingTiebreakDetails);
    if (legacyCompletion?.decidingSetOverride || legacyCompletion?.setTargetOverride) {
      format = legacyFormatOverride(result, refs, format, { decidingSet: legacyCompletion.decidingSetOverride, setTarget: legacyCompletion.setTargetOverride });
      if (legacyCompletion.decidingSetOverride) finding(findings, "MATCH_LEGACY_DECIDING_SET_OVERRIDE", "Matches1");
      if (legacyCompletion.setTargetOverride) finding(findings, "MATCH_LEGACY_SET_TARGET_OVERRIDE", "Matches1");
    }
    if (completion && !completion.valid) fail(`MATCH_RESULT_${completion.error}`, source, "Ergebnis");
    const id = stableUuid("match", contract), scheduled = instant(row.MatchDate, source, "MatchDate");
    result.matches.push({ id, competition_id: competition.id, contract_id: contract, match_format_version_id: format.id, format_binding_source: override || legacyCompletion?.decidingSetOverride || legacyCompletion?.setTargetOverride ? "match_override" : "competition_default", round_code: text(row.BewerbRunde, { max: 100, source, projection: "BewerbRunde" }), challenged_at: instant(row.ForderungDate, source, "ForderungDate"), scheduled_at: kind === "walkover" ? null : scheduled, reserved_duration_minutes: String(row.Dauer ?? "").trim() ? integer(row.Dauer, source, "Dauer", { min: 0 }) : null, is_ignored: legacyBoolean(row.Ignore, source, "Ignore"), legacy_ptn_rating: text(row["PTN-Wertung"], { max: 100, source, projection: "PTN-Wertung" }), note: text(row.Bemerkung, { max: 500, source, projection: "Bemerkung" }), current_result_id: completion ? stableUuid("match-result", contract) : null });
    for (const sideNo of [1, 2]) {
      const sideId = stableUuid("match-side", `${contract}:${sideNo}`);
      result.match_sides.push({ id: sideId, match_id: id, side_no: sideNo });
      for (const positionNo of [1, 2]) {
        const participant = participants[(sideNo - 1) * 2 + positionNo - 1];
        if (!participant.id) continue;
        const special = participant.id === "PRE" ? "open_bracket" : participant.id === "BYE" ? "bye" : "person";
        if (special === "open_bracket" && positionNo !== 1) fail("MATCH_PARTICIPANT_INVALID", source, "PRE");
        const person = special === "person" ? ensureHistoricalPerson(participant.id, source, result, refs, findings) : null;
        result.match_participants.push({ id: stableUuid("match-participant", `${contract}:${sideNo}:${positionNo}`), match_id: id, side_id: sideId, position_no: positionNo, participant_type: special, person_id: person });
      }
    }
    if (completion) {
      const resultId = stableUuid("match-result", contract);
      const times = normalizePlayTimes(row.MatchStart, row.MatchEnde, source, findings);
      result.match_results.push({ id: resultId, match_id: id, version_no: 1, completion_type: kind, winner_side_no: completion.winnerSide, play_started_at: times.playStartedAt, play_ended_at: times.playEndedAt, first_captured_at: instant(row.ErgebnisErfasstAm, source, "ErgebnisErfasstAm"), walkover_at: kind === "walkover" ? scheduled : null, side_one_rank_snapshot: String(row.Spieler1RangBeiErgebnis ?? "").trim() ? integer(row.Spieler1RangBeiErgebnis, source, "Spieler1RangBeiErgebnis", { min: 0 }) : null, side_two_rank_snapshot: String(row.Spieler3RangBeiErgebnis ?? "").trim() ? integer(row.Spieler3RangBeiErgebnis, source, "Spieler3RangBeiErgebnis", { min: 0 }) : null, provenance: "legacy_snapshot" });
      completion.sets.forEach((set, index) => result.match_result_sets.push({ result_id: resultId, set_no: index + 1, side_one_games: set.side1, side_two_games: set.side2, loser_tiebreak_points: set.tiebreakLoserPoints, incomplete: set.state === "partial" }));
      const historyId = stableUuid("match-result-history", contract);
      result.match_result_history.push({ id: historyId, match_id: id, operation_id: stableUuid("match-import-operation", contract), change_type: "legacy_snapshot", before_result_id: null, after_result_id: resultId, actor_person_id: null, administrative_reason: null, changed_at: instant(row.ErgebnisErfasstAm, source, "ErgebnisErfasstAm") || instant(row.MatchEnde, source, "MatchEnde") || scheduled });
      refs.matchResultHistory.set(contract, historyId);
    }
    refs.matches.set(contract, id);
    refs.matchDetails.set(contract, { id, competitionId: competition.id, formatId: format.id });
  }
}

function compileNavigation(raw, refs) {
  try {
    const url = new URL(String(raw).trim(), "https://epiber.invalid");
    const pages = new Set(["/index.html", "/scoreboard.html", "/Sponsoren.html", "/Matches1.html", "/Bewerbe.html"]);
    if (pages.has(url.pathname) && ![...url.searchParams].length) return { target_type: "page", page_key: url.pathname.slice(1, -5), competition_id: null, enabled: true, problem_code: null };
    const id = url.searchParams.get("id"), competition = refs.competitions.get(id)?.id;
    if (["/bewerbsRaster.html", "/RoundRobin.html", "/entryList.html", "/rangliste.html"].includes(url.pathname) && competition) {
      const target_type = url.pathname === "/rangliste.html" ? "ranking" : url.pathname === "/entryList.html" ? "entry_list" : "competition";
      return { target_type, page_key: null, competition_id: competition, enabled: true, problem_code: null };
    }
  } catch {}
  return { target_type: null, page_key: null, competition_id: null, enabled: false, problem_code: "NAVIGATION_TARGET_INVALID" };
}

function transformNavigation(rows, result, refs, findings) {
  for (const { source, value: row } of rows) {
    const contract = contractId(row.ID, source, { optional: true });
    const target = compileNavigation(row.Ziel, refs);
    if (!target.enabled) finding(findings, target.problem_code, "Navigator", "warning");
    result.navigation_presets.push({ id: stableUuid("navigation", contract || source), tenant_id: TENANT_ID, contract_id: contract, profile_code: text(row.Profil, { max: 50, source, projection: "Profil" }) || "1", label: text(row.Name, { required: true, source, projection: "Name" }), ...target, hall_time_grid_id: null, legacy_target: target.enabled ? null : text(row.Ziel, { max: 500, source, projection: "Ziel" }) });
  }
}

function emptyTables() {
  return Object.fromEntries([
    "people", "person_contacts", "person_addresses", "person_external_identifiers", "memberships", "user_accounts", "credentials", "tenant_role_assignments", "notification_preferences",
    "competition_types", "competition_type_versions", "match_formats", "match_format_versions", "competitions", "competition_gender_eligibility", "competition_entries", "ranking_entries",
    "matches", "match_sides", "match_participants", "match_results", "match_result_sets", "match_result_history", "navigation_presets",
  ].map((name) => [name, []]));
}

function transformSheets(root) {
  const rows = Object.fromEntries(ORDER.map((sheet) => [sheet, loadRows(root, sheet)]));
  const tables = emptyTables(), findings = new Map();
  const refs = { people: new Map(), peopleDetails: new Map(), accounts: new Map(), competitionTypes: new Map(), matchFormats: new Map(), legacyDecidingFormats: new Map(), competitions: new Map(), matches: new Map(), matchDetails: new Map(), matchResultHistory: new Map() };
  transformPeople(rows.Personen, tables, refs, findings);
  transformCompetitionTypes(rows.Bewerbsart, tables, refs);
  transformMatchFormats(rows.Matchtyp, tables, refs);
  transformCompetitions(rows.Bewerb, tables, refs);
  transformEntries(rows.EntryList, tables, refs);
  transformRankings(rows["RL-Platzierung"], tables, refs);
  transformMatches(rows.Matches1, tables, refs, findings);
  transformNavigation(rows.Navigator, tables, refs, findings);
  return { tables, refs, findings: [...findings.values()], counts: Object.fromEntries(ORDER.map((sheet) => [sheet, rows[sheet].length])) };
}

module.exports = { ORDER, ensureHistoricalPerson, normalizePlayTimes, transformSheets, validateLegacyCompletion };
