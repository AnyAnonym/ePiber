/* eslint-disable valid-jsdoc */
/* eslint-disable no-unused-vars */
/* eslint-disable require-jsdoc */
/* eslint-disable max-len */

// 🔹 Table CRUD (reine Tabellen-Funktionen)
export {readPlayersList, createPlayer, readPlayerDetails, verifyUserLogin, resetPassword} from "./tables/personen.js";
export {readMatchesList, readMatchRestrictions} from "./tables/matches.js";
export {readPreMatches, setMatchDate} from "./tables/preMatches.js";
export {readBewerbe} from "./tables/bewerbe.js";
export {readBewerbsart} from "./tables/bewerbsart.js";
export {readMatchTyp} from "./tables/matchTyp.js";
export {readRlPlatzierung} from "./tables/rlPlatzierung.js";
export {readEntryList, addEntryList, removeEntryList} from "./tables/entryList.js";
export {withdrawFromRanking} from "./tables/withdrawn.js";

// 🔹 Composite Functions (orchestrieren mehrere Tabellen)
export {addMatch} from "./composites/addMatch.js";
export {setPreMatchResult} from "./composites/setPreMatchResult.js";
export {getMyChallenges} from "./composites/getMyChallenges.js";
