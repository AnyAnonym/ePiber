// Scorer-Service Konfiguration
// Hier ändern für Live/Developer-System
const SHEET_ID = "1E1CYezDcScIBvH9ebjN0hOkvttTdA6PFIgYKDMaeE04";
const COURT_URL = "https://scorer-tennis.b-cdn.net/json/24.voll.json";
const SCOREBOARD_FUNCTION_URL = "https://europe-west3-e-piber.cloudfunctions.net/getScoreboardCourts";

module.exports = { SHEET_ID, COURT_URL, SCOREBOARD_FUNCTION_URL };
