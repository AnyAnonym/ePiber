"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { google } = require("googleapis");
const { SHEET_FIELDS } = require("../import/sheetInspector");
const { writeSourceManifest, verifySourcePackage } = require("../import/sourcePackage");
const { PROFILE: PAJ_REFRESH_PROFILE, sanitizePeopleRows, sanitizeSqlite, verifyPajRefreshPackage, writeProfileMetadata } = require("./pajRefreshProfile");

const REQUIRED_SHEETS = Object.freeze(Object.keys(SHEET_FIELDS));
const OPTIONAL_SHEETS = Object.freeze(["Logging", "ScoreLog"]);
const TRAILING_DATA_ALLOWED = new Set(["EntryList"]);
const SQLITE_SOURCES = Object.freeze({
  "state.sqlite": "STATE_FILE",
  "messaging.sqlite": "MESSAGING_FILE",
  "scorelog.sqlite": "SCORELOG_FILE",
  "audit.sqlite": "AUDITLOG_FILE",
});

function exporterError(code, message) { return Object.assign(new Error(message), { code }); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function csvField(value) {
  const text = String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(values) {
  return `${values.map((row) => row.map(csvField).join(";")).join("\n")}\n`;
}

function rectangularRows(values, sheet) {
  const width = values[0]?.length || 0;
  if (!width) throw exporterError("EXPORT_SHEET_HEADER_MISSING", `Sheet ${sheet} besitzt keine Kopfzeile`);
  return values.map((row) => {
    if (row.length > width && !TRAILING_DATA_ALLOWED.has(sheet)) throw exporterError("EXPORT_SHEET_ROW_TOO_WIDE", `Sheet ${sheet} besitzt eine zu breite Zeile`);
    const controlled = row.slice(0, width);
    return [...controlled, ...Array(width - controlled.length).fill("")];
  });
}

function safeSource(filename, name) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw exporterError("EXPORT_SOURCE_FILE_INVALID", `${name} ist keine regulaere Quelldatei`);
  return stat;
}

function sqliteSnapshot(source, target) {
  safeSource(source, path.basename(source));
  const result = spawnSync("sqlite3", [source, `.timeout 30000`, `.backup '${target.replaceAll("'", "''")}'`], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
  });
  if (result.status !== 0) throw exporterError("EXPORT_SQLITE_BACKUP_FAILED", `SQLite-Snapshot fuer ${path.basename(source)} fehlgeschlagen`);
  fs.chmodSync(target, 0o600);
}

function copySqliteSnapshot(source, target) {
  try { safeSource(source, path.basename(source)); } catch (error) {
    if (error.code === "EACCES") throw exporterError("EXPORT_SQLITE_LSTAT_ACCESS_DENIED", "Vorbereiteter SQLite-Snapshot ist nicht erreichbar");
    throw error;
  }
  try { fs.accessSync(source, fs.constants.R_OK); } catch { throw exporterError("EXPORT_SQLITE_SOURCE_NOT_READABLE", "Vorbereiteter SQLite-Snapshot ist nicht lesbar"); }
  try { fs.accessSync(path.dirname(target), fs.constants.W_OK); } catch { throw exporterError("EXPORT_SQLITE_TARGET_NOT_WRITABLE", "SQLite-Zielverzeichnis ist nicht beschreibbar"); }
  try { fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); } catch (error) {
    if (error.code === "EACCES") throw exporterError("EXPORT_SQLITE_COPY_ACCESS_DENIED", "SQLite-Snapshot konnte nicht kopiert werden");
    throw error;
  }
  try { fs.chmodSync(target, 0o600); } catch (error) {
    if (error.code === "EACCES") throw exporterError("EXPORT_SQLITE_CHMOD_ACCESS_DENIED", "SQLite-Snapshotrechte konnten nicht gesetzt werden");
    throw error;
  }
}

function sqliteMetadata(filename) {
  const result = spawnSync("sqlite3", [filename, "PRAGMA quick_check; PRAGMA user_version; SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
  });
  if (result.status !== 0) throw exporterError("EXPORT_SQLITE_VERIFY_FAILED", `SQLite-Pruefung fuer ${path.basename(filename)} fehlgeschlagen`);
  const lines = result.stdout.trim().split(/\r?\n/);
  if (lines[0] !== "ok") throw exporterError("EXPORT_SQLITE_INTEGRITY_FAILED", `SQLite-Integritaet fuer ${path.basename(filename)} ist unklar`);
  return { userVersion: Number(lines[1]), tableCount: Number(lines[2]), size: fs.statSync(filename).size, sha256: sha256(fs.readFileSync(filename)) };
}

async function googleClient(credentialsFile) {
  safeSource(credentialsFile, "Google-Credential");
  // Google requires the spreadsheets scope for developerMetadata.search even
  // though this exporter exposes and calls read methods only.
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(fs.readFileSync(credentialsFile, "utf8")), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return google.sheets({ version: "v4", auth });
}

function controlledSpreadsheetMetadata(value, metadata) {
  return {
    spreadsheetId: value.spreadsheetId,
    titleSha256: sha256(String(value.properties?.title || "")),
    sheets: (value.sheets || []).map(({ properties }) => ({ sheetId: properties.sheetId, title: properties.title, rowCount: properties.gridProperties?.rowCount || 0, columnCount: properties.gridProperties?.columnCount || 0 })),
    developerMetadata: metadata.map((entry) => ({
      metadataId: entry.metadataId,
      metadataKey: entry.metadataKey,
      metadataValue: entry.metadataValue,
      visibility: entry.visibility,
      location: entry.location || null,
    })).sort((left, right) => Number(left.metadataId) - Number(right.metadataId)),
  };
}

async function readSheetSnapshot(sheets, spreadsheetId) {
  const spreadsheet = (await sheets.spreadsheets.get({
    spreadsheetId, includeGridData: false,
    fields: "spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
  })).data;
  const available = new Map((spreadsheet.sheets || []).map(({ properties }) => [properties.title, properties.sheetId]));
  const availableFolded = new Map();
  for (const title of available.keys()) {
    const folded = title.toLocaleLowerCase("de-AT");
    if (availableFolded.has(folded)) throw exporterError("EXPORT_SHEET_NAME_AMBIGUOUS", "Tabellenreiter unterscheiden sich nur durch Gross-/Kleinschreibung");
    availableFolded.set(folded, title);
  }
  const actualTitle = (name) => availableFolded.get(name.toLocaleLowerCase("de-AT"));
  const missing = REQUIRED_SHEETS.filter((name) => !actualTitle(name));
  if (missing.length) throw exporterError("EXPORT_SHEET_REQUIRED_MISSING", "Mindestens ein Pflicht-Sheet fehlt");
  const selected = [...REQUIRED_SHEETS, ...OPTIONAL_SHEETS.filter((name) => actualTitle(name))];
  const values = (await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: selected.map((name) => `'${actualTitle(name).replaceAll("'", "''")}'`), valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" })).data.valueRanges || [];
  const byName = new Map(selected.map((name, index) => [name, values[index]?.values || []]));
  const dataFilters = [
    { developerMetadataLookup: { locationType: "SPREADSHEET" } },
    ...[...available.values()].map((sheetId) => ({ developerMetadataLookup: { metadataLocation: { sheetId } } })),
  ];
  const searched = await sheets.spreadsheets.developerMetadata.search({ spreadsheetId, requestBody: { dataFilters } });
  const metadataById = new Map();
  for (const match of searched.data.matchedDeveloperMetadata || []) {
    const entry = match.developerMetadata;
    if (entry?.metadataId !== undefined) metadataById.set(entry.metadataId, entry);
  }
  const metadata = controlledSpreadsheetMetadata(spreadsheet, [...metadataById.values()]);
  const fingerprint = sha256(JSON.stringify({ values: selected.map((name) => [name, byName.get(name)]), metadata }));
  return { selected, byName, metadata, fingerprint };
}

function prepareRoot(root) {
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw exporterError("EXPORT_TARGET_NOT_EMPTY", "Exportziel ist nicht leer");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  for (const directory of ["sheets", "sqlite", "metadata"]) fs.mkdirSync(path.join(root, directory), { mode: 0o700 });
}

async function exportLegacySource({ root, spreadsheetId, credentialsFile, sqliteFiles, exportRunId, profile = "migration-v1", testPasswordHash = null, sheetsClient = null, snapshotSqlite = sqliteSnapshot, preSnapshotted = false, now = () => new Date() }) {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(String(exportRunId || ""))) throw exporterError("EXPORT_RUN_ID_INVALID", "Exportlauf-ID ist ungueltig");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(String(spreadsheetId || ""))) throw exporterError("EXPORT_SHEET_ID_INVALID", "Spreadsheet-ID ist ungueltig");
  if (!new Set(["migration-v1", PAJ_REFRESH_PROFILE]).has(profile)) throw exporterError("EXPORT_PROFILE_INVALID", "Exportprofil ist ungueltig");
  if (profile === PAJ_REFRESH_PROFILE && !/^[0-9a-f]{64}$/i.test(String(testPasswordHash || "").trim())) throw exporterError("PAJ_REFRESH_PASSWORD_HASH_INVALID", "Testpasswort-Hash fehlt");
  let stage = "target_prepare";
  prepareRoot(root);
  const startedAt = now().toISOString();
  try {
    stage = "google_client";
    const sheets = sheetsClient || await googleClient(credentialsFile);
    stage = "sheet_snapshot_before";
    const before = await readSheetSnapshot(sheets, spreadsheetId);
    stage = "sheet_csv_write";
    let credentialCount = 0;
    for (const name of before.selected) {
      let rows = rectangularRows(before.byName.get(name), name);
      if (profile === PAJ_REFRESH_PROFILE && name === "Personen") {
        const sanitized = sanitizePeopleRows(rows, { clientHash: testPasswordHash, exportRunId });
        rows = sanitized.rows;
        credentialCount = sanitized.credentialCount;
      }
      fs.writeFileSync(path.join(root, "sheets", `${name}.csv`), csv(rows), { mode: 0o600, flag: "wx" });
    }
    const sqliteSummary = {};
    const refreshSummary = { credentialCount, revokedMonitorCount: 0, disabledDeliveryCount: 0 };
    for (const [targetName, environmentName] of Object.entries(SQLITE_SOURCES)) {
      const source = sqliteFiles[environmentName];
      if (!source) throw exporterError("EXPORT_SQLITE_SOURCE_MISSING", `${environmentName} fehlt`);
      const target = path.join(root, "sqlite", targetName);
      stage = `sqlite_snapshot_${targetName.replaceAll(".", "_")}`;
      (preSnapshotted ? copySqliteSnapshot : snapshotSqlite)(source, target);
      if (profile === PAJ_REFRESH_PROFILE) {
        const sanitized = sanitizeSqlite(target, targetName, { exportRunId, exportStartedAt: startedAt });
        refreshSummary.revokedMonitorCount += sanitized.revokedMonitors;
        refreshSummary.disabledDeliveryCount += sanitized.disabledDeliveries;
      }
      stage = `sqlite_metadata_${targetName.replaceAll(".", "_")}`;
      sqliteSummary[targetName] = sqliteMetadata(target);
    }
    stage = "sheet_snapshot_after";
    const after = await readSheetSnapshot(sheets, spreadsheetId);
    if (before.fingerprint !== after.fingerprint) throw exporterError("EXPORT_SOURCE_CHANGED", "Sheetquelle hat sich waehrend des Exports geaendert");
    stage = "metadata_write";
    fs.writeFileSync(path.join(root, "metadata", "sheets.json"), `${JSON.stringify(before.metadata, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.writeFileSync(path.join(root, "metadata", "sqlite.json"), `${JSON.stringify(sqliteSummary, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    if (profile === PAJ_REFRESH_PROFILE) writeProfileMetadata(root, refreshSummary);
    const completedAt = now().toISOString();
    stage = "manifest_write";
    writeSourceManifest(root, { exportRunId, exportStartedAt: startedAt, exportCompletedAt: completedAt });
    stage = "package_verify";
    const verified = profile === PAJ_REFRESH_PROFILE ? verifyPajRefreshPackage(root) : verifySourcePackage(root);
    return { exportRunId, profile, manifestSha256: verified.manifestSha256, fileCount: verified.manifest.files.length };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    if (error.code === "EACCES") throw exporterError(`EXPORT_${stage.toUpperCase()}_ACCESS_DENIED`, "Exportzugriff wurde verweigert");
    throw error;
  }
}

module.exports = { OPTIONAL_SHEETS, REQUIRED_SHEETS, SQLITE_SOURCES, copySqliteSnapshot, csv, exportLegacySource, readSheetSnapshot, rectangularRows, sqliteSnapshot };
