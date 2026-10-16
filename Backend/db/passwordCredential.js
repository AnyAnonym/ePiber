"use strict";

const crypto = require("node:crypto");

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, length: 32 });

function credentialError(code, message) { return Object.assign(new Error(message), { code }); }

function deriveScryptCredential(clientHash, namespace, accountKey) {
  const value = String(clientHash || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) throw credentialError("PAJ_PASSWORD_HASH_INVALID", "Testpasswort-Hash ist ungueltig");
  const context = String(namespace || ""), key = String(accountKey || "");
  if (!context || !key) throw credentialError("PAJ_PASSWORD_CONTEXT_INVALID", "Credentialkontext ist ungueltig");
  const salt = crypto.createHash("sha256").update(`${context}\0${key}`).digest().subarray(0, 16);
  const derived = crypto.scryptSync(value, salt, SCRYPT.length, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$v1$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

module.exports = { SCRYPT, deriveScryptCredential };
