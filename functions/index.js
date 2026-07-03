/* eslint-disable max-len */
// index.js — Re-Export Hub
// Alle Cloud Functions werden aus tables/ und composites/ importiert und re-exportiert.

// ── Tables ──────────────────────────────────────────────────────────────────
export {readPlayersList, readPlayerDetails, verifyUserLogin, resetPassword} from "./tables/personen.js";
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
export {readNavigator} from "./tables/navigator.js";
export {setNavigatorTarget, getNavigatorTarget, setNavigatorScroll, getNavigatorScroll} from "./tables/navigatorState.js";
export {setScoreboardCourt, getScoreboardCourts} from "./tables/scoreboardState.js";
export {withdrawFromRanking} from "./tables/withdrawn.js";

// ── Composites ──────────────────────────────────────────────────────────────
export {addMatch} from "./composites/addMatch.js";
export {setPreMatchResult} from "./composites/setPreMatchResult.js";
export {getMyChallenges} from "./composites/getMyChallenges.js";
