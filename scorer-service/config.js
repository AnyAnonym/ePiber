// ══════════════════════════════════════════════════════
// Scorer-Service Konfiguration
// Hier ändern für Live/Developer-System
// ══════════════════════════════════════════════════════

// ── Spreadsheet ──
const SHEET_ID = "1E1CYezDcScIBvH9ebjN0hOkvttTdA6PFIgYKDMaeE04";

// ── Court Scores (externe JSON-Ressource) ──
const COURT_URL = "https://scorer-tennis.b-cdn.net/json/24.voll.json";
const COURT_POLL_INTERVAL = 2000;

// ── Firebase Cloud Functions ──
const SCOREBOARD_FUNCTION_URL = "https://europe-west3-e-piber.cloudfunctions.net/getScoreboardCourts";

// ── Server ──
const PORT = process.env.PORT || 8080;

// ── Daten-Polling (Spreadsheet) ──
const POLL_BASE_INTERVAL = 5000;    // Grundtakt: 5 Sekunden
const POLL_FAST_MULTIPLIER = 2;     // fast = alle 10 Sekunden (2 × Grundtakt)
const POLL_SLOW_MULTIPLIER = 6;     // slow = alle 30 Sekunden (6 × Grundtakt)

// Tabellen und ihre Polling-Kategorie
const TABLE_CONFIG = {
  players:       { range: "Personen",       category: "slow" },
  bewerbe:       { range: "Bewerb",         category: "slow" },
  bewerbsart:    { range: "Bewerbsart",     category: "slow" },
  matches1:      { range: "Matches1",       category: "fast" },
  matchTyp:      { range: "MatchTyp",        category: "slow" },
  rlPlatzierung: { range: "RL-Platzierung",  category: "fast" },
  navigator:     { range: "Navigator",       category: "slow" },
  entryList:     { range: "EntryList",       category: "fast" },
};

module.exports = {
  SHEET_ID,
  COURT_URL,
  COURT_POLL_INTERVAL,
  SCOREBOARD_FUNCTION_URL,
  PORT,
  POLL_BASE_INTERVAL,
  POLL_FAST_MULTIPLIER,
  POLL_SLOW_MULTIPLIER,
  TABLE_CONFIG,
};
