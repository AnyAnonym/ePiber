// Scorer-Service Konfiguration
// Hier ändern für Live/Developer-System
const SHEET_ID = "1auOvEer7i1PW7LO4QX73188Q81Q6QguGyt0zadIIaqo";
const COURT_URL = "https://scorer-tennis.b-cdn.net/json/24.voll.json";
const SCOREBOARD_FUNCTION_URL = "https://europe-west3-e-piber.cloudfunctions.net/getScoreboardCourts";

module.exports = { SHEET_ID, COURT_URL, SCOREBOARD_FUNCTION_URL };
