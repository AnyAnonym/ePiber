"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { REQUIRED_PATHS, verifySourcePackage, writeSourceManifest } = require("../db/import/sourcePackage");

function packageDirectory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-source-package-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of REQUIRED_PATHS) {
    const filename = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filename, `synthetic:${relative}\n`, { mode: 0o600 });
  }
  return root;
}

test("Quellpaket bindet alle Pflichtquellen an Groesse und SHA-256", (t) => {
  const root = packageDirectory(t);
  writeSourceManifest(root, {
    exportRunId: "synthetic-1",
    exportStartedAt: "2026-10-10T10:00:00.000Z",
    exportCompletedAt: "2026-10-10T10:01:00.000Z",
  });
  const verified = verifySourcePackage(root);
  assert.equal(verified.manifest.files.length, REQUIRED_PATHS.size);
  assert.match(verified.manifestSha256, /^[0-9a-f]{64}$/);
});

test("Quellpaket lehnt nachtraegliche Aenderung und Symlink ab", (t) => {
  const root = packageDirectory(t);
  writeSourceManifest(root, {
    exportRunId: "synthetic-2",
    exportStartedAt: "2026-10-10T10:00:00.000Z",
    exportCompletedAt: "2026-10-10T10:01:00.000Z",
  });
  fs.appendFileSync(path.join(root, "sheets", "Personen.csv"), "changed\n");
  assert.throws(() => verifySourcePackage(root), (error) => error.code === "SOURCE_PACKAGE_FINGERPRINT_MISMATCH");

  const rootWithLink = packageDirectory(t);
  const target = path.join(rootWithLink, "sqlite", "state.sqlite");
  fs.rmSync(target);
  fs.symlinkSync(path.join(rootWithLink, "sqlite", "audit.sqlite"), target);
  assert.throws(() => writeSourceManifest(rootWithLink, {
    exportRunId: "synthetic-3",
    exportStartedAt: "2026-10-10T10:00:00.000Z",
    exportCompletedAt: "2026-10-10T10:01:00.000Z",
  }), (error) => error.code === "SOURCE_PACKAGE_FILE_INVALID");
});
