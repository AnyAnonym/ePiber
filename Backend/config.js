const fs = require("fs");
const path = require("path");

function parseInteger(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} muss eine Ganzzahl zwischen ${min} und ${max} sein`);
  }
  return value;
}

function parseBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (["1", "true", "yes"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no"].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} muss true oder false sein`);
}

function parseOrigin(value, name) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} muss eine gueltige Origin sein`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} muss nur Schema, Host und optional Port enthalten`);
  }
  return url.origin;
}

const INSTANCE_ID = String(process.env.INSTANCE_ID || "development").trim();
if (!/^[a-z0-9_-]{1,32}$/i.test(INSTANCE_ID)) {
  throw new Error("INSTANCE_ID enthaelt ungueltige Zeichen");
}

const PERSISTENCE_MODE = String(process.env.PERSISTENCE_MODE || "postgres").trim().toLowerCase();
if (PERSISTENCE_MODE !== "postgres") throw new Error("Nur PERSISTENCE_MODE=postgres wird unterstuetzt; der Google-/Sheets-Betrieb wurde entfernt");
const WRITE_MODE = String(process.env.EPIBER_WRITE_MODE || "read_write").trim().toLowerCase();
if (!new Set(["read_only", "read_write"]).has(WRITE_MODE)) throw new Error("EPIBER_WRITE_MODE muss read_only oder read_write sein");
function runtimeSecret(name, filenameName) {
  const direct = String(process.env[name] || "").trim(), filename = String(process.env[filenameName] || "").trim();
  if (direct && filename) throw new Error(`${name} und ${filenameName} duerfen nicht gemeinsam gesetzt sein`);
  if (!filename) return direct;
  const stat = fs.statSync(filename);
  if (!stat.isFile() || (stat.mode & 0o037) !== 0) throw new Error(`${filenameName} ist unsicher`);
  return fs.readFileSync(filename, "utf8").trim();
}
const AUTH_RATE_LIMIT_SECRET = runtimeSecret("EPIBER_AUTH_RATE_LIMIT_SECRET", "EPIBER_AUTH_RATE_LIMIT_SECRET_FILE");

const LOG_LEVEL = String(process.env.LOG_LEVEL || "info").trim().toLowerCase();
if (!["debug", "info", "warn", "error"].includes(LOG_LEVEL)) {
  throw new Error("LOG_LEVEL muss debug, info, warn oder error sein");
}

const PORT = parseInteger("PORT", 8080, 1, 65535);
const LISTEN_HOST = process.env.LISTEN_HOST || "127.0.0.1";
const PUBLIC_ORIGIN = parseOrigin(process.env.PUBLIC_ORIGIN || `http://localhost:${PORT}`, "PUBLIC_ORIGIN");
const ALLOW_INSECURE_TRANSPORT = parseBoolean("ALLOW_INSECURE_TRANSPORT", process.env.NODE_ENV !== "production");
if (PUBLIC_ORIGIN.startsWith("http:") && !ALLOW_INSECURE_TRANSPORT) {
  throw new Error("PUBLIC_ORIGIN muss HTTPS verwenden oder ALLOW_INSECURE_TRANSPORT=true setzen");
}

const additionalOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value, index) => parseOrigin(value, `ALLOWED_ORIGINS[${index}]`));
const ALLOWED_ORIGINS = new Set([PUBLIC_ORIGIN, ...additionalOrigins]);
if (!ALLOW_INSECURE_TRANSPORT && [...ALLOWED_ORIGINS].some((origin) => origin.startsWith("http:"))) {
  throw new Error("ALLOWED_ORIGINS duerfen ohne ALLOW_INSECURE_TRANSPORT nur HTTPS verwenden");
}

const COURT_URL = process.env.COURT_URL;
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, ".state", `${INSTANCE_ID}.sqlite`);
const SCORELOG_FILE = process.env.SCORELOG_FILE || path.join(__dirname, ".state", `${INSTANCE_ID}-scorelog.sqlite`);
const AUDITLOG_FILE = process.env.AUDITLOG_FILE || path.join(__dirname, ".state", `${INSTANCE_ID}-audit.sqlite`);
const MESSAGING_FILE = process.env.MESSAGING_FILE
  || (STATE_FILE === ":memory:" ? ":memory:" : path.join(path.dirname(STATE_FILE), "messaging.sqlite"));
const SCORE_LOG_JOURNAL = parseBoolean("SCORE_LOG_JOURNAL", true);
const AUDIT_LOG_JOURNAL = parseBoolean("AUDIT_LOG_JOURNAL", true);
const AUDIT_ACTIONS = new Set(String(process.env.AUDIT_ACTIONS || "*").split(",").map((value) => value.trim()).filter(Boolean));
const MESSAGING_REPORT_ENABLED = parseBoolean("MESSAGING_REPORT_ENABLED", false);
const MESSAGING_REPORT_DEPLOYMENT = String(process.env.MESSAGING_REPORT_DEPLOYMENT || "").trim().toLowerCase();
const MESSAGING_REPORT_TOKEN = String(process.env.EPIBER_OBSERVABILITY_API_TOKEN || "").trim();

const PROTOCOL_VERSION = 2;
const SESSION_TTL_MS = parseInteger("SESSION_TTL_SECONDS", 2592000, 300, 7776000) * 1000;
const SESSION_REFRESH_INTERVAL_MS = Math.min(86400000, Math.floor(SESSION_TTL_MS / 2));
const SESSION_MAX_PER_USER = parseInteger("SESSION_MAX_PER_USER", 10, 2, 50);
const SESSION_COOKIE = `epiber_${INSTANCE_ID}_session`;
const MONITOR_COOKIE = `epiber_${INSTANCE_ID}_monitor`;
const COOKIE_SECURE = PUBLIC_ORIGIN.startsWith("https:");

const HTTP_BODY_LIMIT_BYTES = parseInteger("HTTP_BODY_LIMIT_BYTES", 8192, 512, 65536);
const HTTP_REQUEST_TIMEOUT_MS = parseInteger("HTTP_REQUEST_TIMEOUT_MS", 30000, 5000, 120000);
const HTTP_HEADERS_TIMEOUT_MS = parseInteger("HTTP_HEADERS_TIMEOUT_MS", 10000, 2000, 60000);
const HTTP_KEEP_ALIVE_TIMEOUT_MS = parseInteger("HTTP_KEEP_ALIVE_TIMEOUT_MS", 5000, 1000, 30000);
const WS_MAX_PAYLOAD_BYTES = parseInteger("WS_MAX_PAYLOAD_BYTES", 16384, 1024, 1048576);
const WS_MAX_INFLIGHT = parseInteger("WS_MAX_INFLIGHT", 8, 1, 64);
const WS_MAX_SUBSCRIPTIONS = parseInteger("WS_MAX_SUBSCRIPTIONS", 32, 1, 100);
const WS_REQUEST_RATE = parseInteger("WS_REQUEST_RATE", 20, 1, 200);
const WS_REQUEST_BURST = parseInteger("WS_REQUEST_BURST", 40, 1, 400);
const WS_MAX_CONNECTIONS = parseInteger("WS_MAX_CONNECTIONS", 200, 1, 5000);
const WS_MAX_CONNECTIONS_PER_IP = parseInteger("WS_MAX_CONNECTIONS_PER_IP", 20, 1, 500);
const WS_MAX_BUFFERED_BYTES = parseInteger("WS_MAX_BUFFERED_BYTES", 1048576, 65536, 16777216);
const WS_HANDSHAKE_TIMEOUT_MS = parseInteger("WS_HANDSHAKE_TIMEOUT_MS", 10000, 1000, 30000);
const WS_PING_INTERVAL_MS = parseInteger("WS_PING_INTERVAL_MS", 25000, 5000, 120000);
const WS_DEAD_CLIENT_MS = parseInteger("WS_DEAD_CLIENT_MS", 75000, 15000, 300000);

const COURT_POLL_INTERVAL = parseInteger("COURT_POLL_INTERVAL_MS", 2000, 500, 60000);
const COURT_FETCH_TIMEOUT_MS = parseInteger("COURT_FETCH_TIMEOUT_MS", 5000, 500, 60000);
const COURT_MAX_RESPONSE_BYTES = parseInteger("COURT_MAX_RESPONSE_BYTES", 262144, 1024, 2097152);
const COURT_MAX_BACKOFF_MS = parseInteger("COURT_MAX_BACKOFF_MS", 30000, 2000, 300000);

const SHUTDOWN_GRACE_MS = parseInteger("SHUTDOWN_GRACE_MS", 90000, 1000, 120000);

const TABLE_NAMES = Object.freeze([
  "players", "bewerbe", "bewerbsart", "matchtyp", "matches1", "rlPlatzierung", "navigator", "entryList",
]);

function validateRuntimeConfig() {
  const errors = [];
  if (!["127.0.0.1", "::1", "localhost"].includes(LISTEN_HOST)) {
    errors.push("LISTEN_HOST muss auf Loopback zeigen");
  }
  if (!process.env.PGUSER) errors.push("PGUSER fehlt");
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(String(process.env.EPIBER_TENANT_CODE || ""))) errors.push("EPIBER_TENANT_CODE fehlt oder ist ungueltig");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(AUTH_RATE_LIMIT_SECRET)) errors.push("EPIBER_AUTH_RATE_LIMIT_SECRET muss ein Base64url-Token mit mindestens 43 Zeichen sein");
  if (!COURT_URL) errors.push("COURT_URL fehlt");
  else {
    try { if (new URL(COURT_URL).protocol !== "https:") errors.push("COURT_URL muss HTTPS verwenden"); }
    catch { errors.push("COURT_URL ist ungueltig"); }
  }
  if (MESSAGING_REPORT_ENABLED) {
    if (!["live", "devel", "paj"].includes(MESSAGING_REPORT_DEPLOYMENT)) errors.push("MESSAGING_REPORT_DEPLOYMENT muss live, devel oder paj sein");
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(MESSAGING_REPORT_TOKEN)) errors.push("EPIBER_OBSERVABILITY_API_TOKEN muss ein Base64url-Token mit mindestens 43 Zeichen sein");
  }
  if (WS_DEAD_CLIENT_MS < WS_PING_INTERVAL_MS + 5000) {
    errors.push("WS_DEAD_CLIENT_MS muss mindestens 5000 ms ueber WS_PING_INTERVAL_MS liegen");
  }
  if (errors.length) throw new Error(errors.join("; "));
}

module.exports = {
  ALLOWED_ORIGINS,
  ALLOW_INSECURE_TRANSPORT,
  AUDIT_ACTIONS,
  AUTH_RATE_LIMIT_SECRET,
  AUDITLOG_FILE,
  AUDIT_LOG_JOURNAL,
  COOKIE_SECURE,
  COURT_FETCH_TIMEOUT_MS,
  COURT_MAX_BACKOFF_MS,
  COURT_MAX_RESPONSE_BYTES,
  COURT_POLL_INTERVAL,
  COURT_URL,
  HTTP_BODY_LIMIT_BYTES,
  HTTP_HEADERS_TIMEOUT_MS,
  HTTP_KEEP_ALIVE_TIMEOUT_MS,
  HTTP_REQUEST_TIMEOUT_MS,
  INSTANCE_ID,
  LISTEN_HOST,
  LOG_LEVEL,
  MESSAGING_FILE,
  MESSAGING_REPORT_DEPLOYMENT,
  MESSAGING_REPORT_ENABLED,
  MESSAGING_REPORT_TOKEN,
  MONITOR_COOKIE,
  PORT,
  PERSISTENCE_MODE,
  PROTOCOL_VERSION,
  PUBLIC_ORIGIN,
  SESSION_COOKIE,
  SESSION_MAX_PER_USER,
  SESSION_REFRESH_INTERVAL_MS,
  SESSION_TTL_MS,
  SCORELOG_FILE,
  SCORE_LOG_JOURNAL,
  SHUTDOWN_GRACE_MS,
  STATE_FILE,
  TABLE_NAMES,
  WS_DEAD_CLIENT_MS,
  WS_HANDSHAKE_TIMEOUT_MS,
  WS_MAX_BUFFERED_BYTES,
  WS_MAX_CONNECTIONS,
  WS_MAX_CONNECTIONS_PER_IP,
  WS_MAX_INFLIGHT,
  WS_MAX_PAYLOAD_BYTES,
  WS_MAX_SUBSCRIPTIONS,
  WS_PING_INTERVAL_MS,
  WS_REQUEST_BURST,
  WS_REQUEST_RATE,
  WRITE_MODE,
  validateRuntimeConfig,
};
