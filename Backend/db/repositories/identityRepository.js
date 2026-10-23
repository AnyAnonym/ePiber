"use strict";

const crypto = require("crypto");

function contractId(value) {
  const normalized = String(value || "").trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) throw Object.assign(new Error("PERSON_ID_INVALID"), { code: "PERSON_ID_INVALID" });
  return normalized;
}

function canonicalLogin(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~@-]+$/.test(normalized)) {
    throw Object.assign(new Error("LOGIN_INVALID"), { code: "LOGIN_INVALID" });
  }
  return normalized;
}

function tokenHash(token) {
  const value = String(token || "");
  if (value.length < 32 || value.length > 256) throw Object.assign(new Error("SESSION_TOKEN_INVALID"), { code: "SESSION_TOKEN_INVALID" });
  return crypto.createHash("sha256").update(value).digest();
}

function targetFromRow(row) {
  if (!row) return null;
  if (row.targetType === "page") {
    return { type: "page", page: row.pageKey, ...(row.navigatorProfileCode ? { params: { profil: row.navigatorProfileCode } } : {}) };
  }
  if (row.targetType === "overlay") return { type: "overlay", overlay: row.overlayKey };
  if (row.targetType === "ranking") return { type: "page", page: "rangliste", params: { id: row.competitionId } };
  if (row.targetType === "entry_list") return { type: "page", page: "entryList", params: { id: row.competitionId } };
  if (row.targetType === "bracket") return { type: "page", page: "bewerbsRaster", params: { id: row.competitionId } };
  if (row.targetType === "round_robin") return { type: "page", page: "RoundRobin", params: { id: row.competitionId, ...(row.roundRobinLayout === null ? {} : { paarungslayout: row.roundRobinLayout }) } };
  if (row.targetType === "competition_history") return { type: "page", page: "Bewerbe", params: { history: "competition", id: row.competitionId } };
  if (row.targetType === "competition_history_all") return { type: "page", page: "Bewerbe", params: { history: "all" } };
  if (row.targetType === "hall_time_grid") return { type: "page", page: "hallzeiten", params: { id: row.hallTimeGridId } };
  if (row.targetType === "competition") return { type: "page", page: "Bewerbe" };
  throw Object.assign(new Error("PREFERENCE_TARGET_INVALID"), { code: "PREFERENCE_TARGET_INVALID" });
}

function favoriteTarget(target) {
  return { targetId: `favorite-${crypto.createHash("sha256").update(JSON.stringify(target)).digest("base64url")}`, ...target };
}

const PREFERENCE_PAGES = new Set([
  "index", "favorites", "Matches1", "players", "Bewerbe", "scoreboard", "adminLogging", "personenNormalisieren",
  "mitgliederAbgleichen", "servicebereich", "hallzeitenVerwalten", "navigator", "monitor",
]);
const PREFERENCE_OVERLAYS = new Set(["match-result", "match-appointment", "profile", "profile-messages"]);

function targetDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("PREFERENCE_TARGET_INVALID"), { code: "PREFERENCE_TARGET_INVALID" });
  if (value.type === "overlay" && PREFERENCE_OVERLAYS.has(value.overlay)) return { targetType: "overlay", overlayKey: value.overlay };
  if (value.type !== "page" || typeof value.page !== "string") throw Object.assign(new Error("PREFERENCE_TARGET_INVALID"), { code: "PREFERENCE_TARGET_INVALID" });
  const params = value.params || {};
  if (value.page === "Bewerbe" && params.history === "competition" && params.id) return { targetType: "competition_history", competitionContractId: params.id };
  if (value.page === "Bewerbe" && params.history === "all") return { targetType: "competition_history_all" };
  if (PREFERENCE_PAGES.has(value.page)) {
    if (value.page === "navigator") return { targetType: "page", pageKey: value.page, navigatorProfileCode: params.profil || null };
    return { targetType: "page", pageKey: value.page };
  }
  if (value.page === "rangliste") return { targetType: "ranking", competitionContractId: params.id };
  if (value.page === "entryList") return { targetType: "entry_list", competitionContractId: params.id };
  if (value.page === "bewerbsRaster") return { targetType: "bracket", competitionContractId: params.id };
  if (value.page === "RoundRobin") return { targetType: "round_robin", competitionContractId: params.id, roundRobinLayout: params.paarungslayout ?? null };
  if (value.page === "hallzeiten") return { targetType: "hall_time_grid", hallTimeGridContractId: params.id };
  throw Object.assign(new Error("PREFERENCE_TARGET_INVALID"), { code: "PREFERENCE_TARGET_INVALID" });
}

function sessionProjection(row) {
  return {
    id: row.id,
    ...(row.accountId ? { accountId: row.accountId } : {}),
    issuedAt: row.issuedAt instanceof Date ? row.issuedAt.getTime() : Number(row.issuedAt),
    lastSeenAt: row.lastSeenAt instanceof Date ? row.lastSeenAt.getTime() : Number(row.lastSeenAt),
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.getTime() : Number(row.expiresAt),
    ...(row.refreshed === undefined ? {} : { refreshed: Boolean(row.refreshed) }),
  };
}

const PERSON_SELECT = `
  SELECT p.id::text AS "internalId", p.contract_id AS id, p.first_name AS "firstName",
         p.last_name AS "lastName", p.birth_date::text AS "birthDate", p.gender_code::text AS gender,
         p.active, p.revision::text AS revision,
         email.contact_value AS email, mobile.contact_value AS phone,
         address.country_label AS "countryLabel", address.postal_code AS "postalCode",
         address.city, address.address_line AS "addressLine", external.external_value AS "clubdeskId",
         m.classification AS member,
         a.id::text AS "accountId", a.login, a.active AS "accountActive", a.auth_revision::text AS "authRevision",
         EXISTS (SELECT 1 FROM identity.password_authorizations password_auth
                  WHERE password_auth.account_id=a.id AND password_auth.consumed_at IS NULL
                    AND password_auth.revoked_at IS NULL AND password_auth.expires_at>clock_timestamp()) AS "passwordSetupAllowed",
         CASE WHEN bool_or(r.role_code='admin') THEN 'admin'
              WHEN bool_or(r.role_code='operator') THEN 'operator'
              ELSE COALESCE(m.classification, 'player') END AS role,
         COALESCE(array_agg(DISTINCT r.role_code ORDER BY r.role_code) FILTER (WHERE r.role_code IS NOT NULL), ARRAY[]::text[]) AS "assignedRoles"
         ,COALESCE(array_agg(DISTINCT preference.channel ORDER BY preference.channel) FILTER (WHERE preference.enabled), ARRAY[]::text[]) AS "notificationChannels"
    FROM identity.people p
    LEFT JOIN identity.person_contacts email ON email.person_id=p.id AND email.contact_type='email' AND email.active
    LEFT JOIN identity.person_contacts mobile ON mobile.person_id=p.id AND mobile.contact_type='mobile' AND mobile.active
    LEFT JOIN identity.person_addresses address ON address.person_id=p.id AND address.active
    LEFT JOIN identity.person_external_identifiers external ON external.person_id=p.id AND external.provider='clubdesk' AND external.active
    LEFT JOIN messaging.notification_preferences preference ON preference.person_id=p.id
    LEFT JOIN core.sections s ON s.tenant_id=p.tenant_id AND s.section_code='tennis'
    LEFT JOIN identity.memberships m ON m.person_id=p.id AND m.section_id=s.id AND m.valid_until IS NULL
    LEFT JOIN identity.user_accounts a ON a.person_id=p.id
    LEFT JOIN identity.tenant_role_assignments r ON r.person_id=p.id AND r.tenant_id=p.tenant_id AND r.revoked_at IS NULL
`;

class IdentityRepository {
  constructor({ database, context }) {
    this.database = database;
    this.context = context;
  }

  async people() {
    const result = await this.database.query(`${PERSON_SELECT}
      WHERE p.tenant_id=$1::uuid
      GROUP BY p.id, email.contact_value, mobile.contact_value, address.id, external.id, m.classification, a.id
      ORDER BY p.contract_id::numeric
    `, [this.context.tenantId]);
    return result.rows;
  }

  async publicPlayers() {
    const result = await this.database.query(`
      SELECT contract_id AS id,first_name AS "firstName",last_name AS "lastName",active
        FROM identity.people WHERE tenant_id=$1::uuid ORDER BY contract_id::numeric
    `, [this.context.tenantId]);
    return result.rows;
  }

  async memberDirectory() {
    const result = await this.database.query(`
      SELECT p.contract_id AS id,p.first_name AS "firstName",p.last_name AS "lastName",p.birth_date::text AS "birthDate",
             email.contact_value AS email,mobile.contact_value AS phone
        FROM identity.people p
        LEFT JOIN identity.person_contacts email ON email.person_id=p.id AND email.contact_type='email' AND email.active
        LEFT JOIN identity.person_contacts mobile ON mobile.person_id=p.id AND mobile.contact_type='mobile' AND mobile.active
       WHERE p.tenant_id=$1::uuid AND p.active ORDER BY p.contract_id::numeric
    `, [this.context.tenantId]);
    return result.rows;
  }

  async personByContractId(personId) {
    const result = await this.database.query(`${PERSON_SELECT}
      WHERE p.tenant_id=$1::uuid AND p.contract_id=$2
      GROUP BY p.id, email.contact_value, mobile.contact_value, address.id, external.id, m.classification, a.id
    `, [this.context.tenantId, contractId(personId)]);
    return result.rows[0] || null;
  }

  async accountForLogin(login, { includeCredential = false } = {}) {
    const normalized = canonicalLogin(login);
    const result = await this.database.query(`
      SELECT a.id::text AS "accountId", a.person_id::text AS "personInternalId", p.contract_id AS "personId",
             a.login, a.active AS "accountActive", a.auth_revision::text AS "authRevision", p.active AS "personActive",
             ${includeCredential ? "c.credential_schema AS \"credentialSchema\", c.secret_hash AS \"secretHash\"," : ""}
             EXISTS (
               SELECT 1 FROM identity.password_authorizations pa
                WHERE pa.account_id=a.id AND pa.consumed_at IS NULL AND pa.revoked_at IS NULL AND pa.expires_at>clock_timestamp()
             ) AS "passwordSetupAllowed"
        FROM identity.user_accounts a
        JOIN identity.people p ON p.id=a.person_id AND p.tenant_id=a.tenant_id
        ${includeCredential ? "LEFT JOIN identity.credentials c ON c.account_id=a.id AND c.credential_type='password' AND c.active" : ""}
       WHERE a.tenant_id=$1::uuid AND a.login=$2
    `, [this.context.tenantId, normalized]);
    return result.rows[0] || null;
  }

  async createSession({ accountId, authRevision, loginSnapshot, ttlMs, token = crypto.randomBytes(32).toString("base64url") }) {
    if (!/^[0-9a-f-]{36}$/i.test(String(accountId || ""))) throw Object.assign(new Error("ACCOUNT_ID_INVALID"), { code: "ACCOUNT_ID_INVALID" });
    if (!/^[1-9][0-9]*$/.test(String(authRevision || ""))) throw Object.assign(new Error("AUTH_REVISION_INVALID"), { code: "AUTH_REVISION_INVALID" });
    if (!Number.isInteger(ttlMs) || ttlMs < 300_000 || ttlMs > 7_776_000_000) throw Object.assign(new Error("SESSION_TTL_INVALID"), { code: "SESSION_TTL_INVALID" });
    const login = canonicalLogin(loginSnapshot);
    const hash = tokenHash(token);
    const result = await this.database.query(`
      INSERT INTO identity.sessions(account_id, token_hash, auth_revision, login_snapshot, issued_at, last_seen_at, expires_at)
      SELECT a.id, $2, $3::bigint, $4, clock_timestamp(), clock_timestamp(), clock_timestamp() + ($5::bigint * interval '1 millisecond')
        FROM identity.user_accounts a
       WHERE a.id=$1::uuid AND a.tenant_id=$6::uuid AND a.active AND a.auth_revision=$3::bigint
      RETURNING id::text AS id, issued_at AS "issuedAt", last_seen_at AS "lastSeenAt", expires_at AS "expiresAt"
    `, [accountId, hash, authRevision, login, ttlMs, this.context.tenantId]);
    if (!result.rowCount) throw Object.assign(new Error("ACCOUNT_STATE_CHANGED"), { code: "ACCOUNT_STATE_CHANGED" });
    return { token, ...sessionProjection(result.rows[0]) };
  }

  async createBoundedSession({ accountId, authRevision, loginSnapshot, ttlMs, maxSessions, token = crypto.randomBytes(32).toString("base64url") }) {
    if (!Number.isInteger(maxSessions) || maxSessions < 2 || maxSessions > 50) throw Object.assign(new Error("SESSION_LIMIT_INVALID"), { code: "SESSION_LIMIT_INVALID" });
    return this.database.withTransaction("identity.session.create", async (transaction) => {
      const login = canonicalLogin(loginSnapshot);
      const hash = tokenHash(token);
      const inserted = await transaction.query(`
        INSERT INTO identity.sessions(account_id, token_hash, auth_revision, login_snapshot, issued_at, last_seen_at, expires_at)
        SELECT a.id, $2, $3::bigint, $4, clock_timestamp(), clock_timestamp(), clock_timestamp()+($5::bigint*interval '1 millisecond')
          FROM identity.user_accounts a
         WHERE a.id=$1::uuid AND a.tenant_id=$6::uuid AND a.active AND a.auth_revision=$3::bigint
        RETURNING id::text AS id, issued_at AS "issuedAt", last_seen_at AS "lastSeenAt", expires_at AS "expiresAt"
      `, [accountId, hash, authRevision, login, ttlMs, this.context.tenantId]);
      if (!inserted.rowCount) throw Object.assign(new Error("ACCOUNT_STATE_CHANGED"), { code: "ACCOUNT_STATE_CHANGED" });
      await transaction.query(`
        UPDATE identity.sessions SET revoked_at=clock_timestamp()
         WHERE id IN (
           SELECT id FROM identity.sessions
            WHERE account_id=$1::uuid AND revoked_at IS NULL AND expires_at>clock_timestamp() AND token_hash<>$2
            ORDER BY last_seen_at DESC, issued_at DESC, id DESC OFFSET $3
         )
      `, [accountId, hash, maxSessions - 1]);
      return { token, ...sessionProjection(inserted.rows[0]) };
    });
  }

  async authenticatedSession(token, { ttlMs = 0, refreshIntervalMs = 0 } = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs < 0 || !Number.isInteger(refreshIntervalMs) || refreshIntervalMs < 0) throw Object.assign(new Error("SESSION_REFRESH_INVALID"), { code: "SESSION_REFRESH_INVALID" });
    return this.database.withTransaction("identity.session.read", async (transaction) => {
      const locked = await transaction.query(`
        SELECT s.id, s.account_id, p.id AS person_id, p.contract_id, a.login, a.auth_revision,
               s.issued_at, s.last_seen_at, s.expires_at
          FROM identity.sessions s
          JOIN identity.user_accounts a ON a.id=s.account_id
          JOIN identity.people p ON p.id=a.person_id AND p.tenant_id=a.tenant_id
         WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
           AND a.tenant_id=$2::uuid AND a.active AND p.active AND s.auth_revision=a.auth_revision
           AND s.login_snapshot=a.login
         FOR SHARE OF s, a, p
      `, [tokenHash(token), this.context.tenantId]);
      if (!locked.rowCount) return null;
      const base = locked.rows[0];
      let refreshed = false;
      if (ttlMs > 0 && refreshIntervalMs > 0) {
        const refreshedResult = await transaction.query(`
          UPDATE identity.sessions
             SET last_seen_at=clock_timestamp(), expires_at=clock_timestamp()+($2::bigint*interval '1 millisecond')
           WHERE id=$1::uuid AND last_seen_at<=clock_timestamp()-($3::bigint*interval '1 millisecond')
          RETURNING last_seen_at, expires_at
        `, [base.id, ttlMs, refreshIntervalMs]);
        if (refreshedResult.rowCount) {
          base.last_seen_at = refreshedResult.rows[0].last_seen_at;
          base.expires_at = refreshedResult.rows[0].expires_at;
          refreshed = true;
        }
      }
      const profile = await transaction.query(`${PERSON_SELECT}
        WHERE p.id=$1::uuid AND p.tenant_id=$2::uuid
        GROUP BY p.id, email.contact_value, mobile.contact_value, address.id, external.id, m.classification, a.id
      `, [base.person_id, this.context.tenantId]);
      if (!profile.rowCount) return null;
      return {
        session: sessionProjection({
          id: base.id,
          accountId: base.account_id,
          issuedAt: base.issued_at,
          lastSeenAt: base.last_seen_at,
          expiresAt: base.expires_at,
          refreshed,
        }),
        person: profile.rows[0],
      };
    });
  }

  async session(token) {
    const result = await this.database.query(`
      SELECT s.id::text AS id, s.account_id::text AS "accountId", p.contract_id AS "personId",
             s.login_snapshot AS login, s.issued_at AS "issuedAt", s.last_seen_at AS "lastSeenAt", s.expires_at AS "expiresAt",
             a.auth_revision::text AS "authRevision"
        FROM identity.sessions s
        JOIN identity.user_accounts a ON a.id=s.account_id
        JOIN identity.people p ON p.id=a.person_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
         AND a.tenant_id=$2::uuid AND a.active AND p.active AND s.auth_revision=a.auth_revision
    `, [tokenHash(token), this.context.tenantId]);
    return result.rows[0] || null;
  }

  async revokeSession(token, reason = "logout") {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(reason)) throw Object.assign(new Error("SESSION_REASON_INVALID"), { code: "SESSION_REASON_INVALID" });
    const result = await this.database.query(`
      UPDATE identity.sessions s SET revoked_at=clock_timestamp()
       FROM identity.user_accounts a
       WHERE s.account_id=a.id AND a.tenant_id=$2::uuid AND s.token_hash=$1 AND s.revoked_at IS NULL
    `, [tokenHash(token), this.context.tenantId]);
    return result.rowCount > 0;
  }

  async revokeAccountSessions(accountId) {
    const result = await this.database.query(`
      UPDATE identity.sessions s SET revoked_at=clock_timestamp()
       FROM identity.user_accounts a
       WHERE s.account_id=a.id AND a.id=$1::uuid AND a.tenant_id=$2::uuid AND s.revoked_at IS NULL
    `, [accountId, this.context.tenantId]);
    return result.rowCount;
  }

  async recordLoginAttempt(keyHash, keyType, maxAttempts) {
    const hash = Buffer.from(keyHash || []);
    if (hash.length !== 32) throw Object.assign(new Error("RATE_KEY_INVALID"), { code: "RATE_KEY_INVALID" });
    if (!new Set(["ip", "ip_login"]).has(keyType) || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw Object.assign(new Error("RATE_LIMIT_INVALID"), { code: "RATE_LIMIT_INVALID" });
    const result = await this.database.query(`
      INSERT INTO identity.login_rate_limits(key_hash, key_type, window_started_at, attempt_count, blocked_until, expires_at)
      VALUES ($1,$2,clock_timestamp(),1,CASE WHEN $3<=1 THEN clock_timestamp()+interval '15 minutes' END,clock_timestamp()+interval '30 minutes')
      ON CONFLICT (key_type,key_hash) DO UPDATE SET
        window_started_at=CASE WHEN identity.login_rate_limits.window_started_at<=clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE identity.login_rate_limits.window_started_at END,
        attempt_count=CASE WHEN identity.login_rate_limits.window_started_at<=clock_timestamp()-interval '15 minutes' THEN 1 ELSE identity.login_rate_limits.attempt_count+1 END,
        blocked_until=CASE
          WHEN identity.login_rate_limits.blocked_until>clock_timestamp() THEN identity.login_rate_limits.blocked_until
          WHEN (CASE WHEN identity.login_rate_limits.window_started_at<=clock_timestamp()-interval '15 minutes' THEN 1 ELSE identity.login_rate_limits.attempt_count+1 END)>=$3
            THEN clock_timestamp()+interval '15 minutes'
          ELSE NULL END,
        expires_at=clock_timestamp()+interval '30 minutes'
      RETURNING GREATEST(0, ceil(extract(epoch FROM (COALESCE(blocked_until,clock_timestamp())-clock_timestamp()))*1000))::bigint AS "blockedForMs"
    `, [hash, keyType, maxAttempts]);
    return Number(result.rows[0].blockedForMs);
  }

  async clearLoginAttempts(hashes) {
    const values = hashes.map((value) => Buffer.from(value));
    if (!values.length || values.some((value) => value.length !== 32)) throw Object.assign(new Error("RATE_KEY_INVALID"), { code: "RATE_KEY_INVALID" });
    await this.database.query("DELETE FROM identity.login_rate_limits WHERE key_hash=ANY($1::bytea[])", [values]);
  }

  async setPasswordAuthorization({ accountId, issuedByPersonId, allowed }) {
    return this.database.withTransaction("identity.password.authorization", async (transaction) => {
      const account = await transaction.query(`
        SELECT account.id, issuer.id AS issuer_id
          FROM identity.user_accounts account
          JOIN identity.people issuer ON issuer.tenant_id=account.tenant_id AND issuer.contract_id=$3
         WHERE account.id=$1::uuid AND account.tenant_id=$2::uuid
         FOR UPDATE OF account
      `, [accountId, this.context.tenantId, contractId(issuedByPersonId)]);
      if (!account.rowCount) throw Object.assign(new Error("ACCOUNT_NOT_FOUND"), { code: "ACCOUNT_NOT_FOUND" });
      await transaction.query(`
        UPDATE identity.password_authorizations SET revoked_at=clock_timestamp()
         WHERE account_id=$1::uuid AND consumed_at IS NULL AND revoked_at IS NULL
      `, [accountId]);
      if (allowed) {
        await transaction.query(`
          INSERT INTO identity.password_authorizations(account_id, issued_by_person_id, issued_at, expires_at)
          VALUES ($1::uuid,$2::uuid,statement_timestamp(),statement_timestamp()+interval '24 hours')
        `, [accountId, account.rows[0].issuer_id]);
      }
      return { allowed };
    });
  }

  async userFavorites(personId) {
    const result = await this.database.query(`
      SELECT favorite.position, favorite.target_type AS "targetType", favorite.page_key AS "pageKey",
             favorite.overlay_key AS "overlayKey", competition.contract_id AS "competitionId",
             grid.contract_id AS "hallTimeGridId", favorite.round_robin_layout AS "roundRobinLayout",
             favorite.navigator_profile_code AS "navigatorProfileCode", COALESCE(state.favorites_revision,favorite.revision,0)::text AS revision,
             state.favorites_updated_at AS "updatedAt"
        FROM identity.people person
        JOIN identity.user_accounts account ON account.person_id=person.id
        LEFT JOIN identity.user_preference_states state ON state.account_id=account.id
        LEFT JOIN identity.user_favorites favorite ON favorite.account_id=account.id
        LEFT JOIN play.competitions competition ON competition.id=favorite.competition_id
        LEFT JOIN venue.hall_time_grids grid ON grid.id=favorite.hall_time_grid_id
       WHERE person.tenant_id=$1::uuid AND person.contract_id=$2
       ORDER BY favorite.position
    `, [this.context.tenantId, contractId(personId)]);
    if (!result.rowCount) throw Object.assign(new Error("PERSON_NOT_FOUND"), { code: "PERSON_NOT_FOUND" });
    const revision = Number(result.rows[0].revision);
    const updatedAt = result.rows[0]?.updatedAt ? result.rows[0].updatedAt.getTime() : null;
    const rows = result.rows.filter((row) => row.position !== null);
    return {
      favorites: rows.map((row) => favoriteTarget(targetFromRow(row))),
      revision,
      updatedAt,
    };
  }

  async userStartPage(personId) {
    const result = await this.database.query(`
      SELECT start.target_type AS "targetType", start.page_key AS "pageKey", start.overlay_key AS "overlayKey",
             competition.contract_id AS "competitionId", grid.contract_id AS "hallTimeGridId",
             start.round_robin_layout AS "roundRobinLayout", start.navigator_profile_code AS "navigatorProfileCode",
             COALESCE(state.start_page_revision,start.revision,0)::text AS revision,
             COALESCE(state.start_page_updated_at,start.updated_at) AS "updatedAt"
        FROM identity.people person
        JOIN identity.user_accounts account ON account.person_id=person.id
        LEFT JOIN identity.user_preference_states state ON state.account_id=account.id
        LEFT JOIN identity.user_start_pages start ON start.account_id=account.id
        LEFT JOIN play.competitions competition ON competition.id=start.competition_id
        LEFT JOIN venue.hall_time_grids grid ON grid.id=start.hall_time_grid_id
       WHERE person.tenant_id=$1::uuid AND person.contract_id=$2
    `, [this.context.tenantId, contractId(personId)]);
    if (!result.rowCount) throw Object.assign(new Error("PERSON_NOT_FOUND"), { code: "PERSON_NOT_FOUND" });
    const row = result.rows[0];
    return row.targetType
      ? { target: targetFromRow(row), revision: Number(row.revision), updatedAt: row.updatedAt.getTime() }
      : { target: { type: "page", page: "index" }, revision: 0, updatedAt: null };
  }

  async preferenceAccount(target, personId) {
    const result = await target.query(`
      SELECT account.id
        FROM identity.people person
        JOIN identity.user_accounts account ON account.person_id=person.id
       WHERE person.tenant_id=$1::uuid AND person.contract_id=$2 AND person.active AND account.active
       FOR UPDATE OF account
    `, [this.context.tenantId, contractId(personId)]);
    if (!result.rowCount) throw Object.assign(new Error("PERSON_NOT_FOUND"), { code: "PERSON_NOT_FOUND" });
    const accountId = result.rows[0].id;
    await target.query(`
      INSERT INTO identity.user_preference_states(
        account_id, favorites_revision, favorites_updated_at, start_page_revision, start_page_updated_at
      )
      SELECT $1,
             COALESCE((SELECT max(revision) FROM identity.user_favorites WHERE account_id=$1),0),
             CASE WHEN EXISTS (SELECT 1 FROM identity.user_favorites WHERE account_id=$1) THEN clock_timestamp() END,
             COALESCE((SELECT revision FROM identity.user_start_pages WHERE account_id=$1),0),
             (SELECT updated_at FROM identity.user_start_pages WHERE account_id=$1)
      ON CONFLICT DO NOTHING
    `, [accountId]);
    return accountId;
  }

  async resolvePreferenceTarget(target, value) {
    const descriptor = targetDescriptor(value);
    const result = await target.query(`
      SELECT
        (SELECT competition.id FROM play.competitions competition JOIN core.sections section ON section.id=competition.section_id
          WHERE section.tenant_id=$1::uuid AND competition.contract_id=$2) AS competition_id,
        (SELECT grid.id FROM venue.hall_time_grids grid JOIN core.sections section ON section.id=grid.section_id
          WHERE section.tenant_id=$1::uuid AND grid.contract_id=$3) AS hall_time_grid_id
    `, [this.context.tenantId, descriptor.competitionContractId || null, descriptor.hallTimeGridContractId || null]);
    if (descriptor.competitionContractId && !result.rows[0].competition_id) throw Object.assign(new Error("PREFERENCE_COMPETITION_NOT_FOUND"), { code: "PREFERENCE_COMPETITION_NOT_FOUND" });
    if (descriptor.hallTimeGridContractId && !result.rows[0].hall_time_grid_id) throw Object.assign(new Error("PREFERENCE_HALL_TIME_GRID_NOT_FOUND"), { code: "PREFERENCE_HALL_TIME_GRID_NOT_FOUND" });
    return {
      targetType: descriptor.targetType,
      pageKey: descriptor.pageKey || null,
      overlayKey: descriptor.overlayKey || null,
      competitionId: result.rows[0].competition_id || null,
      hallTimeGridId: result.rows[0].hall_time_grid_id || null,
      roundRobinLayout: descriptor.roundRobinLayout ?? null,
      navigatorProfileCode: descriptor.navigatorProfileCode || null,
    };
  }

  async replaceUserFavorites(target, personId, expectedRevision, favorites) {
    const accountId = await this.preferenceAccount(target, personId);
    const state = await target.query("SELECT favorites_revision FROM identity.user_preference_states WHERE account_id=$1 FOR UPDATE", [accountId]);
    if (Number(state.rows[0].favorites_revision) !== expectedRevision) throw Object.assign(new Error("REVISION_CONFLICT"), { code: "REVISION_CONFLICT" });
    const descriptors = [];
    for (const favorite of favorites) descriptors.push(await this.resolvePreferenceTarget(target, favorite));
    const nextRevision = expectedRevision + 1;
    await target.query("DELETE FROM identity.user_favorites WHERE account_id=$1", [accountId]);
    for (let position = 0; position < descriptors.length; position++) {
      const item = descriptors[position];
      await target.query(`
        INSERT INTO identity.user_favorites(
          account_id, position, target_type, page_key, overlay_key, competition_id, hall_time_grid_id,
          round_robin_layout, navigator_profile_code, revision
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [accountId, position + 1, item.targetType, item.pageKey, item.overlayKey, item.competitionId, item.hallTimeGridId, item.roundRobinLayout, item.navigatorProfileCode, nextRevision]);
    }
    const updated = await target.query(`
      UPDATE identity.user_preference_states
         SET favorites_revision=$2, favorites_updated_at=clock_timestamp()
       WHERE account_id=$1 RETURNING favorites_updated_at AS "updatedAt"
    `, [accountId, nextRevision]);
    return { success: true, favorites, revision: nextRevision, updatedAt: updated.rows[0].updatedAt.getTime() };
  }

  async replaceUserStartPage(target, personId, expectedRevision, value) {
    const accountId = await this.preferenceAccount(target, personId);
    const state = await target.query("SELECT start_page_revision FROM identity.user_preference_states WHERE account_id=$1 FOR UPDATE", [accountId]);
    if (Number(state.rows[0].start_page_revision) !== expectedRevision) throw Object.assign(new Error("REVISION_CONFLICT"), { code: "REVISION_CONFLICT" });
    const item = await this.resolvePreferenceTarget(target, value);
    const nextRevision = expectedRevision + 1;
    await target.query(`
      INSERT INTO identity.user_start_pages(
        account_id, target_type, page_key, overlay_key, competition_id, hall_time_grid_id,
        round_robin_layout, navigator_profile_code, revision, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())
      ON CONFLICT (account_id) DO UPDATE SET
        target_type=excluded.target_type, page_key=excluded.page_key, overlay_key=excluded.overlay_key,
        competition_id=excluded.competition_id, hall_time_grid_id=excluded.hall_time_grid_id,
        round_robin_layout=excluded.round_robin_layout, navigator_profile_code=excluded.navigator_profile_code,
        revision=excluded.revision, updated_at=excluded.updated_at
    `, [accountId, item.targetType, item.pageKey, item.overlayKey, item.competitionId, item.hallTimeGridId, item.roundRobinLayout, item.navigatorProfileCode, nextRevision]);
    const updated = await target.query(`
      UPDATE identity.user_preference_states
         SET start_page_revision=$2, start_page_updated_at=clock_timestamp()
       WHERE account_id=$1 RETURNING start_page_updated_at AS "updatedAt"
    `, [accountId, nextRevision]);
    return { success: true, target: value, revision: nextRevision, updatedAt: updated.rows[0].updatedAt.getTime() };
  }

  async frontendLoggingSnapshot() {
    const settings = await this.database.query(`
      SELECT enabled, minimum_level AS level, include_anonymous AS "includeAnonymous",
             round(info_sample_rate*100)::integer AS "sampleRatePercent", batch_size AS "batchSize",
             flush_interval_ms AS "flushIntervalMs", default_target_level AS "defaultTargetLevel",
             default_target_duration_minutes AS "defaultTargetDurationMinutes",
             info_retention_days AS "normalRetentionDays", debug_retention_days AS "targetedRetentionDays",
             revision::text, targets_revision::text AS "targetsRevision"
        FROM identity.frontend_logging_settings WHERE tenant_id=$1::uuid
    `, [this.context.tenantId]);
    if (!settings.rowCount) throw Object.assign(new Error("FRONTEND_LOGGING_SETTINGS_MISSING"), { code: "FRONTEND_LOGGING_SETTINGS_MISSING" });
    const targets = await this.database.query(`
      SELECT person.contract_id AS "personId", target.minimum_level AS level,
             extract(epoch FROM target.created_at)*1000 AS "createdAt",
             extract(epoch FROM target.expires_at)*1000 AS "expiresAt",
             creator.contract_id AS "createdBy"
        FROM identity.frontend_logging_targets target
        JOIN identity.people person ON person.id=target.person_id
        JOIN identity.people creator ON creator.id=target.created_by_person_id
       WHERE target.tenant_id=$1::uuid AND target.expires_at>clock_timestamp()
       ORDER BY target.expires_at, person.contract_id::numeric
    `, [this.context.tenantId]);
    const row = settings.rows[0];
    return {
      settings: {
        enabled: row.enabled,
        level: row.level,
        includeAnonymous: row.includeAnonymous,
        sampleRatePercent: row.sampleRatePercent,
        batchSize: row.batchSize,
        flushIntervalMs: row.flushIntervalMs,
        defaultTargetLevel: row.defaultTargetLevel,
        defaultTargetDurationMinutes: row.defaultTargetDurationMinutes,
        maxTargetDurationMinutes: 1440,
        normalRetentionDays: row.normalRetentionDays,
        targetedRetentionDays: row.targetedRetentionDays,
        revision: Number(row.revision),
      },
      targets: {
        value: Object.fromEntries(targets.rows.map((target) => [target.personId, {
          ...target,
          createdAt: Number(target.createdAt),
          expiresAt: Number(target.expiresAt),
        }])),
        revision: Number(row.targetsRevision),
      },
    };
  }

  async updateFrontendLoggingSettings(settings, expectedRevision) {
    const result = await this.database.query(`
      UPDATE identity.frontend_logging_settings SET
        enabled=$3, minimum_level=$4, include_anonymous=$5,
        info_sample_rate=$6::numeric/100, debug_sample_rate=$6::numeric/100,
        batch_size=$7, flush_interval_ms=$8, default_target_level=$9,
        default_target_duration_minutes=$10, revision=revision+1, updated_at=clock_timestamp()
       WHERE tenant_id=$1::uuid AND revision=$2::bigint
       RETURNING revision::text
    `, [this.context.tenantId, expectedRevision, settings.enabled, settings.level, settings.includeAnonymous,
      settings.sampleRatePercent, settings.batchSize, settings.flushIntervalMs, settings.defaultTargetLevel,
      settings.defaultTargetDurationMinutes]);
    if (!result.rowCount) throw Object.assign(new Error("REVISION_CONFLICT"), { code: "REVISION_CONFLICT" });
    return { value: settings, revision: Number(result.rows[0].revision) };
  }

  async setFrontendLoggingTarget({ personId, level, durationMinutes, expectedRevision, createdBy }) {
    return this.database.withTransaction("identity.frontend_logging.target.set", async (transaction) => {
      const state = await transaction.query(`
        SELECT targets_revision FROM identity.frontend_logging_settings
         WHERE tenant_id=$1::uuid FOR UPDATE
      `, [this.context.tenantId]);
      if (!state.rowCount) throw Object.assign(new Error("FRONTEND_LOGGING_SETTINGS_MISSING"), { code: "FRONTEND_LOGGING_SETTINGS_MISSING" });
      if (Number(state.rows[0].targets_revision) !== expectedRevision) throw Object.assign(new Error("REVISION_CONFLICT"), { code: "REVISION_CONFLICT" });
      const people = await transaction.query(`
        SELECT target.id AS target_id, creator.id AS creator_id
          FROM identity.people target
          JOIN identity.people creator ON creator.tenant_id=target.tenant_id AND creator.contract_id=$3 AND creator.active
         WHERE target.tenant_id=$1::uuid AND target.contract_id=$2 AND target.active
      `, [this.context.tenantId, contractId(personId), contractId(createdBy)]);
      if (!people.rowCount) throw Object.assign(new Error("PERSON_NOT_FOUND"), { code: "PERSON_NOT_FOUND" });
      const nextRevision = expectedRevision + 1;
      const stored = await transaction.query(`
        INSERT INTO identity.frontend_logging_targets(
          tenant_id, person_id, minimum_level, expires_at, created_by_person_id, revision, created_at
        ) VALUES ($1::uuid,$2::uuid,$3,clock_timestamp()+($4::bigint*interval '1 minute'),$5::uuid,$6,clock_timestamp())
        ON CONFLICT (tenant_id,person_id) DO UPDATE SET
          minimum_level=excluded.minimum_level, expires_at=excluded.expires_at,
          created_by_person_id=excluded.created_by_person_id, revision=excluded.revision, created_at=excluded.created_at
        RETURNING extract(epoch FROM created_at)*1000 AS "createdAt", extract(epoch FROM expires_at)*1000 AS "expiresAt"
      `, [this.context.tenantId, people.rows[0].target_id, level, durationMinutes, people.rows[0].creator_id, nextRevision]);
      await transaction.query("UPDATE identity.frontend_logging_settings SET targets_revision=$2, updated_at=clock_timestamp() WHERE tenant_id=$1::uuid", [this.context.tenantId, nextRevision]);
      return {
        target: { personId: String(personId), level, createdAt: Number(stored.rows[0].createdAt), expiresAt: Number(stored.rows[0].expiresAt), createdBy: String(createdBy) },
        revision: nextRevision,
      };
    }, { isolation: "serializable", retries: 2 });
  }

  async removeFrontendLoggingTarget({ personId, expectedRevision }) {
    return this.database.withTransaction("identity.frontend_logging.target.remove", async (transaction) => {
      const state = await transaction.query("SELECT targets_revision FROM identity.frontend_logging_settings WHERE tenant_id=$1::uuid FOR UPDATE", [this.context.tenantId]);
      if (!state.rowCount) throw Object.assign(new Error("FRONTEND_LOGGING_SETTINGS_MISSING"), { code: "FRONTEND_LOGGING_SETTINGS_MISSING" });
      if (Number(state.rows[0].targets_revision) !== expectedRevision) throw Object.assign(new Error("REVISION_CONFLICT"), { code: "REVISION_CONFLICT" });
      const removed = await transaction.query(`
        DELETE FROM identity.frontend_logging_targets target
         USING identity.people person
         WHERE target.tenant_id=$1::uuid AND target.person_id=person.id AND person.contract_id=$2
      `, [this.context.tenantId, contractId(personId)]);
      if (!removed.rowCount) return { personId: String(personId), removed: false, revision: expectedRevision };
      const nextRevision = expectedRevision + 1;
      await transaction.query("UPDATE identity.frontend_logging_settings SET targets_revision=$2, updated_at=clock_timestamp() WHERE tenant_id=$1::uuid", [this.context.tenantId, nextRevision]);
      return { personId: String(personId), removed: true, revision: nextRevision };
    }, { isolation: "serializable", retries: 2 });
  }

  async replacePassword({ accountId, expectedAuthRevision, credentialSchema, secretHash, requireAuthorization = false }) {
    if (!new Set(["scrypt_v1", "legacy_sha256"]).has(credentialSchema)) throw Object.assign(new Error("CREDENTIAL_SCHEMA_INVALID"), { code: "CREDENTIAL_SCHEMA_INVALID" });
    if (!String(secretHash || "")) throw Object.assign(new Error("CREDENTIAL_HASH_INVALID"), { code: "CREDENTIAL_HASH_INVALID" });
    return this.database.withTransaction("identity.password.replace", async (transaction) => {
      const locked = await transaction.query(`
        SELECT id, auth_revision FROM identity.user_accounts
         WHERE id=$1::uuid AND tenant_id=$2::uuid AND auth_revision=$3::bigint AND active
         FOR UPDATE
      `, [accountId, this.context.tenantId, expectedAuthRevision]);
      if (!locked.rowCount) throw Object.assign(new Error("ACCOUNT_STATE_CHANGED"), { code: "ACCOUNT_STATE_CHANGED" });
      if (requireAuthorization) {
        const authorization = await transaction.query(`
          UPDATE identity.password_authorizations SET consumed_at=clock_timestamp()
           WHERE id=(SELECT id FROM identity.password_authorizations
                      WHERE account_id=$1::uuid AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()
                      ORDER BY issued_at DESC LIMIT 1 FOR UPDATE)
          RETURNING id
        `, [accountId]);
        if (!authorization.rowCount) throw Object.assign(new Error("PASSWORD_SETUP_INVALID"), { code: "PASSWORD_SETUP_INVALID" });
      }
      await transaction.query(`
        UPDATE identity.credentials
           SET active=false, revoked_at=clock_timestamp(), secret_hash=NULL, revoked_reason='replaced'
         WHERE account_id=$1::uuid AND credential_type='password' AND active
      `, [accountId]);
      await transaction.query(`
        INSERT INTO identity.credentials(account_id, credential_type, credential_schema, secret_hash)
        VALUES ($1::uuid, 'password', $2, $3)
      `, [accountId, credentialSchema, secretHash]);
      const updated = await transaction.query(`
        UPDATE identity.user_accounts SET auth_revision=auth_revision+1, revision=revision+1, updated_at=clock_timestamp()
         WHERE id=$1::uuid
         RETURNING auth_revision::text AS "authRevision"
      `, [accountId]);
      await transaction.query("UPDATE identity.sessions SET revoked_at=clock_timestamp() WHERE account_id=$1::uuid AND revoked_at IS NULL", [accountId]);
      return updated.rows[0];
    }, { isolation: "serializable", retries: 2 });
  }
}

module.exports = { IdentityRepository, canonicalLogin, contractId, tokenHash };
