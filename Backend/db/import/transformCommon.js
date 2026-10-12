"use strict";

const crypto = require("node:crypto");
const { domainToASCII } = require("node:url");
const { Temporal } = require("@js-temporal/polyfill");

const RULE_VERSION = 1;
const TENANT_ID = "0199c800-0000-7000-8000-000000000001";
const SECTION_ID = "0199c800-0000-7000-8000-000000000002";

class ImportTransformError extends Error {
  constructor(code, source, projection) {
    super(code);
    this.name = "ImportTransformError";
    this.code = code;
    this.source = source;
    this.projection = projection;
  }
}

function fail(code, source, projection) {
  throw new ImportTransformError(code, source, projection);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest("hex");
}

function stableUuid(scope, key) {
  const bytes = crypto.createHash("sha256").update(`epiber-import-v1\0${scope}\0${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function text(value, { min = 1, max = 500, required = false, code = "SOURCE_VALUE_INVALID", source = "source", projection = "value" } = {}) {
  const result = String(value ?? "").trim();
  if ((required && result.length < min) || result.length > max) fail(code, source, projection);
  return result || null;
}

function contractId(value, source, { numeric = false, optional = false } = {}) {
  const result = text(value, { max: 64, required: !optional, code: "SOURCE_ID_INVALID", source, projection: "id" });
  if (result === null) return null;
  const pattern = numeric ? /^[1-9][0-9]*$/ : /^[A-Za-z0-9_.:-]{1,64}$/;
  if (!pattern.test(result)) fail("SOURCE_ID_INVALID", source, "id");
  return result;
}

function integer(value, source, projection, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw && optional) return null;
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(raw)) fail("SOURCE_INTEGER_INVALID", source, projection);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail("SOURCE_INTEGER_INVALID", source, projection);
  return parsed;
}

function legacyBoolean(value, source, projection, { trueValues = ["1"], falseValues = ["", "0"] } = {}) {
  const raw = String(value ?? "").trim();
  if (trueValues.includes(raw)) return true;
  if (falseValues.includes(raw)) return false;
  fail("SOURCE_BOOLEAN_INVALID", source, projection);
}

function dateOnly(value, source, projection, { optional = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw && optional) return null;
  const match = raw.match(/^(?:(\d{2})\.(\d{2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2})|(\d{4})(\d{2})(\d{2}))$/);
  if (!match) fail("SOURCE_DATE_INVALID", source, projection);
  try {
    return Temporal.PlainDate.from(match[1]
      ? { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) }
      : match[4]
        ? { year: Number(match[4]), month: Number(match[5]), day: Number(match[6]) }
        : { year: Number(match[7]), month: Number(match[8]), day: Number(match[9]) }).toString();
  } catch { fail("SOURCE_DATE_INVALID", source, projection); }
}

function instant(value, source, projection, { optional = true, unixMs = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw && optional) return null;
  try {
    if (unixMs) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) throw new Error();
      const milliseconds = Number(raw);
      if (!Number.isSafeInteger(milliseconds)) throw new Error();
      return Temporal.Instant.fromEpochMilliseconds(milliseconds).toString({ smallestUnit: "millisecond" });
    }
    if (/^(?:\d{6}|\d{8})-\d{4}$/.test(raw)) {
      const longYear = raw.indexOf("-") === 8;
      const year = longYear ? Number(raw.slice(0, 4)) : 2000 + Number(raw.slice(0, 2));
      const offset = longYear ? 2 : 0;
      const plain = Temporal.PlainDateTime.from({ year, month: Number(raw.slice(2 + offset, 4 + offset)), day: Number(raw.slice(4 + offset, 6 + offset)), hour: Number(raw.slice(7 + offset, 9 + offset)), minute: Number(raw.slice(9 + offset, 11 + offset)) });
      return plain.toZonedDateTime("Europe/Vienna", { disambiguation: "reject" }).toInstant().toString({ smallestUnit: "millisecond" });
    }
    return Temporal.Instant.from(raw).toString({ smallestUnit: "millisecond" });
  } catch { fail("SOURCE_TIME_INVALID", source, projection); }
}

function dateOrInstant(value, source, projection) {
  const raw = String(value ?? "").trim();
  if (!raw) return { date: null, instant: null };
  if (/^(?:\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}|\d{8})$/.test(raw)) return { date: dateOnly(raw, source, projection), instant: null };
  return { date: null, instant: instant(raw, source, projection, { optional: false }) };
}

function email(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^([^\s@]{1,64})@([^\s@]{1,253})$/);
  if (!match) return null;
  const domain = domainToASCII(match[2].toLowerCase());
  if (!domain || !domain.includes(".") || domain.split(".").some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) return null;
  return `${match[1].toLowerCase()}@${domain}`;
}

function login(value, source) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const result = raw.toLowerCase();
  if (raw !== result || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~@-]{3,254}$/.test(result)) fail("PERSON_LOGIN_INVALID", source, "Login");
  return result;
}

function jsonObject(value, source, projection, { nullable = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw && nullable) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { fail("SOURCE_JSON_INVALID", source, projection); }
}

function hex32(value, source, projection) {
  const raw = String(value ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) fail("SOURCE_HASH_INVALID", source, projection);
  return raw.toLowerCase();
}

module.exports = {
  ImportTransformError, RULE_VERSION, SECTION_ID, TENANT_ID, canonicalJson, contractId,
  dateOnly, dateOrInstant, email, fail, hex32, instant, integer, jsonObject, legacyBoolean,
  login, sha256, stableUuid, text,
};
