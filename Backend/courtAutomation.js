const crypto = require("crypto");
const { AUDIT_ACTIONS } = require("./config.js");
const { parseMatchDate } = require("./matchRules.js");
const { headerIndex, headerOf } = require("./tableUtils.js");
const logger = require("./logger.js");

const ACTIVATION_GRACE_MS = 30 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const RETRY_DELAY_MS = 5_000;
const SYSTEM_PRINCIPAL = Object.freeze({ type: "system", id: "court-automation", role: "system", name: "" });

function pendingActivation(matchId, matchDate) {
  return {
    matchId: String(matchId || "").trim(),
    matchDate: String(matchDate || "").trim(),
    status: parseMatchDate(matchDate) ? "pending" : "unscheduled",
  };
}

function sameActivation(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

class CourtAutomation {
  constructor({
    stateStore,
    dataStore,
    courtPoller,
    auditLogRepository = null,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    log = logger.log,
    graceMs = ACTIVATION_GRACE_MS,
  }) {
    this.stateStore = stateStore;
    this.dataStore = dataStore;
    this.courtPoller = courtPoller;
    this.auditLogRepository = auditLogRepository;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.log = log;
    this.graceMs = graceMs;
    this.timer = null;
    this.started = false;
    this.reconciling = false;
    this.reconcileAgain = false;
    this.unsubscribers = [];
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.unsubscribers.push(this.stateStore.onChange((event) => {
      if (event.type === "court") this.reconcile("court-state");
    }));
    this.unsubscribers.push(this.dataStore.onChange((event) => {
      if (event.table === "matches1" && event.current) this.reconcile("matches-update");
    }));
    this.reconcile("startup");
  }

  stop() {
    this.started = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
  }

  matchesById() {
    const values = this.dataStore.get("matches1");
    const header = headerOf(values);
    const idIndex = headerIndex(header, "id");
    const dateIndex = headerIndex(header, "matchdate");
    const resultIndex = headerIndex(header, "ergebnis");
    if (idIndex < 0 || dateIndex < 0 || resultIndex < 0) return new Map();
    const participantIndexes = ["spieler1id", "spieler2id", "spieler3id", "spieler4id"]
      .map((name) => headerIndex(header, name))
      .filter((index) => index >= 0);
    return new Map(values.slice(1).flatMap((row) => {
      const matchId = String(row[idIndex] || "").trim();
      return matchId ? [[matchId, {
        matchDate: String(row[dateIndex] || "").trim(),
        completed: Boolean(String(row[resultIndex] || "").trim())
          || participantIndexes.some((index) => /\[(?:wo|ret)\]$/i.test(String(row[index] || "").trim())),
      }]] : [];
    }));
  }

  schedule(delay) {
    if (!this.started) return;
    if (this.timer) this.clearTimer(this.timer);
    const boundedDelay = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, delay));
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.reconcile("scheduled-time");
    }, boundedDelay);
    this.timer?.unref?.();
  }

  writeAudit({ eventId, operationId, action, court, matchId, before, after = null, result, errorCode = null }) {
    if (!this.auditLogRepository || !(AUDIT_ACTIONS.has("*") || AUDIT_ACTIONS.has(action))) return;
    this.auditLogRepository.record({
      eventId,
      actorType: SYSTEM_PRINCIPAL.type,
      actorId: SYSTEM_PRINCIPAL.id,
      actorName: SYSTEM_PRINCIPAL.name,
      role: SYSTEM_PRINCIPAL.role,
      action,
      targetType: "court",
      targetId: court,
      targetName: "",
      requestId: eventId,
      operationId,
      result,
      before: { court, matchId, ...before },
      after: after ? { court, matchId, ...after } : null,
      errorCode,
    });
  }

  applyActivity(court, snapshot, { active, automaticActivation, action, reason, scheduledAt = "" }) {
    const eventId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const startedAt = this.now();
    const before = { active: snapshot.aktiv === 1, automationStatus: snapshot.automaticActivation?.status || "" };
    try {
      this.writeAudit({ eventId, operationId, action, court, matchId: snapshot.matchId, before, result: "started" });
    } catch (error) {
      this.log("warn", "court_automation_completed", {
        action, court, matchId: snapshot.matchId, reason, result: "failed",
        errorCode: error.code || "AUDIT_LOG_WRITE_FAILED", durationMs: this.now() - startedAt,
      });
      return false;
    }

    let changed = false;
    try {
      this.stateStore.setScoreboardCourt(court, { aktiv: active ? 1 : 0, automaticActivation }, snapshot.revision);
      changed = snapshot.aktiv !== (active ? 1 : 0);
      if (changed) {
        const courts = this.stateStore.getScoreboardCourts();
        this.courtPoller.setCourtActive({ "1": courts["1"].aktiv === 1, "2": courts["2"].aktiv === 1 });
      }
      const after = { active, automationStatus: automaticActivation.status, reason, scheduledAt };
      try {
        this.writeAudit({ eventId, operationId, action, court, matchId: snapshot.matchId, before, after, result: "success" });
      } catch (auditError) {
        this.log("error", "court_automation_completed", {
          action, court, matchId: snapshot.matchId, reason, result: "unknown",
          errorCode: auditError.code || "AUDIT_LOG_WRITE_FAILED", durationMs: this.now() - startedAt,
        });
        return true;
      }
      this.log("info", "court_automation_completed", {
        action, court, matchId: snapshot.matchId, reason, scheduledAt,
        result: "success", activeChanged: changed, durationMs: this.now() - startedAt,
      });
      return true;
    } catch (error) {
      try {
        this.writeAudit({
          eventId, operationId, action, court, matchId: snapshot.matchId, before,
          result: error.code === "REVISION_CONFLICT" ? "failed" : "unknown",
          errorCode: error.code || "COURT_AUTOMATION_FAILED",
        });
      } catch (auditError) {
        this.log("error", "court_automation_audit_failed", { action, court, errorCode: auditError.code || "AUDIT_LOG_WRITE_FAILED" });
      }
      this.log(error.code === "REVISION_CONFLICT" ? "info" : "warn", "court_automation_completed", {
        action, court, matchId: snapshot.matchId, reason,
        result: error.code === "REVISION_CONFLICT" ? "rejected" : "failed",
        errorCode: error.code || "COURT_AUTOMATION_FAILED", durationMs: this.now() - startedAt,
      });
      return false;
    }
  }

  updateAutomation(court, snapshot, automaticActivation, reason, additionalData = {}) {
    if (sameActivation(snapshot.automaticActivation, automaticActivation)
      && Object.entries(additionalData).every(([key, value]) => snapshot[key] === value)) return true;
    try {
      this.stateStore.setScoreboardCourt(court, { automaticActivation, ...additionalData }, snapshot.revision);
      this.log("info", "court_automation_state_updated", {
        court, matchId: snapshot.matchId, reason, status: automaticActivation?.status || "disabled",
      });
      return true;
    } catch (error) {
      this.log(error.code === "REVISION_CONFLICT" ? "info" : "warn", "court_automation_state_update_failed", {
        court, matchId: snapshot.matchId, reason, errorCode: error.code || "COURT_AUTOMATION_FAILED",
      });
      return false;
    }
  }

  reconcile(reason = "manual") {
    if (!this.started) return;
    if (this.reconciling) {
      this.reconcileAgain = true;
      return;
    }
    this.reconciling = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    let nextDueAt = null;
    try {
      const matches = this.matchesById();
      const now = this.now();
      const requestRetry = () => {
        const retryAt = now + RETRY_DELAY_MS;
        nextDueAt = nextDueAt === null ? retryAt : Math.min(nextDueAt, retryAt);
      };
      for (const court of ["1", "2"]) {
        let snapshot = this.stateStore.getCourt(court);
        const matchId = String(snapshot.matchId || "").trim();
        if (!matchId) continue;
        const match = matches.get(matchId);
        if (!match) continue;

        let automation = snapshot.automaticActivation;
        if (!automation || automation.matchId !== matchId) {
          automation = snapshot.aktiv === 1
            ? { ...pendingActivation(matchId, match.matchDate), status: "activated" }
            : pendingActivation(matchId, match.matchDate);
          if (!this.updateAutomation(court, snapshot, automation, "assignment-discovered")) {
            requestRetry();
            continue;
          }
          snapshot = this.stateStore.getCourt(court);
        } else if (["pending", "unscheduled", "expired"].includes(automation.status) && automation.matchDate !== match.matchDate) {
          automation = pendingActivation(matchId, match.matchDate);
          if (!this.updateAutomation(court, snapshot, automation, "appointment-changed", { dateTime: match.matchDate })) {
            requestRetry();
            continue;
          }
          snapshot = this.stateStore.getCourt(court);
        }

        if (match.completed) {
          if (automation.status === "finished" && snapshot.aktiv !== 1) continue;
          if (!this.applyActivity(court, snapshot, {
            active: false,
            automaticActivation: { ...automation, status: "finished" },
            action: "courtAutomaticDeactivation",
            reason: "match-completed",
            scheduledAt: automation.matchDate,
          })) requestRetry();
          continue;
        }

        if (automation.status !== "pending") continue;
        const dueAt = parseMatchDate(automation.matchDate)?.getTime();
        if (!Number.isFinite(dueAt)) {
          if (!this.updateAutomation(court, snapshot, { ...automation, status: "unscheduled" }, "appointment-invalid")) requestRetry();
          continue;
        }
        if (dueAt > now) {
          nextDueAt = nextDueAt === null ? dueAt : Math.min(nextDueAt, dueAt);
          continue;
        }
        if (now - dueAt > this.graceMs) {
          if (!this.updateAutomation(court, snapshot, { ...automation, status: "expired" }, "activation-window-expired")) requestRetry();
          this.log("info", "court_automation_completed", {
            action: "courtAutomaticActivation", court, matchId, reason: "activation-window-expired",
            scheduledAt: automation.matchDate, result: "rejected", errorCode: "ACTIVATION_WINDOW_EXPIRED",
          });
          continue;
        }
        if (!this.applyActivity(court, snapshot, {
          active: true,
          automaticActivation: { ...automation, status: "activated" },
          action: "courtAutomaticActivation",
          reason,
          scheduledAt: automation.matchDate,
        })) requestRetry();
      }
    } catch (error) {
      this.log("warn", "court_automation_reconcile_failed", { reason, errorCode: error.code || "COURT_AUTOMATION_FAILED" });
    } finally {
      this.reconciling = false;
      if (this.reconcileAgain) {
        this.reconcileAgain = false;
        this.schedule(0);
      } else if (nextDueAt !== null) {
        this.schedule(nextDueAt - this.now());
      }
    }
  }
}

module.exports = { ACTIVATION_GRACE_MS, CourtAutomation, pendingActivation };
