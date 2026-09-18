const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRuntimeVersion } = require("../scripts/check-runtime-version.js");

test("Laufzeitversionspruefung akzeptiert nur die exakte Paketversion", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: url.toString(), options });
    return { ok: true, json: async () => ({ version: "1.2.3" }) };
  };
  assert.equal(await checkRuntimeVersion("https://example.test/version", { expectedVersion: "1.2.3", fetchImpl }), "1.2.3");
  assert.equal(calls[0].options.cache, "no-store");
  await assert.rejects(
    checkRuntimeVersion("https://example.test/version", { expectedVersion: "1.2.4", fetchImpl }),
    /stimmt nicht mit Paketversion 1\.2\.4 ueberein/,
  );
});

test("Laufzeitversionspruefung lehnt Fehlerantworten und fremde Protokolle ab", async () => {
  await assert.rejects(
    checkRuntimeVersion("https://example.test/version", { fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /HTTP 503/,
  );
  await assert.rejects(checkRuntimeVersion("file:///version"), /HTTP oder HTTPS/);
});
