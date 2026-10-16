"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_NAME = "manifest.json";
const REQUIRED_PATHS = new Set([
  "sheets/Personen.csv", "sheets/Bewerb.csv", "sheets/Bewerbsart.csv",
  "sheets/Matchtyp.csv", "sheets/Matches1.csv", "sheets/RL-Platzierung.csv",
  "sheets/Navigator.csv", "sheets/EntryList.csv",
  "sqlite/state.sqlite", "sqlite/messaging.sqlite", "sqlite/scorelog.sqlite", "sqlite/audit.sqlite",
  "metadata/sheets.json", "metadata/sqlite.json"
]);
const OPTIONAL_PATHS = new Set(["sheets/Logging.csv", "sheets/ScoreLog.csv", "metadata/paj-refresh.json"]);
const ALL_PATHS = new Set([...REQUIRED_PATHS, ...OPTIONAL_PATHS]);

function sha256File(filename) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filename, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function safeFile(root, relative) {
  if (!ALL_PATHS.has(relative) || relative.includes("..") || path.isAbsolute(relative)) throw Object.assign(new Error("Quellpaketpfad ist nicht erlaubt"), { code: "SOURCE_PACKAGE_PATH_INVALID" });
  const filename = path.join(root, ...relative.split("/"));
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error("Quellpaketdatei ist kein regulaeres File"), { code: "SOURCE_PACKAGE_FILE_INVALID" });
  return { filename, stat };
}

function buildSourceManifest(root, { exportRunId, exportStartedAt, exportCompletedAt }) {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(exportRunId)) throw Object.assign(new Error("Exportlauf-ID ist ungueltig"), { code: "SOURCE_PACKAGE_RUN_ID_INVALID" });
  for (const value of [exportStartedAt, exportCompletedAt]) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== value) throw Object.assign(new Error("Exportzeit ist ungueltig"), { code: "SOURCE_PACKAGE_TIME_INVALID" });
  }
  if (exportCompletedAt < exportStartedAt) throw Object.assign(new Error("Exportzeitraum ist ungueltig"), { code: "SOURCE_PACKAGE_TIME_INVALID" });
  const missing = [...REQUIRED_PATHS].filter((relative) => !fs.existsSync(path.join(root, ...relative.split("/"))));
  if (missing.length) throw Object.assign(new Error("Quellpaket ist unvollstaendig"), { code: "SOURCE_PACKAGE_REQUIRED_FILE_MISSING", missing });
  const files = [...ALL_PATHS].filter((relative) => fs.existsSync(path.join(root, ...relative.split("/")))).sort().map((relative) => {
    const { filename, stat } = safeFile(root, relative);
    return { path: relative, size: stat.size, sha256: sha256File(filename) };
  });
  return { manifestVersion: 1, exportRunId, exportStartedAt, exportCompletedAt, files };
}

function writeSourceManifest(root, metadata) {
  const manifest = buildSourceManifest(root, metadata);
  fs.writeFileSync(path.join(root, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return manifest;
}

function verifySourcePackage(root) {
  const manifestPath = path.join(root, MANIFEST_NAME);
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw Object.assign(new Error("Manifest ist ungueltig"), { code: "SOURCE_PACKAGE_MANIFEST_INVALID" });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.manifestVersion !== 1 || !Array.isArray(manifest.files)) throw Object.assign(new Error("Manifestversion ist ungueltig"), { code: "SOURCE_PACKAGE_MANIFEST_INVALID" });
  const rebuilt = buildSourceManifest(root, manifest);
  if (JSON.stringify(rebuilt) !== JSON.stringify(manifest)) throw Object.assign(new Error("Quellpaketpruefsumme weicht ab"), { code: "SOURCE_PACKAGE_FINGERPRINT_MISMATCH" });
  return { manifest, manifestSha256: crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex") };
}

module.exports = { ALL_PATHS, MANIFEST_NAME, REQUIRED_PATHS, buildSourceManifest, verifySourcePackage, writeSourceManifest };
