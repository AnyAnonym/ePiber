// index.js — Re-Export Hub
// Alle Cloud Functions werden aus tables/ und composites/ importiert und re-exportiert.

// ── Tables ──────────────────────────────────────────────────────────────────
export {readPlayersList, createPlayer, readPlayerDetails, verifyUserLogin, resetPassword} from "./tables/personen.js";
export {readMatchesList, createMatchData, readMatchRestrictions} from "./tables/matches.js";
export {
  readPreMatches, setMatchDate, createPreMatchData, updatePreMatchDateData,
  deletePreMatchRowData, clearPreMatchRowData,
} from "./tables/preMatches.js";
export {readBewerbe} from "./tables/bewerbe.js";
export {readBewerbsart} from "./tables/bewerbsart.js";
export {readMatchTyp} from "./tables/matchTyp.js";
export {readRlPlatzierung, swapRanksData} from "./tables/rlPlatzierung.js";
export {readEntryList, addEntryList, removeEntryList} from "./tables/entryList.js";
export {withdrawFromRanking} from "./tables/withdrawn.js";

// ── Composites ──────────────────────────────────────────────────────────────
export {addMatch} from "./composites/addMatch.js";
export {setPreMatchResult} from "./composites/setPreMatchResult.js";
export {getMyChallenges} from "./composites/getMyChallenges.js";
