import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const RECEIPT_VERSION = 1;
const SECRET_PATH_RE = /(^|\/)(\.env(?:\.[^/]*)?|[^/]*service[-_.]?account[^/]*\.json|[^/]*private[^/]*key[^/]*|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]*\.(?:pem|key|p12|pfx))$/i;
const WORKFLOW_METADATA = new Set(["Backend/package.json", "Backend/package-lock.json"]);
const SUITE_ORDER = ["docs", "build", "browser-core", "browser-lifecycle", "browser-full"];

function run(command, args, { cwd, allowFailure = false, stdio = "pipe" } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio,
    env: process.env,
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = typeof result.stderr === "string" && result.stderr.trim()
      ? result.stderr.trim()
      : typeof result.stdout === "string" && result.stdout.trim()
        ? result.stdout.trim()
        : `${command} fehlgeschlagen`;
    throw new Error(detail);
  }
  return result;
}

function git(root, args, settings = {}) {
  return run("git", args, { cwd: root, ...settings });
}

function parseStatusPaths(output) {
  const records = output.split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    paths.push(record.slice(3));
    if (record[0] === "R" || record[0] === "C" || record[1] === "R" || record[1] === "C") {
      index += 1;
      if (records[index]) paths.push(records[index]);
    }
  }
  return [...new Set(paths)].sort();
}

export function changedPaths(root) {
  return parseStatusPaths(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout);
}

function packageHasSubstantiveChanges(root, file) {
  if (!root || !WORKFLOW_METADATA.has(file)) return false;
  const currentFile = path.join(root, file);
  if (!fs.existsSync(currentFile)) return true;
  const previous = git(root, ["show", `HEAD:${file}`], { allowFailure: true });
  if (previous.status !== 0) return true;
  try {
    const normalize = (content) => {
      const value = JSON.parse(content);
      value.version = "<workflow-version>";
      if (file.endsWith("package-lock.json") && value.packages?.[""]) {
        value.packages[""].version = "<workflow-version>";
      }
      return JSON.stringify(value);
    };
    return normalize(previous.stdout) !== normalize(fs.readFileSync(currentFile, "utf8"));
  } catch {
    return true;
  }
}

function isWorkflowMetadata(file, root) {
  if (WORKFLOW_METADATA.has(file)) return !packageHasSubstantiveChanges(root, file);
  return /^Project\/ChangeLogs\/ChangeLog-[^/]+\.txt$/.test(file);
}

function isDocumentation(file) {
  return file === "AGENTS.md" || /\.(?:md|txt)$/i.test(file);
}

export function requiredSuites(paths, root) {
  const substantive = paths.filter((file) => !isWorkflowMetadata(file, root));
  if (!substantive.length) return [];

  const suites = new Set();
  const codePaths = substantive.filter((file) => !isDocumentation(file));
  if (codePaths.length) suites.add("build");
  else suites.add("docs");

  const lifecycle = substantive.some((file) => [
    "Frontend/JS/dataClient.js",
    "Frontend/JS/scoreboardPolling.js",
    "Backend/test/dataClient.test.js",
    "Backend/test/scoreboardRecentMatches.browser.js",
  ].includes(file));
  const fullBrowser = substantive.some((file) =>
    file.startsWith("Frontend/") && (/\.(?:html|css)$/i.test(file) || /(?:navbar|navigation|drawer|responsive)/i.test(file)),
  );
  const coreBrowser = substantive.some((file) =>
    file.startsWith("Frontend/") || /^Backend\/test\/.*\.browser\.js$/.test(file),
  );

  if (fullBrowser) suites.add("browser-full");
  else if (lifecycle) suites.add("browser-lifecycle");
  else if (coreBrowser) suites.add("browser-core");
  return SUITE_ORDER.filter((suite) => suites.has(suite));
}

export function worktreeFingerprint(root) {
  const hash = crypto.createHash("sha256");
  const head = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout;
  const paths = parseStatusPaths(status);
  hash.update(`head\0${head}\0status\0${status}\0`);

  for (const file of paths) {
    if (SECRET_PATH_RE.test(file) && path.basename(file) !== ".env.example") {
      throw new Error(`Prueffingerprint verweigert potenzielles Geheimnis: ${file}`);
    }
    const absolute = path.join(root, file);
    hash.update(`path\0${file}\0`);
    if (!fs.existsSync(absolute)) {
      hash.update("deleted\0");
      continue;
    }
    const stat = fs.lstatSync(absolute);
    hash.update(`mode\0${stat.mode}\0`);
    if (stat.isSymbolicLink()) hash.update(`symlink\0${fs.readlinkSync(absolute)}\0`);
    else if (stat.isFile()) hash.update(fs.readFileSync(absolute));
    else hash.update("non-file\0");
  }

  const lockFile = path.join(root, "Backend/package-lock.json");
  if (fs.existsSync(lockFile)) hash.update(fs.readFileSync(lockFile));
  return hash.digest("hex");
}

export function receiptPath(root) {
  const gitPath = git(root, ["rev-parse", "--git-path", "epiber-verification/receipt.json"]).stdout.trim();
  return path.resolve(root, gitPath);
}

export function readReceipt(root) {
  const file = receiptPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    return receipt.version === RECEIPT_VERSION ? receipt : null;
  } catch {
    return null;
  }
}

function suiteSatisfied(required, completed) {
  if (completed.has(required)) return true;
  if (required === "docs" && completed.has("build")) return true;
  if (["browser-core", "browser-lifecycle"].includes(required) && completed.has("browser-full")) return true;
  return false;
}

function fileHash(file) {
  return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
}

function currentBranch(root) {
  return git(root, ["branch", "--show-current"]).stdout.trim() || null;
}

export function verificationStatus(root, paths = changedPaths(root)) {
  const fingerprint = worktreeFingerprint(root);
  const required = requiredSuites(paths, root);
  const receipt = readReceipt(root);
  const receiptMatches = Boolean(
    receipt
    && receipt.fingerprint === fingerprint
    && receipt.headSha === git(root, ["rev-parse", "HEAD"]).stdout.trim()
    && receipt.branch === currentBranch(root)
    && receipt.node === process.version
    && receipt.packageLockHash === fileHash(path.join(root, "Backend/package-lock.json")),
  );
  const completed = new Set(receiptMatches
    ? Object.entries(receipt.suites || {}).filter(([, value]) => value?.success === true).map(([suite]) => suite)
    : []);
  const missing = required.filter((suite) => !suiteSatisfied(suite, completed));
  return { fingerprint, required, completed: [...completed].sort(), missing, receiptMatches };
}

export function assertVerification(root, paths = changedPaths(root)) {
  const status = verificationStatus(root, paths);
  if (status.missing.length) {
    throw new Error(
      `Pruefnachweis fehlt oder passt nicht zum aktuellen Arbeitsstand. Fehlende Profile: ${status.missing.join(", ")}. `
      + "Ausfuehren: node scripts/verification-workflow.mjs verify --suite auto",
    );
  }
  return status;
}

function writeReceipt(root, fingerprint, suite, command, durationMs, success) {
  const headSha = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  const current = readReceipt(root);
  const branch = currentBranch(root);
  const packageLockHash = fileHash(path.join(root, "Backend/package-lock.json"));
  const suites = current?.fingerprint === fingerprint
    && current?.headSha === headSha
    && current?.branch === branch
    && current?.node === process.version
    && current?.packageLockHash === packageLockHash
    ? { ...current.suites }
    : {};
  suites[suite] = { success, command, durationMs, finishedAt: new Date().toISOString() };
  const receipt = {
    version: RECEIPT_VERSION,
    headSha,
    branch,
    fingerprint,
    node: process.version,
    packageLockHash,
    suites,
  };
  const file = receiptPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function runSuite(root, suite) {
  if (!SUITE_ORDER.includes(suite)) throw new Error(`Unbekanntes Pruefprofil: ${suite}`);
  const before = worktreeFingerprint(root);
  const startedAt = Date.now();
  const command = suite === "docs"
    ? "git diff --check"
    : suite === "build"
      ? "git diff --check && npm run build"
      : `bash scripts/run-browser-smoke-container.sh --suite ${suite.replace("browser-", "")}`;
  writeReceipt(root, before, suite, command, 0, false);
  if (suite === "docs") {
    git(root, ["diff", "--check"], { stdio: "inherit" });
  } else if (suite === "build") {
    git(root, ["diff", "--check"], { stdio: "inherit" });
    run("npm", ["run", "build"], { cwd: path.join(root, "Backend"), stdio: "inherit" });
  } else {
    const browserSuite = suite.replace("browser-", "");
    run("bash", ["scripts/run-browser-smoke-container.sh", "--suite", browserSuite], {
      cwd: path.join(root, "Backend"),
      stdio: "inherit",
    });
  }
  const after = worktreeFingerprint(root);
  if (after !== before) throw new Error(`Arbeitsstand hat sich waehrend des Pruefprofils ${suite} geaendert`);
  writeReceipt(root, after, suite, command, Date.now() - startedAt, true);
}

export function verifyRequired(root, requestedSuite = "auto") {
  const paths = changedPaths(root);
  const requested = requestedSuite === "auto" ? requiredSuites(paths, root) : [requestedSuite];
  for (const suite of requested) {
    const status = verificationStatus(root, paths);
    if (!status.missing.includes(suite) && requestedSuite === "auto") continue;
    runSuite(root, suite);
  }
  return assertVerification(root, paths);
}
