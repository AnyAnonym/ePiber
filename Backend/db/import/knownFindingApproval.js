"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { transformSource } = require("./importRunner");

const KNOWN_WARNING_RULES = Object.freeze({
  NAVIGATION_TARGET_INVALID: Object.freeze({ handling: "transform", reasonCode: "LEGACY_NAVIGATION_DISABLED", validation: "navigation.disabled.problem_code" }),
});

function writeKnownFindingApproval(root, { approvedAt = new Date().toISOString(), approvedBy = "migration-staging-policy" } = {}) {
  const transformed = transformSource(root);
  if (transformed.status !== "ready") throw Object.assign(new Error("Import ist blockiert"), { code: "IMPORT_BLOCKED" });
  const warnings = transformed.findings.filter(({ severity }) => severity === "warning");
  const unknown = warnings.filter(({ code }) => !KNOWN_WARNING_RULES[code]);
  if (unknown.length) throw Object.assign(new Error("Unbekannte Warnung benoetigt Freigabe"), { code: "IMPORT_WARNING_DECISION_REQUIRED", warningCodes: [...new Set(unknown.map(({ code }) => code))].sort() });
  if (!warnings.length) return { written: false, warningCount: 0 };
  const manifest = {
    manifestVersion: 1,
    exportRunId: transformed.inspection.manifest.exportRunId,
    sourceManifestSha256: transformed.inspection.manifestSha256,
    approvedBy,
    approvedAt,
    rules: warnings.map(({ code, source, projection }) => ({ code, source, projection, ...KNOWN_WARNING_RULES[code] })),
  };
  fs.writeFileSync(path.join(root, "exception-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { written: true, warningCount: warnings.length, warningCodes: [...new Set(warnings.map(({ code }) => code))].sort() };
}

module.exports = { KNOWN_WARNING_RULES, writeKnownFindingApproval };
