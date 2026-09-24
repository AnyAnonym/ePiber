import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  changedPaths,
  readReceipt,
  receiptPath,
  requiredSuites,
  runSuite,
  suiteFingerprint,
  verificationStatus,
  worktreeFingerprint,
} from "./verification-state.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-verification-"));
  run("git", ["init", "-b", "main"], root);
  run("git", ["config", "user.name", "Verification Test"], root);
  run("git", ["config", "user.email", "verification@example.invalid"], root);
  fs.mkdirSync(path.join(root, "Backend"));
  fs.mkdirSync(path.join(root, "Frontend"));
  fs.mkdirSync(path.join(root, "Project/ChangeLogs"), { recursive: true });
  fs.writeFileSync(path.join(root, "Backend/package.json"), `${JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "Backend/package-lock.json"), `${JSON.stringify({ name: "fixture", version: "1.0.0", packages: { "": { name: "fixture", version: "1.0.0" } } }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "Frontend/styles.css"), "body { color: black; }\n");
  fs.writeFileSync(path.join(root, "Project/ChangeLogs/ChangeLog-1.0.0-paj-1.txt"), "Kurzkommentar: offen\n");
  fs.writeFileSync(path.join(root, "README.md"), "initial\n");
  run("git", ["add", "."], root);
  run("git", ["commit", "-m", "initial"], root);
  return root;
}

test("verification receipt is bound to HEAD and its suite inputs", () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, "notes.txt"), "checked\n");
    assert.deepEqual(requiredSuites(changedPaths(root)), ["docs"]);
    runSuite(root, "docs");
    assert.deepEqual(verificationStatus(root).missing, []);
    const receipt = readReceipt(root);
    assert.equal(receipt.suites.docs.command, "git diff --check");
    assert.equal(typeof receipt.suites.docs.durationMs, "number");
    assert.match(receipt.suites.docs.fingerprint, /^[0-9a-f]{64}$/);
    const fingerprint = worktreeFingerprint(root);

    fs.writeFileSync(path.join(root, "Project/ChangeLogs/ChangeLog-1.0.0-paj-1.txt"), "Kurzkommentar: Dokumentation geprueft\n");
    assert.deepEqual(verificationStatus(root).missing, []);

    fs.appendFileSync(path.join(root, "notes.txt"), "changed\n");
    const stale = verificationStatus(root);
    assert.notEqual(stale.fingerprint, fingerprint);
    assert.deepEqual(stale.missing, ["docs"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verification policy distinguishes backend, browser lifecycle and full UI changes", () => {
  assert.deepEqual(requiredSuites(["Backend/server.js"]), ["build"]);
  assert.deepEqual(requiredSuites(["Frontend/JS/dataClient.js"]), ["build", "browser-lifecycle"]);
  assert.deepEqual(requiredSuites(["Frontend/JS/profile.js"]), ["build", "browser-core"]);
  assert.deepEqual(requiredSuites(["Frontend/styles.css"]), ["build", "browser-full"]);
  assert.deepEqual(requiredSuites(["Backend/package.json", "Project/ChangeLogs/ChangeLog-1.2.3-paj-1.txt"]), []);
});

test("verification receipt remains outside the Git worktree", () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, "notes.txt"), "checked\n");
    const before = changedPaths(root);
    runSuite(root, "docs");
    assert.deepEqual(changedPaths(root), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow metadata does not invalidate build and browser receipts", () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, "Frontend/styles.css"), "body { color: green; }\n");
    const build = suiteFingerprint(root, "build");
    const browser = suiteFingerprint(root, "browser-full");

    const changelog = path.join(root, "Project/ChangeLogs/ChangeLog-1.0.0-paj-1.txt");
    fs.writeFileSync(changelog, "Kurzkommentar: Druckvorschau ergaenzt\n");
    assert.equal(suiteFingerprint(root, "build"), build);
    assert.equal(suiteFingerprint(root, "browser-full"), browser);

    for (const file of ["Backend/package.json", "Backend/package-lock.json"]) {
      const value = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
      value.version = "1.0.0-paj-1-1-x";
      if (value.packages?.[""]) value.packages[""].version = value.version;
      fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
    }
    assert.equal(suiteFingerprint(root, "build"), build);
    assert.equal(suiteFingerprint(root, "browser-full"), browser);

    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "Backend/package.json"), "utf8"));
    packageJson.scripts.check = "node check.js";
    fs.writeFileSync(path.join(root, "Backend/package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
    assert.notEqual(suiteFingerprint(root, "build"), build);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("browser fingerprint changes only for browser-relevant inputs", () => {
  const root = fixture();
  try {
    const initial = suiteFingerprint(root, "browser-full");
    fs.writeFileSync(path.join(root, "README.md"), "documentation only\n");
    assert.equal(suiteFingerprint(root, "browser-full"), initial);
    fs.writeFileSync(path.join(root, "Frontend/styles.css"), "body { color: red; }\n");
    assert.notEqual(suiteFingerprint(root, "browser-full"), initial);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("successful build and browser receipts survive a later commit-subject change", () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, "Frontend/styles.css"), "body { color: blue; }\n");
    const receipt = {
      version: 2,
      headSha: run("git", ["rev-parse", "HEAD"], root),
      branch: "main",
      node: process.version,
      suites: {
        build: { success: true, fingerprint: suiteFingerprint(root, "build") },
        "browser-full": { success: true, fingerprint: suiteFingerprint(root, "browser-full") },
      },
    };
    const target = receiptPath(root);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`);
    assert.deepEqual(verificationStatus(root).missing, []);

    fs.writeFileSync(
      path.join(root, "Project/ChangeLogs/ChangeLog-1.0.0-paj-1.txt"),
      "Kurzkommentar: Markierte Druckvorschau ergaenzt\n",
    );
    assert.deepEqual(verificationStatus(root).missing, []);

    fs.writeFileSync(path.join(root, "Frontend/styles.css"), "body { color: purple; }\n");
    assert.deepEqual(verificationStatus(root).missing, ["build", "browser-full"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
