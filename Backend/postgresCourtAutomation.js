"use strict";

const crypto = require("crypto");
const { AUDIT_ACTIONS } = require("./config.js");
const { parseMatchDate } = require("./matchRules.js");
const { headerIndex, headerOf } = require("./tableUtils.js");

const ACTIVATION_GRACE_MS = 30 * 60 * 1000;
const RETRY_DELAY_MS = 5_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

class PostgresCourtAutomation {
  constructor({ courtService, dataStore, courtPoller, auditLogRepository, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {}, graceMs = ACTIVATION_GRACE_MS }) {
    this.courtService = courtService; this.dataStore = dataStore; this.courtPoller = courtPoller;
    this.auditLogRepository = auditLogRepository; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.log = log; this.graceMs = graceMs; this.started = false; this.running = false; this.again = false; this.timer = null; this.active = null; this.unsubscribers = [];
  }

  start() {
    if (this.started) return;
    this.started = true;
    const trigger = (reason) => {
      const operation = this.reconcile(reason).catch((error) => this.log("warn", "court_automation_reconcile_failed", { reason, errorCode: error.code || "COURT_AUTOMATION_FAILED" }));
      this.active = operation;
      operation.finally(() => { if (this.active === operation) this.active = null; });
      return operation;
    };
    this.unsubscribers.push(this.courtService.onChange(() => trigger("court-state")));
    this.unsubscribers.push(this.dataStore.onChange((event) => { if (event.table === "matches1" && event.current) trigger("matches-update"); }));
    trigger("startup");
  }

  async stop() {
    this.started = false; if (this.timer) this.clearTimer(this.timer); this.timer = null;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    await this.active?.catch(() => {});
  }

  matchesById() {
    const values = this.dataStore.get("matches1"), header = headerOf(values);
    const id = headerIndex(header, "id"), date = headerIndex(header, "matchdate"), result = headerIndex(header, "ergebnis");
    if (id < 0 || date < 0 || result < 0) return new Map();
    const participantIndexes = ["spieler1id", "spieler2id", "spieler3id", "spieler4id"].map((field) => headerIndex(header, field)).filter((index) => index >= 0);
    return new Map(values.slice(1).flatMap((row) => {
      const matchId = String(row[id] || "").trim();
      return matchId ? [[matchId, {
        matchDate: String(row[date] || "").trim(),
        completed: Boolean(String(row[result] || "").trim()) || participantIndexes.some((index) => /\[(?:wo|ret)\]$/i.test(String(row[index] || "").trim())),
      }]] : [];
    }));
  }

  schedule(delay) {
    if (!this.started) return;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { this.timer = null; this.reconcile("scheduled-time").catch(() => {}); }, Math.max(0, Math.min(MAX_TIMER_DELAY_MS, delay)));
    this.timer?.unref?.();
  }

  async audit(entry) {
    if (!this.auditLogRepository || !(AUDIT_ACTIONS.has("*") || AUDIT_ACTIONS.has(entry.action))) return;
    await this.auditLogRepository.record(entry);
  }

  async apply(court, snapshot, { active, status, action, reason, scheduledAt }) {
    const eventId = crypto.randomUUID(), operationId = crypto.randomUUID(), startedAt = this.now();
    const base = { eventId, operationId, actorType: "system", actorId: "court-automation", actorName: "", role: "system", action, targetType: "court", targetId: court, requestId: eventId };
    const before = { court, matchId: snapshot.matchId, active: snapshot.aktiv === 1, automationStatus: snapshot.automaticActivation?.status || "" };
    let auditStarted = false;
    try {
      await this.audit({ ...base, before, result: "started" });
      auditStarted = true;
      await this.courtService.updateAutomation(court, snapshot.revision, { active, status, operationId });
      const courts = await this.courtService.getScoreboardCourts();
      this.courtPoller.setCourtActive({ "1": courts["1"].aktiv === 1, "2": courts["2"].aktiv === 1 });
      await this.audit({ ...base, before, after: { court, matchId: snapshot.matchId, active, automationStatus: status, reason, scheduledAt }, result: "success" });
      this.log("info", "court_automation_completed", { action, court, matchId: snapshot.matchId, reason, scheduledAt, result: "success", durationMs: this.now() - startedAt });
      return true;
    } catch (error) {
      if (auditStarted) try { await this.audit({ ...base, before, result: error.code === "REVISION_CONFLICT" ? "failed" : "unknown", errorCode: error.code || "COURT_AUTOMATION_FAILED" }); } catch {}
      this.log("warn", "court_automation_completed", { action, court, matchId: snapshot.matchId, reason, result: "failed", errorCode: error.code || "COURT_AUTOMATION_FAILED", durationMs: this.now() - startedAt });
      return false;
    }
  }

  async reconcile(reason = "manual") {
    if (!this.started) return;
    if (this.running) { this.again = true; return; }
    this.running = true; if (this.timer) this.clearTimer(this.timer); this.timer = null;
    let nextDueAt = null;
    try {
      const matches = this.matchesById(), courts = await this.courtService.getScoreboardCourts(), now = this.now();
      const retry = () => { nextDueAt = Math.min(nextDueAt ?? Infinity, now + RETRY_DELAY_MS); };
      for (const court of ["1", "2"]) {
        const snapshot = courts[court], matchId = String(snapshot.matchId || "");
        if (!matchId) continue;
        const match = matches.get(matchId); if (!match) continue;
        let status = snapshot.automaticActivation?.status || (parseMatchDate(match.matchDate) ? "pending" : "unscheduled");
        if (match.completed) {
          if (status !== "finished" || snapshot.aktiv === 1) {
            if (!await this.apply(court, snapshot, { active: false, status: "finished", action: "courtAutomaticDeactivation", reason: "match-completed", scheduledAt: match.matchDate })) retry();
          }
          continue;
        }
        if (status === "activated" || status === "finished") continue;
        const dueAt = parseMatchDate(match.matchDate)?.getTime();
        if (!Number.isFinite(dueAt)) {
          if (status !== "unscheduled" && !await this.apply(court, snapshot, { active: null, status: "unscheduled", action: "courtAutomaticActivation", reason: "appointment-invalid", scheduledAt: match.matchDate })) retry();
          continue;
        }
        if (dueAt > now) { nextDueAt = Math.min(nextDueAt ?? Infinity, dueAt); continue; }
        if (now - dueAt > this.graceMs) {
          if (status !== "expired" && !await this.apply(court, snapshot, { active: null, status: "expired", action: "courtAutomaticActivation", reason: "activation-window-expired", scheduledAt: match.matchDate })) retry();
          continue;
        }
        if (status === "pending" && !await this.apply(court, snapshot, { active: true, status: "activated", action: "courtAutomaticActivation", reason, scheduledAt: match.matchDate })) retry();
      }
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.schedule(0); }
      else if (Number.isFinite(nextDueAt)) this.schedule(nextDueAt - this.now());
    }
  }
}

module.exports = { PostgresCourtAutomation };
