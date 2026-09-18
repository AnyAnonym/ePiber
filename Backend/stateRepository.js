const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { AppError } = require("./errors.js");
const metrics = require("./metrics.js");
const { hashPayload, hashToken, randomToken } = require("./security.js");

class StateRepository {
  constructor(filename, { now = Date.now } = {}) {
    this.filename = filename;
    this.now = now;
    this.db = null;
    this.failureCount = 0;
    this.lastError = null;
    this.lastProbeAt = 0;
  }

  init() {
    if (this.db) return;
    if (this.filename !== ":memory:") {
      const directory = path.dirname(this.filename);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(this.filename);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec("DROP TABLE IF EXISTS password_reset_proofs");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        sid_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        login TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS monitor_devices (
        monitor_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS operations (
        actor_key TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(actor_key, operation_id)
      );
      CREATE TABLE IF NOT EXISTS login_failures (
        key_hash TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL,
        blocked_until INTEGER NOT NULL
      );
    `);
    const sessionColumns = new Set(this.db.prepare("PRAGMA table_info(sessions)").all().map((column) => column.name));
    if (!sessionColumns.has("login")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN login TEXT NOT NULL DEFAULT ''");
    }
    this.db.exec("UPDATE sessions SET login = email WHERE login = ''");
    if (this.filename !== ":memory:") fs.chmodSync(this.filename, 0o600);
    this.cleanup();
  }

  ensureOpen() {
    if (!this.db) throw new AppError("STATE_UNAVAILABLE", "State-Datenbank ist nicht initialisiert", 503);
  }

  transaction(callback) {
    this.ensureOpen();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getState(key, fallback) {
    this.ensureOpen();
    const row = this.db.prepare("SELECT value_json, revision, updated_at FROM app_state WHERE key = ?").get(key);
    if (!row) return { value: structuredClone(fallback), revision: 0, updatedAt: 0 };
    try {
      return { value: JSON.parse(row.value_json), revision: Number(row.revision), updatedAt: Number(row.updated_at) };
    } catch {
      throw new AppError("STATE_CORRUPT", `State ${key} ist ungueltig`, 503);
    }
  }

  setState(key, value, expectedRevision = undefined) {
    return this.transaction(() => {
      const current = this.db.prepare("SELECT revision FROM app_state WHERE key = ?").get(key);
      const revision = current ? Number(current.revision) : 0;
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new AppError("REVISION_CONFLICT", "State wurde zwischenzeitlich geaendert", 409, { currentRevision: revision });
      }
      const nextRevision = revision + 1;
      const now = this.now();
      this.db.prepare(`
        INSERT INTO app_state(key, value_json, revision, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          revision = excluded.revision,
          updated_at = excluded.updated_at
      `).run(key, JSON.stringify(value), nextRevision, now);
      return { value: structuredClone(value), revision: nextRevision, updatedAt: now };
    });
  }

  applyStateOperation({
    stateKey,
    fallback,
    expectedRevision,
    actorKey,
    operationId,
    endpoint,
    payload,
    update,
    resultForSnapshot,
  }) {
    return this.transaction(() => {
      const operation = this.db.prepare(`
        SELECT endpoint, payload_hash, result_json FROM operations
        WHERE actor_key = ? AND operation_id = ?
      `).get(actorKey, operationId);
      const payloadHash = hashPayload(payload);
      if (operation) {
        if (operation.endpoint !== endpoint || operation.payload_hash !== payloadHash) {
          throw new AppError("OPERATION_ID_CONFLICT", "operationId wurde bereits anders verwendet", 409);
        }
        try {
          return { result: JSON.parse(operation.result_json), repeated: true, snapshot: null };
        } catch {
          throw new AppError("STATE_CORRUPT", "Operationsergebnis ist ungueltig", 503);
        }
      }

      const currentRow = this.db.prepare("SELECT value_json, revision FROM app_state WHERE key = ?").get(stateKey);
      let currentValue = structuredClone(fallback);
      let currentRevision = 0;
      if (currentRow) {
        try {
          currentValue = JSON.parse(currentRow.value_json);
          currentRevision = Number(currentRow.revision);
        } catch {
          throw new AppError("STATE_CORRUPT", `State ${stateKey} ist ungueltig`, 503);
        }
      }
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new AppError("REVISION_CONFLICT", "State wurde zwischenzeitlich geaendert", 409, { currentRevision });
      }
      const value = update(structuredClone(currentValue));
      const snapshot = { value: structuredClone(value), revision: currentRevision + 1, updatedAt: this.now() };
      this.db.prepare(`
        INSERT INTO app_state(key, value_json, revision, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          revision = excluded.revision,
          updated_at = excluded.updated_at
      `).run(stateKey, JSON.stringify(value), snapshot.revision, snapshot.updatedAt);
      const result = resultForSnapshot(snapshot);
      this.db.prepare(`
        INSERT INTO operations(actor_key, operation_id, endpoint, payload_hash, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(actorKey, operationId, endpoint, payloadHash, JSON.stringify(result), this.now());
      return { result, repeated: false, snapshot };
    });
  }

  getUserFavorites(userId) {
    const snapshot = this.getState(`favorites:${userId}`, []);
    if (!Array.isArray(snapshot.value)) {
      throw new AppError("STATE_CORRUPT", "Favoriten-State ist ungueltig", 503);
    }
    return { favorites: snapshot.value, revision: snapshot.revision, updatedAt: snapshot.updatedAt };
  }

  setUserFavorites(userId, { operationId, expectedRevision, favorites }) {
    const operation = this.applyStateOperation({
      stateKey: `favorites:${userId}`,
      fallback: [],
      expectedRevision,
      actorKey: `user:${userId}`,
      operationId,
      endpoint: "setMyFavorites",
      payload: { expectedRevision, favorites },
      update: () => favorites,
      resultForSnapshot: (snapshot) => ({
        success: true,
        favorites: snapshot.value,
        revision: snapshot.revision,
      }),
    });
    return { ...operation.result, repeated: operation.repeated };
  }

  createSession({ userId, email, login = email, ttlMs, reason = "login" }) {
    this.ensureOpen();
    const token = randomToken();
    const tokenHash = hashToken(token);
    const now = this.now();
    const expiresAt = now + ttlMs;
    this.db.prepare(`
      INSERT INTO sessions(sid_hash, user_id, email, login, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tokenHash, userId, email, login, now, expiresAt, now);
    metrics.recordSessionEvent("created", reason);
    return { token, expiresAt };
  }

  limitUserSessions(userId, keepToken, maxSessions) {
    this.ensureOpen();
    const keepTokenHash = hashToken(keepToken);
    const expired = this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").run(userId, this.now()).changes;
    if (expired > 0) metrics.recordSessionEvent("expired", "inactivity", expired);
    const revoked = this.db.prepare(`
      DELETE FROM sessions
      WHERE user_id = ? AND sid_hash NOT IN (
        SELECT sid_hash FROM sessions
        WHERE user_id = ?
        ORDER BY CASE WHEN sid_hash = ? THEN 0 ELSE 1 END, created_at DESC, sid_hash
        LIMIT ?
      )
    `).run(userId, userId, keepTokenHash, maxSessions).changes;
    if (revoked > 0) metrics.recordSessionEvent("revoked", "session_limit", revoked);
    return revoked;
  }

  getSession(token, { ttlMs = 0, refreshIntervalMs = 0 } = {}) {
    this.ensureOpen();
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = this.db.prepare(`
      SELECT user_id, email, login, created_at, expires_at, last_seen_at
      FROM sessions WHERE sid_hash = ?
    `).get(tokenHash);
    if (!row) return null;
    const now = this.now();
    if (Number(row.expires_at) <= now) {
      this.db.prepare("DELETE FROM sessions WHERE sid_hash = ?").run(tokenHash);
      metrics.recordSessionEvent("expired", "inactivity");
      return null;
    }
    let expiresAt = Number(row.expires_at);
    let refreshed = false;
    if (ttlMs > 0 && refreshIntervalMs > 0 && expiresAt - now <= ttlMs - refreshIntervalMs) {
      expiresAt = now + ttlMs;
      this.db.prepare("UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE sid_hash = ?").run(expiresAt, now, tokenHash);
      metrics.recordSessionEvent("refreshed", "activity");
      refreshed = true;
    } else if (now - Number(row.last_seen_at) > 60000) {
      this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE sid_hash = ?").run(now, tokenHash);
    }
    return {
      tokenHash,
      userId: row.user_id,
      email: row.email,
      login: row.login,
      createdAt: Number(row.created_at),
      expiresAt,
      refreshed,
    };
  }

  revokeSession(token, reason = "security_change") {
    this.ensureOpen();
    if (!token) return false;
    const revoked = this.db.prepare("DELETE FROM sessions WHERE sid_hash = ?").run(hashToken(token)).changes > 0;
    if (revoked) metrics.recordSessionEvent("revoked", reason);
    return revoked;
  }

  revokeUserSessions(userId, exceptTokenHash = null, reason = "security_change") {
    this.ensureOpen();
    let revoked;
    if (exceptTokenHash) {
      revoked = this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND sid_hash <> ?").run(userId, exceptTokenHash).changes;
    } else {
      revoked = this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId).changes;
    }
    if (revoked > 0) metrics.recordSessionEvent("revoked", reason, revoked);
    return revoked;
  }

  provisionMonitor(label, monitorId) {
    this.ensureOpen();
    const token = randomToken();
    const now = this.now();
    this.db.prepare(`
      INSERT INTO monitor_devices(monitor_id, label, token_hash, created_at, updated_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `).run(monitorId, label, hashToken(token), now, now);
    return { monitorId, label, token, createdAt: now };
  }

  rotateMonitorToken(monitorId) {
    this.ensureOpen();
    const token = randomToken();
    const now = this.now();
    const result = this.db.prepare(`
      UPDATE monitor_devices SET token_hash = ?, updated_at = ?, revoked_at = NULL
      WHERE monitor_id = ?
    `).run(hashToken(token), now, monitorId);
    if (!result.changes) throw new AppError("MONITOR_NOT_FOUND", "Monitor wurde nicht gefunden", 404);
    return { monitorId, token, updatedAt: now };
  }

  authenticateMonitor(token) {
    this.ensureOpen();
    if (!token) return null;
    const row = this.db.prepare(`
      SELECT monitor_id, label, created_at, updated_at, last_seen_at
      FROM monitor_devices WHERE token_hash = ? AND revoked_at IS NULL
    `).get(hashToken(token));
    if (!row) return null;
    const now = this.now();
    if (!row.last_seen_at || now - Number(row.last_seen_at) > 30000) {
      this.db.prepare("UPDATE monitor_devices SET last_seen_at = ? WHERE monitor_id = ?").run(now, row.monitor_id);
    }
    return {
      monitorId: row.monitor_id,
      label: row.label,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
    };
  }

  listMonitors() {
    this.ensureOpen();
    return this.db.prepare(`
      SELECT monitor_id, label, created_at, updated_at, last_seen_at, revoked_at
      FROM monitor_devices ORDER BY label COLLATE NOCASE, monitor_id
    `).all().map((row) => ({
      monitorId: row.monitor_id,
      label: row.label,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
      revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    }));
  }

  revokeMonitor(monitorId) {
    this.ensureOpen();
    const now = this.now();
    const result = this.db.prepare("UPDATE monitor_devices SET revoked_at = ?, updated_at = ? WHERE monitor_id = ?").run(now, now, monitorId);
    if (!result.changes) throw new AppError("MONITOR_NOT_FOUND", "Monitor wurde nicht gefunden", 404);
    return { monitorId, revokedAt: now };
  }

  getOperation(actorKey, operationId, endpoint, payload) {
    this.ensureOpen();
    const row = this.db.prepare(`
      SELECT endpoint, payload_hash, result_json FROM operations
      WHERE actor_key = ? AND operation_id = ?
    `).get(actorKey, operationId);
    if (!row) return null;
    const payloadHash = hashPayload(payload);
    if (row.endpoint !== endpoint || row.payload_hash !== payloadHash) {
      throw new AppError("OPERATION_ID_CONFLICT", "operationId wurde bereits anders verwendet", 409);
    }
    return JSON.parse(row.result_json);
  }

  getOperationStatus(actorKey, operationId) {
    this.ensureOpen();
    const row = this.db.prepare(`
      SELECT endpoint, result_json, created_at FROM operations
      WHERE actor_key = ? AND operation_id = ?
    `).get(actorKey, operationId);
    if (!row) return null;
    const result = JSON.parse(row.result_json);
    return {
      endpoint: row.endpoint,
      status: result.operationStatus === "unknown" ? "unknown" : "completed",
      createdAt: Number(row.created_at),
    };
  }

  saveOperation(actorKey, operationId, endpoint, payload, result) {
    this.ensureOpen();
    try {
      this.db.prepare(`
        INSERT INTO operations(actor_key, operation_id, endpoint, payload_hash, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(actorKey, operationId, endpoint, hashPayload(payload), JSON.stringify(result), this.now());
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) return this.getOperation(actorKey, operationId, endpoint, payload);
      throw error;
    }
    return result;
  }

  replaceOperation(actorKey, operationId, endpoint, payload, result) {
    this.ensureOpen();
    const existing = this.getOperation(actorKey, operationId, endpoint, payload);
    if (!existing) return this.saveOperation(actorKey, operationId, endpoint, payload, result);
    this.db.prepare(`
      UPDATE operations SET result_json = ?, created_at = ?
      WHERE actor_key = ? AND operation_id = ?
    `).run(JSON.stringify(result), this.now(), actorKey, operationId);
    return result;
  }

  deleteOperation(actorKey, operationId, endpoint, payload) {
    this.ensureOpen();
    const existing = this.getOperation(actorKey, operationId, endpoint, payload);
    if (!existing) return false;
    return this.db.prepare(`
      DELETE FROM operations WHERE actor_key = ? AND operation_id = ?
    `).run(actorKey, operationId).changes === 1;
  }

  getLoginBlock(key) {
    this.ensureOpen();
    const row = this.db.prepare("SELECT blocked_until FROM login_failures WHERE key_hash = ?").get(hashToken(key));
    if (!row) return 0;
    return Math.max(0, Number(row.blocked_until) - this.now());
  }

  recordLoginFailure(key, { windowMs = 900000, maxAttempts = 5, blockMs = 900000 } = {}) {
    this.ensureOpen();
    const keyHash = hashToken(key);
    const now = this.now();
    return this.transaction(() => {
      const row = this.db.prepare("SELECT window_start, count, blocked_until FROM login_failures WHERE key_hash = ?").get(keyHash);
      let windowStart = row ? Number(row.window_start) : now;
      let count = row ? Number(row.count) : 0;
      let blockedUntil = row ? Number(row.blocked_until) : 0;
      if (now - windowStart >= windowMs) {
        windowStart = now;
        count = 0;
        blockedUntil = 0;
      }
      count++;
      if (count >= maxAttempts) blockedUntil = Math.max(blockedUntil, now + blockMs);
      if (!row) {
        const total = Number(this.db.prepare("SELECT COUNT(*) AS count FROM login_failures").get().count);
        if (total >= 10000) {
          this.db.prepare(`
            DELETE FROM login_failures WHERE key_hash IN (
              SELECT key_hash FROM login_failures ORDER BY window_start ASC LIMIT 1000
            )
          `).run();
        }
      }
      this.db.prepare(`
        INSERT INTO login_failures(key_hash, window_start, count, blocked_until)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key_hash) DO UPDATE SET
          window_start = excluded.window_start,
          count = excluded.count,
          blocked_until = excluded.blocked_until
      `).run(keyHash, windowStart, count, blockedUntil);
      return Math.max(0, blockedUntil - now);
    });
  }

  clearLoginFailures(key) {
    this.ensureOpen();
    this.db.prepare("DELETE FROM login_failures WHERE key_hash = ?").run(hashToken(key));
  }

  cleanup() {
    this.ensureOpen();
    const now = this.now();
    const expiredSessions = this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes;
    if (expiredSessions > 0) metrics.recordSessionEvent("expired", "inactivity", expiredSessions);
    this.db.prepare("DELETE FROM operations WHERE created_at < ?").run(now - 86400000);
    this.db.prepare("DELETE FROM login_failures WHERE blocked_until < ? AND window_start < ?").run(now, now - 86400000);
  }

  status() {
    if (!this.db) return { open: false, ready: false, file: this.filename, failureCount: this.failureCount, lastError: this.lastError, lastProbeAt: this.lastProbeAt };
    this.lastProbeAt = this.now();
    try {
      this.db.prepare("SELECT 1 AS ok").get();
      this.lastError = null;
      return { open: true, ready: true, file: this.filename, failureCount: this.failureCount, lastError: null, lastProbeAt: this.lastProbeAt };
    } catch (error) {
      this.failureCount++;
      this.lastError = { at: this.lastProbeAt, code: error.code || "STATE_PROBE_FAILED" };
      return { open: true, ready: false, file: this.filename, failureCount: this.failureCount, lastError: this.lastError, lastProbeAt: this.lastProbeAt };
    }
  }

  countPendingMetadataIntents() {
    this.ensureOpen();
    const rows = this.db.prepare("SELECT value_json FROM app_state WHERE key LIKE 'record-metadata-intent:%'").all();
    return rows.reduce((count, row) => {
      try {
        return count + (JSON.parse(row.value_json).status === "pending" ? 1 : 0);
      } catch {
        return count;
      }
    }, 0);
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }
}

module.exports = { StateRepository };
