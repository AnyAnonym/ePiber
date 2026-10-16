"use strict";

const crypto = require("crypto");
const { promisify } = require("util");
const { AppError } = require("./errors.js");
const { hasAnyRole } = require("./personRoles.js");
const { timingSafeTextEqual } = require("./security.js");
const { loginValue, passwordHashValue } = require("./validators.js");

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const DUMMY_SALT = Buffer.alloc(16);
const DUMMY_KEY = Buffer.alloc(SCRYPT_KEY_LENGTH);
const DUMMY_STORED_HASH = `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${DUMMY_SALT.toString("base64url")}$${DUMMY_KEY.toString("base64url")}`;

class PostgresAuthService {
  constructor({ repository, rateLimitSecret, sessionTtlMs, sessionRefreshIntervalMs, sessionMaxPerUser }) {
    this.repository = repository;
    this.rateLimitSecret = Buffer.from(rateLimitSecret || []);
    if (this.rateLimitSecret.length < 32) throw Object.assign(new Error("AUTH_RATE_LIMIT_SECRET_INVALID"), { code: "AUTH_RATE_LIMIT_SECRET_INVALID" });
    this.sessionTtlMs = sessionTtlMs;
    this.sessionRefreshIntervalMs = sessionRefreshIntervalMs;
    this.sessionMaxPerUser = sessionMaxPerUser;
    this.activeScryptOperations = 0;
    this.userQueues = new Map();
  }

  runForUser(userId, callback) {
    const previous = this.userQueues.get(userId) || Promise.resolve();
    const operation = previous.catch(() => {}).then(callback);
    this.userQueues.set(userId, operation);
    operation.finally(() => {
      if (this.userQueues.get(userId) === operation) this.userQueues.delete(userId);
    }).catch(() => {});
    return operation;
  }

  async runScrypt(callback) {
    if (this.activeScryptOperations >= 4) throw new AppError("AUTH_BUSY", "Authentifizierung ist ausgelastet", 503);
    this.activeScryptOperations++;
    try { return await callback(); } finally { this.activeScryptOperations--; }
  }

  async createStoredPasswordHash(clientHash) {
    const credential = passwordHashValue(clientHash);
    return this.runScrypt(async () => {
      const salt = crypto.randomBytes(16);
      const derived = await scryptAsync(credential, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
      return `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
    });
  }

  verifyCredential(credential, storedHash) {
    return this.runScrypt(async () => {
      const value = passwordHashValue(credential);
      if (/^[0-9a-f]{64}$/i.test(storedHash)) {
        const valid = timingSafeTextEqual(value, storedHash.toLowerCase());
        await scryptAsync(value, DUMMY_SALT, SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
        return { valid, legacy: true };
      }
      const parts = String(storedHash || "").split("$");
      if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") return { valid: false, legacy: false };
      const [N, r, p] = parts.slice(2, 5).map(Number);
      if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return { valid: false, legacy: false };
      const salt = Buffer.from(parts[5], "base64url");
      const expected = Buffer.from(parts[6], "base64url");
      if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return { valid: false, legacy: false };
      const actual = await scryptAsync(value, salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
      return { valid: crypto.timingSafeEqual(actual, expected), legacy: false };
    });
  }

  rateHash(value) {
    return crypto.createHmac("sha256", this.rateLimitSecret).update(String(value)).digest();
  }

  roles(person) {
    return [...new Set([person.member || "player", ...(person.assignedRoles || [])])];
  }

  publicUser(person) {
    return {
      id: person.id,
      firstName: person.firstName || "",
      lastName: person.lastName,
      email: person.email || "",
      login: person.login || "",
      phone: person.phone || "",
      birthDate: person.birthDate || "",
      gender: person.gender || "",
      role: person.role,
      roles: this.roles(person),
      member: person.member || "",
      notificationChannels: person.notificationChannels || [],
    };
  }

  authResult(sessionData) {
    if (!sessionData) return null;
    const person = sessionData.person;
    const user = this.publicUser(person);
    return {
      session: sessionData.session,
      principal: {
        type: "user", id: person.id, login: person.login, email: person.email || "",
        role: person.role, roles: user.roles, member: person.member || "",
        name: [person.firstName, person.lastName].filter(Boolean).join(" "),
      },
      user,
    };
  }

  async login({ login, passwordHash, ip }) {
    const normalizedLogin = loginValue(login);
    const credential = passwordHashValue(passwordHash);
    const hashes = [this.rateHash(`ip:${ip}`), this.rateHash(`ip_login:${ip}|${normalizedLogin}`)];
    const blockedFor = Math.max(
      await this.repository.recordLoginAttempt(hashes[0], "ip", 20),
      await this.repository.recordLoginAttempt(hashes[1], "ip_login", 5),
    );
    if (blockedFor > 0) throw new AppError("LOGIN_RATE_LIMIT", "Zu viele Anmeldeversuche", 429, { retryAfterMs: blockedFor });
    const initial = await this.repository.accountForLogin(normalizedLogin, { includeCredential: true });
    if (!initial?.personActive || !initial.accountActive || !initial.secretHash) {
      await this.verifyCredential(credential, DUMMY_STORED_HASH);
      throw new AppError("LOGIN_FAILED", "Login oder Passwort ist ungueltig", 401);
    }
    return this.runForUser(initial.personId, async () => {
      const account = await this.repository.accountForLogin(normalizedLogin, { includeCredential: true });
      const verification = await this.verifyCredential(credential, account?.accountId === initial.accountId ? account.secretHash : DUMMY_STORED_HASH);
      if (!account || account.accountId !== initial.accountId || !account.personActive || !account.accountActive || !verification.valid) {
        throw new AppError("LOGIN_FAILED", "Login oder Passwort ist ungueltig", 401);
      }
      if (verification.legacy) {
        const stored = await this.createStoredPasswordHash(credential);
        await this.repository.replacePassword({ accountId: account.accountId, expectedAuthRevision: account.authRevision, credentialSchema: "scrypt_v1", secretHash: stored });
      }
      const current = await this.repository.accountForLogin(normalizedLogin);
      await this.repository.clearLoginAttempts(hashes);
      const session = await this.repository.createBoundedSession({
        accountId: current.accountId,
        authRevision: current.authRevision,
        loginSnapshot: current.login,
        ttlMs: this.sessionTtlMs,
        maxSessions: this.sessionMaxPerUser,
      });
      const person = await this.repository.personByContractId(current.personId);
      return { session, user: this.publicUser(person) };
    });
  }

  async getUserForToken(token, { refreshSession = false } = {}) {
    try {
      return this.authResult(await this.repository.authenticatedSession(token, refreshSession ? {
        ttlMs: this.sessionTtlMs,
        refreshIntervalMs: this.sessionRefreshIntervalMs,
      } : {}));
    } catch (error) {
      if (error.code === "SESSION_TOKEN_INVALID") return null;
      throw error;
    }
  }

  getDiagnosticIdentity(token) {
    return this.getUserForToken(token).then((auth) => auth ? { id: auth.principal.id, name: auth.principal.name, role: auth.principal.role } : null);
  }

  async requireUser(token, options) {
    const auth = await this.getUserForToken(token, options);
    if (!auth) throw new AppError("AUTH_REQUIRED", "Anmeldung erforderlich", 401);
    return auth;
  }

  async requireRole(token, roles, options) {
    const auth = await this.requireUser(token, options);
    if (!hasAnyRole(auth.principal, roles)) throw new AppError("FORBIDDEN", "Berechtigung fehlt", 403);
    return auth;
  }

  async logout(token) {
    try { await this.repository.revokeSession(token, "logout"); } catch (error) {
      if (error.code !== "SESSION_TOKEN_INVALID") throw error;
    }
  }

  async changeOwnPassword(token, currentPasswordHash, newPasswordHash) {
    const initial = await this.requireUser(token);
    return this.runForUser(initial.principal.id, async () => {
      const auth = await this.requireUser(token);
      const account = await this.repository.accountForLogin(auth.principal.login, { includeCredential: true });
      const verification = await this.verifyCredential(currentPasswordHash, account.secretHash);
      if (!verification.valid) throw new AppError("PASSWORD_INVALID", "Aktuelles Passwort ist falsch", 403);
      const secretHash = await this.createStoredPasswordHash(newPasswordHash);
      const changed = await this.repository.replacePassword({ accountId: account.accountId, expectedAuthRevision: account.authRevision, credentialSchema: "scrypt_v1", secretHash });
      const session = await this.repository.createBoundedSession({ accountId: account.accountId, authRevision: changed.authRevision, loginSnapshot: account.login, ttlMs: this.sessionTtlMs, maxSessions: this.sessionMaxPerUser });
      const person = await this.repository.personByContractId(auth.principal.id);
      return { success: true, session, user: this.publicUser(person) };
    });
  }

  async setPasswordAsAdmin(token, personId, newPasswordHash) {
    await this.requireRole(token, ["admin"]);
    return this.runForUser(personId, async () => {
      await this.requireRole(token, ["admin"]);
      const person = await this.repository.personByContractId(personId);
      if (!person?.accountId) throw new AppError("PERSON_NOT_FOUND", "Person oder Konto wurde nicht gefunden", 404);
      const secretHash = await this.createStoredPasswordHash(newPasswordHash);
      await this.repository.replacePassword({ accountId: person.accountId, expectedAuthRevision: person.authRevision, credentialSchema: "scrypt_v1", secretHash });
      return { success: true, personId: person.id };
    });
  }

  async setPasswordSetupAllowed(token, personId, allowed) {
    const admin = await this.requireRole(token, ["admin"]);
    const person = await this.repository.personByContractId(personId);
    if (!person?.accountId) throw new AppError("PERSON_NOT_FOUND", "Person oder Konto wurde nicht gefunden", 404);
    await this.repository.setPasswordAuthorization({ accountId: person.accountId, issuedByPersonId: admin.principal.id, allowed });
    return { success: true, personId: person.id, allowed };
  }

  async setupPassword(login, newPasswordHash) {
    const normalizedLogin = loginValue(login);
    const account = await this.repository.accountForLogin(normalizedLogin);
    if (!account?.accountActive || !account.personActive || !account.passwordSetupAllowed) {
      await this.createStoredPasswordHash(newPasswordHash);
      throw new AppError("PASSWORD_SETUP_INVALID", "Passwortvergabe ist nicht freigegeben", 401);
    }
    return this.runForUser(account.personId, async () => {
      const current = await this.repository.accountForLogin(normalizedLogin);
      if (!current?.passwordSetupAllowed) throw new AppError("PASSWORD_SETUP_INVALID", "Passwortvergabe ist nicht freigegeben", 401);
      const secretHash = await this.createStoredPasswordHash(newPasswordHash);
      await this.repository.replacePassword({ accountId: current.accountId, expectedAuthRevision: current.authRevision, credentialSchema: "scrypt_v1", secretHash, requireAuthorization: true });
      return Object.defineProperty({ success: true }, "_audit", { value: { personId: current.personId }, enumerable: false });
    });
  }

  async people() { return this.repository.people(); }
  async findById(id) { return this.repository.personByContractId(id); }
  async publicPlayersTable() {
    const people = await this.people();
    return [["ID", "Vorname", "Nachname", "Aktiv"], ...people.map((person) => [person.id, person.firstName || "", person.lastName, person.active ? "1" : "0"])];
  }
  async memberDirectoryTable() {
    const people = (await this.people()).filter((person) => person.active);
    return [["ID", "Vorname", "Nachname", "TelefonMobil", "E-Mail", "GeburtsDatum", "Aktiv"], ...people.map((person) => [person.id, person.firstName || "", person.lastName, person.phone || "", person.email || "", person.birthDate || "", "1"])];
  }
  async memberProfile(id, { includeAdminFields = false } = {}) {
    const person = await this.repository.personByContractId(id);
    if (!person) throw new AppError("PERSON_NOT_FOUND", "Person wurde nicht gefunden", 404);
    return { id: person.id, firstName: person.firstName || "", lastName: person.lastName, email: person.email || "", phone: person.phone || "", birthDate: person.birthDate || "", ...(includeAdminFields ? { login: person.login || "", passwordSetupAllowed: person.passwordSetupAllowed } : {}) };
  }
}

module.exports = { PostgresAuthService };
