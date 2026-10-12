"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { writeKnownFindingApproval } = require("../db/import/knownFindingApproval");
const { createImportTestPackage } = require("./importTestPackage");

test("geschlossene Stagingpolicy schreibt ohne Warnung kein Ausnahmemanifest", (t) => {
  const root = createImportTestPackage(t);
  assert.deepEqual(writeKnownFindingApproval(root), { written: false, warningCount: 0 });
  assert.equal(fs.existsSync(path.join(root, "exception-manifest.json")), false);
});

test("geschlossene Stagingpolicy lehnt jeden unbekannten Warncode ab", (t) => {
  const root = createImportTestPackage(t, { invalidEmail: true });
  assert.throws(() => writeKnownFindingApproval(root), { code: "IMPORT_WARNING_DECISION_REQUIRED", warningCodes: ["PERSON_EMAIL_DISCARDED"] });
  assert.equal(fs.existsSync(path.join(root, "exception-manifest.json")), false);
});
