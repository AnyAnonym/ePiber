"use strict";

const crypto = require("crypto");

function registry(definitions, kind) {
  const result = new Map();
  for (const [type, definition] of Object.entries(definitions || {})) {
    const maxAttempts = definition?.maxAttempts ?? 5;
    if (!/^[a-z][a-z0-9_.-]{1,126}$/.test(type) || !Number.isInteger(definition?.version) || definition.version < 1
      || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 || typeof definition.run !== "function") {
      throw Object.assign(new Error(`${kind.toUpperCase()}_HANDLER_INVALID`), { code: `${kind.toUpperCase()}_HANDLER_INVALID` });
    }
    result.set(type, Object.freeze({ version: definition.version, run: definition.run, maxAttempts }));
  }
  return result;
}

class WorkerService {
  constructor({ repository, jobs = {}, outbox = {}, workerId = `worker-${crypto.randomUUID()}`, leaseMs = 60_000, pollMs = 1_000, subscribe = null, log = () => {}, now = Date.now }) {
    this.repository = repository;
    this.jobs = registry(jobs, "job");
    this.outbox = registry(outbox, "outbox");
    this.workerId = workerId;
    this.leaseMs = leaseMs;
    this.pollMs = pollMs;
    this.log = log;
    this.subscribe = subscribe;
    this.running = false;
    this.timer = null;
    this.active = null;
    this.tick = null;
    this.unsubscribe = null;
    this.now = now;
    this.lastMaintenanceAt = null;
    this.queued = false;
    this.wakePending = false;
    this.subscription = null;
  }

  async processJob() {
    const item = await this.repository.claimJob(this.workerId, this.leaseMs);
    if (!item) return false;
    const startedAt = Date.now();
    const handler = this.jobs.get(item.type);
    if (!handler || handler.version !== item.payloadVersion) {
      await this.repository.completeJob(item.id, this.workerId, "dead", handler ? "JOB_PAYLOAD_VERSION_UNSUPPORTED" : "JOB_HANDLER_NOT_REGISTERED");
      this.log("warn", "postgres_job_completed", { jobType: item.type, result: "dead", errorCode: handler ? "JOB_PAYLOAD_VERSION_UNSUPPORTED" : "JOB_HANDLER_NOT_REGISTERED", attempt: item.attemptCount, durationMs: Date.now() - startedAt });
      return true;
    }
    try {
      await handler.run({ payload: item.payload, idempotencyKey: item.idempotencyKey, attempt: item.attemptCount });
      await this.repository.completeJob(item.id, this.workerId, "success");
      this.log("info", "postgres_job_completed", { jobType: item.type, result: "success", attempt: item.attemptCount, durationMs: Date.now() - startedAt });
    } catch (error) {
      const code = String(error.code || "JOB_HANDLER_FAILED").slice(0, 100);
      if (code === "WRITE_OUTCOME_UNKNOWN") {
        await this.repository.completeJob(item.id, this.workerId, "unknown", code);
        this.log("error", "postgres_job_completed", { jobType: item.type, result: "unknown", errorCode: code, attempt: item.attemptCount, durationMs: Date.now() - startedAt });
      } else if (item.attemptCount >= handler.maxAttempts) {
        await this.repository.completeJob(item.id, this.workerId, "dead", code);
        this.log("error", "postgres_job_completed", { jobType: item.type, result: "dead", errorCode: code, attempt: item.attemptCount, durationMs: Date.now() - startedAt });
      } else {
        const delayMs = Math.min(300_000, 1_000 * (2 ** Math.min(item.attemptCount - 1, 8)));
        await this.repository.retryJob(item.id, this.workerId, code, delayMs);
        this.log("warn", "postgres_job_completed", { jobType: item.type, result: "retry", errorCode: code, attempt: item.attemptCount, retryAfterMs: delayMs, durationMs: Date.now() - startedAt });
      }
    }
    return true;
  }

  async processOutbox() {
    const item = await this.repository.claimOutbox(this.workerId, this.leaseMs);
    if (!item) return false;
    const startedAt = Date.now();
    const handler = this.outbox.get(item.type);
    if (!handler || handler.version !== item.payloadVersion) {
      await this.repository.completeOutbox(item.id, this.workerId, "unknown", handler ? "OUTBOX_PAYLOAD_VERSION_UNSUPPORTED" : "OUTBOX_HANDLER_NOT_REGISTERED");
      this.log("error", "postgres_outbox_completed", { eventType: item.type, result: "unknown", errorCode: handler ? "OUTBOX_PAYLOAD_VERSION_UNSUPPORTED" : "OUTBOX_HANDLER_NOT_REGISTERED", attempt: item.attemptCount, durationMs: Date.now() - startedAt });
      return true;
    }
    try {
      await handler.run({ payload: item.payload, idempotencyKey: item.idempotencyKey, attempt: item.attemptCount });
      await this.repository.completeOutbox(item.id, this.workerId, "sent");
      this.log("info", "postgres_outbox_completed", { eventType: item.type, result: "success", attempt: item.attemptCount, durationMs: Date.now() - startedAt });
    } catch (error) {
      const code = String(error.code || "OUTBOX_HANDLER_FAILED").slice(0, 100);
      if (code === "WRITE_OUTCOME_UNKNOWN" || item.attemptCount >= handler.maxAttempts) {
        await this.repository.completeOutbox(item.id, this.workerId, "unknown", code);
        this.log("error", "postgres_outbox_completed", { eventType: item.type, result: "unknown", errorCode: code, attempt: item.attemptCount, durationMs: Date.now() - startedAt });
      } else {
        const delayMs = Math.min(300_000, 1_000 * (2 ** Math.min(item.attemptCount - 1, 8)));
        await this.repository.completeOutbox(item.id, this.workerId, "failed", code, delayMs);
        this.log("warn", "postgres_outbox_completed", { eventType: item.type, result: "retry", errorCode: code, attempt: item.attemptCount, retryAfterMs: delayMs, durationMs: Date.now() - startedAt });
      }
    }
    return true;
  }

  async runOnce() {
    if (await this.processJob()) return true;
    return this.processOutbox();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastMaintenanceAt = null;
    const tick = async () => {
      this.queued = false;
      if (!this.running) return;
      if (this.active) { this.wakePending = true; return; }
      let worked = false;
      // Reserve the iteration before its first asynchronous operation.
      this.active = Promise.resolve().then(async () => {
        const now = this.now();
        if (this.lastMaintenanceAt === null || now - this.lastMaintenanceAt >= 60_000 || now < this.lastMaintenanceAt) {
          const startedAt = this.now();
          try {
            const result = await this.repository.ensureMaintenanceJobs?.(new Date(now));
            this.lastMaintenanceAt = now;
            this.log("info", "postgres_worker_maintenance_schedule_completed", { result: "success", scheduled: result?.scheduled || 0, durationMs: Math.max(0, this.now() - startedAt) });
          } catch {
            this.log("error", "postgres_worker_maintenance_schedule_failed", { result: "failed", errorCode: "MAINTENANCE_SCHEDULE_FAILED", durationMs: Math.max(0, this.now() - startedAt) });
          }
        }
        if (this.running) worked = await this.runOnce();
      });
      try {
        await this.active;
      } catch {
        this.log("error", "postgres_worker_iteration_failed", { errorCode: "WORKER_ITERATION_FAILED" });
      } finally {
        this.active = null;
        if (this.running) {
          const delay = worked || this.wakePending ? 0 : this.pollMs;
          this.wakePending = false;
          this.timer = setTimeout(() => { this.timer = null; tick(); }, delay);
          this.timer.unref?.();
        }
      }
    };
    this.tick = tick;
    if (this.subscribe) {
      this.subscription = Promise.resolve().then(() => this.subscribe(() => this.wake())).then((unsubscribe) => {
        if (this.running) this.unsubscribe = unsubscribe;
        else return unsubscribe?.();
      }).catch(() => {
        this.log("error", "postgres_worker_listener_failed", { errorCode: "WORKER_LISTENER_FAILED" });
      });
    }
    this.wake();
  }

  wake() {
    if (!this.running || !this.tick) return;
    if (this.active) { this.wakePending = true; return; }
    if (this.queued) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queued = true;
    queueMicrotask(this.tick);
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.active?.catch(() => {});
    await this.subscription;
    if (this.unsubscribe) await this.unsubscribe();
    this.unsubscribe = null;
    this.tick = null;
    this.wakePending = false;
  }
}

module.exports = { WorkerService };
