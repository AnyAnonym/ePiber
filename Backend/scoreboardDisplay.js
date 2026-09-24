const { headerIndex, headerOf } = require("./tableUtils.js");

const DISPLAY_RULES_SCHEMA_VERSION = 1;

function inspectMatchtypDisplayRules(matchtypen, matchtypId) {
  const id = String(matchtypId || "").trim();
  if (!id) return { rules: null, reason: null };
  const header = headerOf(matchtypen);
  const idIndex = headerIndex(header, "id");
  const tiebreakIndex = headerIndex(header, "satztiebreak");
  const decidingSetIndex = headerIndex(header, "entscheidender satz");
  if (idIndex < 0 || tiebreakIndex < 0 || decidingSetIndex < 0) {
    return { rules: null, reason: "MATCHTYP_SCHEMA_INVALID" };
  }
  const row = matchtypen.slice(1).find((entry) => String(entry[idIndex] || "").trim() === id);
  if (!row) return { rules: null, reason: "MATCHTYP_NOT_FOUND" };
  const trigger = String(row[tiebreakIndex] || "").trim().split("-").map((value) => value.trim());
  const decidingSetValue = String(row[decidingSetIndex] || "").trim();
  const decidingSetKey = decidingSetValue.toUpperCase().replaceAll("Ä", "AE");
  if (trigger.length !== 2 || trigger.some((value) => !/^\d+$/.test(value))) {
    return { rules: null, reason: "MATCHTYP_RULES_INVALID" };
  }
  const normalizedTrigger = trigger.map((value) => String(BigInt(value)));
  if (normalizedTrigger[0] !== normalizedTrigger[1]) return { rules: null, reason: "MATCHTYP_RULES_INVALID" };
  if (!new Set(["VOLLSTAENDIGER SATZ", "MT7", "MT10"]).has(decidingSetKey)) {
    return { rules: null, reason: "MATCHTYP_RULES_INVALID" };
  }
  return { rules: {
    schemaVersion: DISPLAY_RULES_SCHEMA_VERSION,
    source: "matchtyp",
    matchtypId: id,
    satztiebreak: normalizedTrigger.join("-"),
    entscheidenderSatz: decidingSetKey === "VOLLSTAENDIGER SATZ" ? "vollstaendiger Satz" : decidingSetKey,
  }, reason: null };
}

function snapshotMatchtypDisplayRules(matchtypen, matchtypId) {
  return inspectMatchtypDisplayRules(matchtypen, matchtypId).rules;
}

function completedMatches(matches) {
  const header = headerOf(matches);
  const idIndex = headerIndex(header, "id");
  const resultIndex = headerIndex(header, "ergebnis");
  if (idIndex < 0 || resultIndex < 0) return new Map();
  const participantIndexes = ["spieler1id", "spieler2id", "spieler3id", "spieler4id"]
    .map((name) => headerIndex(header, name))
    .filter((index) => index >= 0);
  return new Map(matches.slice(1).flatMap((row) => {
    const matchId = String(row[idIndex] || "").trim();
    if (!matchId) return [];
    const result = String(row[resultIndex] || "").trim();
    const markedComplete = participantIndexes.some((index) => /\[(?:wo|ret)\]$/i.test(String(row[index] || "").trim()));
    return [[matchId, { completed: Boolean(result) || markedComplete, result }]];
  }));
}

function finalResultScore(result) {
  const tokens = String(result || "").trim() ? String(result).trim().split("/") : [];
  const sets = tokens.map((token) => token.match(/^(\d{1,2})-(\d{1,2})(?:\(\d{1,2}\))?$/));
  if (sets.some((set) => !set)) return null;
  const values = sets.slice(0, 3).map((set) => [String(Number(set[1])), String(Number(set[2]))]);
  while (values.length < 3) values.push(["0", "0"]);
  return {
    satz1home: values[0][0], satz1gast: values[0][1],
    satz2home: values[1][0], satz2gast: values[1][1],
    satz3home: values[2][0], satz3gast: values[2][1],
    punktehome: "0", punktegast: "0",
  };
}

function projectScoreboardScores(scoreSnapshot, { courts, matches = [] }) {
  if (!scoreSnapshot || !Array.isArray(scoreSnapshot.courts)) return scoreSnapshot;

  const matchStates = completedMatches(matches);
  const projected = structuredClone(scoreSnapshot);
  projected.courts = projected.courts.map((score) => {
    const court = courts?.[String(score.platz)] || {};
    const match = matchStates.get(String(court.matchId || ""));
    const clearedFinishedMatch = court.automaticActivation?.status === "finished" && match && !match.completed;
    const finalScore = match?.completed ? finalResultScore(match.result) : clearedFinishedMatch ? finalResultScore("") : null;
    const effectiveScore = finalScore ? { ...score, ...finalScore } : score;
    const candidate = court.displayRules;
    const rules = candidate?.schemaVersion === DISPLAY_RULES_SCHEMA_VERSION
      && candidate.source === "matchtyp"
      && String(candidate.matchtypId || "") === String(court.matchtypId || "")
      ? candidate
      : null;
    const decidingSet = String(rules?.entscheidenderSatz || "").trim().toUpperCase();
    const displayScore = { ...effectiveScore, satz3matchtiebreak: decidingSet === "MT7" || decidingSet === "MT10" };
    const trigger = String(rules?.satztiebreak || "").trim().split("-").map((value) => value.trim());
    if (trigger.length !== 2 || trigger.some((value) => !/^\d+$/.test(value))) return displayScore;

    const tieBreakActive = [1, 2].some((set) => (
      String(effectiveScore[`satz${set}home`] ?? "").trim() === trigger[0]
      && String(effectiveScore[`satz${set}gast`] ?? "").trim() === trigger[1]
    ));
    if (!tieBreakActive) return displayScore;
    return {
      ...displayScore,
      satz3home: "0",
      satz3gast: "0",
      punktehome: effectiveScore.satz3home,
      punktegast: effectiveScore.satz3gast,
    };
  });
  return projected;
}

module.exports = {
  DISPLAY_RULES_SCHEMA_VERSION,
  inspectMatchtypDisplayRules,
  finalResultScore,
  projectScoreboardScores,
  snapshotMatchtypDisplayRules,
};
