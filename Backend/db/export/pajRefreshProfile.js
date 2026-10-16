"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { canonicalizeSheetHeader, parseSemicolonCsv } = require("../import/sheetInspector");
const { verifySourcePackage } = require("../import/sourcePackage");
const { deriveScryptCredential } = require("../passwordCredential");

const PROFILE = "paj-refresh-v1";

function profileError(code, message) { return Object.assign(new Error(message), { code }); }

function deriveCredential(clientHash, exportRunId, personId) {
  try { return deriveScryptCredential(clientHash, `${PROFILE}\0${exportRunId}`, personId); }
  catch (error) {
    if (error.code === "PAJ_PASSWORD_HASH_INVALID") throw profileError("PAJ_REFRESH_PASSWORD_HASH_INVALID", "Testpasswort-Hash ist ungueltig");
    throw error;
  }
}

function sanitizePeopleRows(rows, { clientHash, exportRunId }) {
  const rectangular = rows.map((row) => [...row]);
  const header = canonicalizeSheetHeader("Personen", rectangular[0]);
  const index = (field) => header.indexOf(field);
  const idIndex = index("ID"), loginIndex = index("Login"), passwordIndex = index("PasswdHash"), authorizationIndex = index("KennwortVergessen");
  if ([idIndex, loginIndex, passwordIndex, authorizationIndex].some((value) => value < 0)) throw profileError("PAJ_REFRESH_PERSON_HEADER_INVALID", "Personen-Credentialspalten fehlen");
  let credentialCount = 0;
  for (const row of rectangular.slice(1)) {
    const login = String(row[loginIndex] ?? "").trim();
    row[authorizationIndex] = "";
    row[passwordIndex] = login ? deriveCredential(clientHash, exportRunId, String(row[idIndex] ?? "").trim()) : "";
    if (login) credentialCount++;
  }
  return { rows: rectangular, credentialCount };
}

function tableExists(database, table) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function sanitizeSqlite(filename, source, { exportRunId, exportStartedAt }) {
  const database = new DatabaseSync(filename);
  const result = { discarded: {}, revokedMonitors: 0, disabledDeliveries: 0 };
  try {
    database.exec("PRAGMA secure_delete=ON");
    database.exec("BEGIN IMMEDIATE");
    if (source === "state.sqlite") {
      for (const table of ["sessions", "login_failures", "operations"]) if (tableExists(database, table)) {
        const count = Number(database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count);
        database.exec(`DELETE FROM ${table}`);
        result.discarded[table] = count;
      }
      if (tableExists(database, "monitor_devices")) {
        const rows = database.prepare("SELECT monitor_id FROM monitor_devices ORDER BY monitor_id").all();
        const update = database.prepare("UPDATE monitor_devices SET token_hash=?, revoked_at=?, updated_at=? WHERE monitor_id=?");
        const timestamp = Date.parse(exportStartedAt);
        for (const row of rows) {
          const token = crypto.createHash("sha256").update(`${PROFILE}\0monitor\0${exportRunId}\0${row.monitor_id}`).digest("hex");
          update.run(token, timestamp, timestamp, row.monitor_id);
        }
        result.revokedMonitors = rows.length;
      }
    }
    if (source === "messaging.sqlite") {
      for (const table of ["event_ack_operations", "message_bulk_ack_operations", "event_interaction_operations"]) if (tableExists(database, table)) {
        const count = Number(database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count);
        database.exec(`DELETE FROM ${table}`);
        result.discarded[table] = count;
      }
      if (tableExists(database, "event_deliveries")) {
        result.disabledDeliveries = Number(database.prepare("SELECT count(*) AS count FROM event_deliveries WHERE status<>'not_configured'").get().count);
        database.exec("UPDATE event_deliveries SET status='not_configured'");
      }
    }
    database.exec("COMMIT");
    database.exec("VACUUM");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { database.close(); }
  fs.chmodSync(filename, 0o600);
  return result;
}

function writeProfileMetadata(root, metadata) {
  const value = {
    profile: PROFILE,
    profileVersion: 1,
    sourceCredentials: "omitted",
    importedCredentials: "shared_scrypt_v1",
    sessions: "discarded",
    loginLimits: "discarded",
    idempotencyState: "discarded",
    monitorCredentials: "rotated_and_revoked",
    courtSources: "disabled",
    externalDeliveries: "not_configured",
    historicalBusinessData: "retained",
    credentialCount: metadata.credentialCount,
    revokedMonitorCount: metadata.revokedMonitorCount,
    disabledDeliveryCount: metadata.disabledDeliveryCount,
  };
  fs.writeFileSync(path.join(root, "metadata", "paj-refresh.json"), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return value;
}

function verifyPajRefreshPackage(root) {
  const verified = verifySourcePackage(root);
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(path.join(root, "metadata", "paj-refresh.json"), "utf8")); } catch { throw profileError("PAJ_REFRESH_METADATA_INVALID", "PAJ-Refresh-Metadaten fehlen"); }
  const metadataKeys = ["courtSources", "credentialCount", "disabledDeliveryCount", "externalDeliveries", "historicalBusinessData", "idempotencyState", "importedCredentials", "loginLimits", "monitorCredentials", "profile", "profileVersion", "revokedMonitorCount", "sessions", "sourceCredentials"];
  if (JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(metadataKeys) || metadata.profile !== PROFILE || metadata.profileVersion !== 1 || metadata.sourceCredentials !== "omitted"
      || metadata.importedCredentials !== "shared_scrypt_v1" || metadata.sessions !== "discarded"
      || metadata.loginLimits !== "discarded" || metadata.idempotencyState !== "discarded"
      || metadata.monitorCredentials !== "rotated_and_revoked" || metadata.courtSources !== "disabled"
      || metadata.externalDeliveries !== "not_configured" || metadata.historicalBusinessData !== "retained") {
    throw profileError("PAJ_REFRESH_METADATA_INVALID", "PAJ-Refresh-Profil weicht ab");
  }
  for (const field of ["credentialCount", "revokedMonitorCount", "disabledDeliveryCount"]) {
    if (!Number.isSafeInteger(metadata[field]) || metadata[field] < 0) throw profileError("PAJ_REFRESH_METADATA_INVALID", "PAJ-Refresh-Zaehler ist ungueltig");
  }
  const people = parseSemicolonCsv(fs.readFileSync(path.join(root, "sheets", "Personen.csv"), "utf8"));
  const header = canonicalizeSheetHeader("Personen", people[0]);
  const loginIndex = header.indexOf("Login"), passwordIndex = header.indexOf("PasswdHash"), authorizationIndex = header.indexOf("KennwortVergessen");
  let credentials = 0;
  for (const row of people.slice(1)) {
    const login = String(row[loginIndex] ?? "").trim(), password = String(row[passwordIndex] ?? "").trim();
    if (String(row[authorizationIndex] ?? "").trim()) throw profileError("PAJ_REFRESH_AUTHORIZATION_PRESENT", "Passwortfreigabe wurde nicht entfernt");
    if (login) {
      if (!/^scrypt\$v1\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(password)) throw profileError("PAJ_REFRESH_CREDENTIAL_INVALID", "Testcredential fehlt");
      credentials++;
    } else if (password) throw profileError("PAJ_REFRESH_CREDENTIAL_WITHOUT_LOGIN", "Credential ohne Login ist unzulaessig");
  }
  if (credentials !== metadata.credentialCount) throw profileError("PAJ_REFRESH_CREDENTIAL_COUNT_MISMATCH", "Credentialanzahl weicht ab");
  const state = new DatabaseSync(path.join(root, "sqlite", "state.sqlite"), { readOnly: true });
  const messaging = new DatabaseSync(path.join(root, "sqlite", "messaging.sqlite"), { readOnly: true });
  try {
    for (const table of ["sessions", "login_failures", "operations"]) if (tableExists(state, table) && Number(state.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) !== 0) throw profileError("PAJ_REFRESH_SECURITY_STATE_PRESENT", "Security-State wurde nicht entfernt");
    if (tableExists(state, "monitor_devices") && Number(state.prepare("SELECT count(*) AS count FROM monitor_devices WHERE revoked_at IS NULL OR token_hash GLOB '*[^0-9a-f]*' OR length(token_hash)<>64").get().count) !== 0) throw profileError("PAJ_REFRESH_MONITOR_CREDENTIAL_INVALID", "Monitorcredential wurde nicht neutralisiert");
    if (tableExists(state, "monitor_devices") && Number(state.prepare("SELECT count(*) AS count FROM monitor_devices").get().count) !== metadata.revokedMonitorCount) throw profileError("PAJ_REFRESH_MONITOR_COUNT_MISMATCH", "Monitoranzahl weicht ab");
    for (const table of ["event_ack_operations", "message_bulk_ack_operations", "event_interaction_operations"]) if (tableExists(messaging, table) && Number(messaging.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) !== 0) throw profileError("PAJ_REFRESH_IDEMPOTENCY_PRESENT", "Messaging-Idempotenzstate wurde nicht entfernt");
    if (tableExists(messaging, "event_deliveries") && Number(messaging.prepare("SELECT count(*) AS count FROM event_deliveries WHERE status<>'not_configured'").get().count) !== 0) throw profileError("PAJ_REFRESH_DELIVERY_ACTIVE", "Externe Zustellung ist noch aktiv");
  } finally { state.close(); messaging.close(); }
  return { ...verified, profile: PROFILE, credentialCount: credentials, revokedMonitorCount: metadata.revokedMonitorCount, disabledDeliveryCount: metadata.disabledDeliveryCount };
}

module.exports = { PROFILE, deriveCredential, sanitizePeopleRows, sanitizeSqlite, verifyPajRefreshPackage, writeProfileMetadata };
