"use strict";

const { headerIndex, headerOf } = require("./tableUtils");
const { parseParticipant } = require("./matchRules");

function rankingEntryRestriction(values, competitionId, personId, now = Date.now()) {
  const header = headerOf(values);
  const index = (name) => headerIndex(header, name);
  const minimum = index("einstiegabrang"), expires = index("einstiegfreiab");
  if (minimum < 0 || expires < 0) return null; // Legacy projection has no such metadata.
  const candidates = values.slice(1).filter((row) => !row[index("ignore")]
    && String(row[index("bewerbid")]) === String(competitionId)
    && parseParticipant(row[index("spieler1id")]).id === String(personId)
    && Number(row[minimum]) > 10 && row[expires]);
  candidates.sort((a, b) => Date.parse(b[expires]) - Date.parse(a[expires]));
  if (!candidates.length) return null;
  const row = candidates[0], expiresAt = Date.parse(row[expires]);
  if (!Number.isFinite(expiresAt)) throw new Error("RANKING_ENTRY_STATE_INVALID");
  return { minimumRank: Number(row[minimum]), expiresAt, active: now < expiresAt };
}

module.exports = { rankingEntryRestriction };
