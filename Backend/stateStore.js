// ══════════════════════════════════════════════════════
// stateStore.js — In-Memory State (ersetzt Firestore)
// Hält Scoreboard- und Navigator-State zur Laufzeit
// Bei Neustart werden Defaults verwendet
// ══════════════════════════════════════════════════════

const state = {
  scoreboardCourts: {
    "1": {matchId: "", bewerb: "", homePlayer: "", guestPlayer: "", dateTime: "", runde: "", aktiv: 0},
    "2": {matchId: "", bewerb: "", homePlayer: "", guestPlayer: "", dateTime: "", runde: "", aktiv: 0},
  },
  navigatorTarget: {target: "", status: ""},
  navigatorScroll: {amount: 0, ts: 0},
};

// ── Scoreboard Courts ──

function getScoreboardCourts() {
  return state.scoreboardCourts;
}

function setScoreboardCourt(court, data) {
  if (court !== "1" && court !== "2") return false;
  const existing = state.scoreboardCourts[court];
  if (data.matchId !== undefined) existing.matchId = data.matchId;
  if (data.bewerb !== undefined) existing.bewerb = data.bewerb;
  if (data.homePlayer !== undefined) existing.homePlayer = data.homePlayer;
  if (data.guestPlayer !== undefined) existing.guestPlayer = data.guestPlayer;
  if (data.dateTime !== undefined) existing.dateTime = data.dateTime;
  if (data.runde !== undefined) existing.runde = data.runde;
  if (typeof data.aktiv === "number") existing.aktiv = data.aktiv;
  return true;
}

// ── Navigator Target ──

function getNavigatorTarget() {
  return state.navigatorTarget;
}

function setNavigatorTarget(target, status) {
  state.navigatorTarget.target = target || "";
  state.navigatorTarget.status = status || "pending";
}

// ── Navigator Scroll ──

function getNavigatorScroll() {
  return state.navigatorScroll;
}

function setNavigatorScroll(amount) {
  state.navigatorScroll.amount = amount;
  state.navigatorScroll.ts = Date.now();
}

module.exports = {
  getScoreboardCourts,
  setScoreboardCourt,
  getNavigatorTarget,
  setNavigatorTarget,
  getNavigatorScroll,
  setNavigatorScroll,
};
