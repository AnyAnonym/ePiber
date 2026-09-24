import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  changedPaths,
  readReceipt,
  requiredSuites,
  runSuite,
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
  fs.writeFileSync(path.join(root, "Backend/package-lock.json"), "{}\n");
  fs.writeFileSync(path.join(root, "README.md"), "initial\n");
  run("git", ["add", "."], root);
  run("git", ["commit", "-m", "initial"], root);
  return root;
}

test("verification receipt is bound to HEAD and the complete worktree fingerprint", () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, "notes.txt"), "checked\n");
    assert.deepEqual(requiredSuites(changedPaths(root)), ["docs"]);
    runSuite(root, "docs");
    assert.deepEqual(verificationStatus(root).missing, []);
    const receipt = readReceipt(root);
    assert.equal(receipt.suites.docs.command, "git diff --check");
    assert.equal(typeof receipt.suites.docs.durationMs, "number");
    assert.match(receipt.packageLockHash, /^[0-9a-f]{64}$/);
    const fingerprint = worktreeFingerprint(root);

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
