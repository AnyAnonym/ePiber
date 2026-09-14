const { google } = require("googleapis");
const { SHEET_ID } = require("../config.js");

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const MEMBERS = new Map([
  ["player", "player"],
  ["player a", "player A"],
  ["player b", "player B"],
  ["admin", "player A"],
  ["operator", ""],
]);

function columnName(index) {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}

function fail(code, message) {
  const error = new Error(message || code);
  error.code = code;
  throw error;
}

function headerIndexes(header) {
  const indexes = new Map(header.map((value, index) => [String(value || "").trim().toLowerCase(), index]));
  const required = ["id", "aktiv", "role", "mitglied", "admin", "operator"];
  for (const name of required) if (!indexes.has(name)) fail("SHEET_SCHEMA", `Personen-Spalte ${name} fehlt`);
  return Object.fromEntries(required.map((name) => [name, indexes.get(name)]));
}

function migrationPlan(rows, indexes) {
  const updates = [];
  const legacyRoleCounts = { player: 0, playerA: 0, playerB: 0, admin: 0, operator: 0 };
  const activeTargetCounts = { player: 0, playerA: 0, playerB: 0, admin: 0, operator: 0 };
  for (const [offset, row] of rows.entries()) {
    const role = String(row[indexes.role] || "").trim().toLowerCase();
    const legacyMember = MEMBERS.get(role);
    if (legacyMember === undefined) fail("ROLE_INVALID", `Personen-Zeile ${offset + 2} besitzt keine migrierbare Role`);
    const active = String(row[indexes.aktiv] || "").trim() === "1";
    const member = active ? legacyMember : "";
    const desired = [member, role === "admin" ? "1" : "", role === "operator" ? "1" : ""];
    const existing = [indexes.mitglied, indexes.admin, indexes.operator].map((index) => String(row[index] || "").trim());
    if (existing.some((value, index) => value && value !== desired[index])) {
      fail("MIGRATION_CONFLICT", `Personen-Zeile ${offset + 2} besitzt bereits abweichende neue Rollenwerte`);
    }
    if (existing.some((value, index) => value !== desired[index])) updates.push({ row: offset + 2, desired });
    if (role === "player") legacyRoleCounts.player++;
    else if (role === "player a") legacyRoleCounts.playerA++;
    else if (role === "player b") legacyRoleCounts.playerB++;
    else legacyRoleCounts[role]++;
    if (active) {
      if (member === "player") activeTargetCounts.player++;
      if (member === "player A") activeTargetCounts.playerA++;
      if (member === "player B") activeTargetCounts.playerB++;
      if (role === "admin") activeTargetCounts.admin++;
      if (role === "operator") activeTargetCounts.operator++;
    }
  }
  return { updates, legacyRoleCounts, activeTargetCounts };
}

async function main() {
  const mode = process.argv[2];
  if (!["--dry-run", "--apply"].includes(mode) || process.argv.length !== 3) fail("USAGE", "Verwendung: node scripts/migratePeopleRoles.js --dry-run|--apply");
  if (!SHEET_ID) fail("SHEET_ID_MISSING");
  const auth = new google.auth.GoogleAuth({ scopes: [SCOPE] });
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Personen" });
  const values = response.data.values || [];
  if (values.length < 2) fail("SHEET_EMPTY");
  const indexes = headerIndexes(values[0]);
  const plan = migrationPlan(values.slice(1), indexes);
  const summary = {
    mode: mode === "--apply" ? "apply" : "dry-run",
    totalRows: values.length - 1,
    updateCount: plan.updates.length,
    legacyRoleCounts: plan.legacyRoleCounts,
    activeTargetCounts: plan.activeTargetCounts,
  };
  if (mode === "--dry-run") return console.log(JSON.stringify(summary));
  const columns = [indexes.mitglied, indexes.admin, indexes.operator].map(columnName);
  const data = columns.map((column, position) => ({ range: `Personen!${column}2:${column}${values.length}`, values: values.slice(1).map((row, offset) => [plan.updates.find((update) => update.row === offset + 2)?.desired[position] ?? String(row[[indexes.mitglied, indexes.admin, indexes.operator][position]] || "").trim()]) }));
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: "RAW", data } });
  const confirmation = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `Personen!A1:${columns.at(-1)}${values.length}` });
  const confirmed = migrationPlan((confirmation.data.values || []).slice(1), indexes);
  if (confirmed.updates.length) fail("WRITE_CONFIRMATION_FAILED");
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", errorCode: error.code || "MIGRATION_FAILED" }));
  process.exitCode = 1;
});
