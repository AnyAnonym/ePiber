import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const RECEIPT_VERSION = 2;
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

function isBranchChangelog(file) {
  return /^Project\/ChangeLogs\/ChangeLog-[^/]+\.txt$/.test(file);
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

function suiteIncludes(file, suite) {
  if (isBranchChangelog(file)) return false;
  if (WORKFLOW_METADATA.has(file)) return suite !== "docs";
  if (suite === "docs") return isDocumentation(file);
  if (suite === "build") return !isDocumentation(file);
  return file.startsWith("Frontend/")
    || /^Backend\/test\/.*\.browser\.js$/.test(file)
    || file === "Backend/test/browserProfiles.js"
    || file.startsWith("Backend/scripts/run-browser-smoke");
}

function normalizedFileContent(file, content) {
  if (!WORKFLOW_METADATA.has(file)) return content;
  try {
    const value = JSON.parse(content.toString("utf8"));
    value.version = "<workflow-version>";
    if (file.endsWith("package-lock.json") && value.packages?.[""]) {
      value.packages[""].version = "<workflow-version>";
    }
    return Buffer.from(`${JSON.stringify(value)}\n`);
  } catch {
    return content;
  }
}

export function suiteFingerprint(root, suite) {
  if (!SUITE_ORDER.includes(suite)) throw new Error(`Unbekanntes Pruefprofil: ${suite}`);
  const hash = crypto.createHash("sha256");
  const head = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  const paths = [...new Set([
    ...changedPaths(root).filter((file) => suiteIncludes(file, suite)),
    ...(suite === "docs" ? [] : [...WORKFLOW_METADATA].filter((file) => fs.existsSync(path.join(root, file)))),
  ])].sort();
  hash.update(`suite\0${suite.startsWith("browser-") ? "browser" : suite}\0head\0${head}\0`);

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
    else if (stat.isFile()) hash.update(normalizedFileContent(file, fs.readFileSync(absolute)));
    else hash.update("non-file\0");
  }
  return hash.digest("hex");
}

export function worktreeFingerprint(root) {
  const hash = crypto.createHash("sha256");
  for (const suite of SUITE_ORDER) hash.update(`${suite}\0${suiteFingerprint(root, suite)}\0`);
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

function currentBranch(root) {
  return git(root, ["branch", "--show-current"]).stdout.trim() || null;
}

export function verificationStatus(root, paths = changedPaths(root)) {
  const fingerprint = worktreeFingerprint(root);
  const required = requiredSuites(paths, root);
  const receipt = readReceipt(root);
  const contextMatches = Boolean(
    receipt
    && receipt.headSha === git(root, ["rev-parse", "HEAD"]).stdout.trim()
    && receipt.branch === currentBranch(root)
    && receipt.node === process.version,
  );
  const completed = new Set(contextMatches
    ? Object.entries(receipt.suites || {})
      .filter(([suite, value]) => value?.success === true && value.fingerprint === suiteFingerprint(root, suite))
      .map(([suite]) => suite)
    : []);
  const missing = required.filter((suite) => !suiteSatisfied(suite, completed));
  return { fingerprint, required, completed: [...completed].sort(), missing, receiptMatches: contextMatches && missing.length === 0 };
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
  const suites = current?.headSha === headSha
    && current?.branch === branch
    && current?.node === process.version
    ? { ...current.suites }
    : {};
  suites[suite] = { success, fingerprint, command, durationMs, finishedAt: new Date().toISOString() };
  const receipt = {
    version: RECEIPT_VERSION,
    headSha,
    branch,
    node: process.version,
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
  const before = suiteFingerprint(root, suite);
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
  const after = suiteFingerprint(root, suite);
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
