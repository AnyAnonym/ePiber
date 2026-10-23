"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const removedPackages = ["googleapis", "googleapis-common", "google-auth-library", "google-logging-utils", "gaxios", "gcp-metadata", "gtoken", "qs", "node-fetch", "web-streams-polyfill"];

test("Google-Paketbaum ist weder deklariert noch gelockt oder installiert", () => {
  const manifest = require("../package.json");
  const lock = require("../package-lock.json");
  assert.equal(manifest.scripts["db:export"], undefined);
  for (const name of removedPackages) {
    assert.equal(manifest.dependencies[name], undefined, name);
    assert.equal(Object.keys(lock.packages).some((location) => location.endsWith(`node_modules/${name}`)), false, name);
    assert.equal(fs.existsSync(path.join(root, "node_modules", name)), false, name);
  }
});

test("Servermodul laedt ohne Google oder Legacy-Serverkomposition und startet nichts implizit", () => {
  const result = spawnSync(process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    const Module = require("node:module");
    const load = Module._load;
    Module._load = function(request, ...args) {
      if (${JSON.stringify(removedPackages)}.some(name => request === name || request.startsWith(name + "/"))) throw new Error("removed package loaded");
      return load.call(this, request, ...args);
    };
    const { createApplication } = require("./server.js");
    assert.throws(() => createApplication(), { code: "APPLICATION_COMPONENT_MISSING" });
    assert.equal(require("./config.js").PERSISTENCE_MODE, "postgres");
  `], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, NODE_ENV: "test", PERSISTENCE_MODE: "", EPIBER_AUTH_RATE_LIMIT_SECRET: "", EPIBER_AUTH_RATE_LIMIT_SECRET_FILE: "" },
  });
  assert.equal(result.status, 0, result.stderr);
});
