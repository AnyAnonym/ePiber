"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");

function pushConfig(env = process.env) {
  if (env.PUSH_PILOT_ENABLED !== "true") return Object.freeze({ enabled: false });
  try {
    const publicKey = String(env.PUSH_VAPID_PUBLIC_KEY || "");
    const privateKey = fs.readFileSync(env.PUSH_VAPID_PRIVATE_KEY_FILE, "utf8").trim();
    const subject = String(env.PUSH_VAPID_SUBJECT || "");
    if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)
      || !/^(https:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+)$/.test(subject)) throw new Error();
    const key = crypto.createECDH("prime256v1");
    key.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (key.getPublicKey().toString("base64url") !== publicKey) throw new Error();
    return Object.freeze({ enabled: true, publicKey, privateKey, subject });
  } catch {
    throw Object.assign(new Error("Push-Konfiguration ist unvollstaendig oder ungueltig"), { code: "PUSH_CONFIG_INVALID" });
  }
}

module.exports = { pushConfig };
