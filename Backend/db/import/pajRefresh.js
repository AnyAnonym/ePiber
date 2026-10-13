"use strict";

const { Client } = require("pg");
const { verifyPajRefreshPackage } = require("../export/pajRefreshProfile");
const { applyImport, summarizeTransform, transformSource, validateImport } = require("./importRunner");

async function validatePajRefreshTarget(connectionConfig) {
  const client = new Client(connectionConfig);
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM identity.user_accounts WHERE login IS NOT NULL) AS accounts,
        (SELECT count(*)::integer FROM identity.credentials WHERE active AND credential_schema='scrypt_v1' AND secret_hash LIKE 'scrypt$v1$16384$8$1$%') AS credentials,
        (SELECT count(*)::integer FROM identity.credentials) AS total_credentials,
        (SELECT count(*)::integer FROM identity.sessions) AS sessions,
        (SELECT count(*)::integer FROM identity.password_authorizations) AS password_authorizations,
        (SELECT count(*)::integer FROM identity.login_rate_limits) AS login_limits,
        (SELECT count(*)::integer FROM venue.monitor_devices WHERE revoked_at IS NULL) AS active_monitors,
        (SELECT count(*)::integer FROM venue.score_sources WHERE active) AS active_score_sources,
        (SELECT count(*)::integer FROM venue.courts WHERE active) AS active_courts,
        (SELECT count(*)::integer FROM venue.court_live_state WHERE active OR awaiting_baseline) AS active_court_state,
        (SELECT count(*)::integer FROM messaging.deliveries WHERE status<>'not_configured') AS active_deliveries,
        (SELECT count(*)::integer FROM ops.idempotency_operations) AS idempotency_operations,
        (SELECT count(*)::integer FROM ops.jobs) AS jobs,
        (SELECT count(*)::integer FROM ops.outbox) AS outbox
    `);
    const checks = result.rows[0];
    const valid = Number(checks.accounts) === Number(checks.credentials) && Number(checks.accounts) === Number(checks.total_credentials)
      && ["sessions", "password_authorizations", "login_limits", "active_monitors", "active_score_sources", "active_courts", "active_court_state", "active_deliveries", "idempotency_operations", "jobs", "outbox"].every((name) => Number(checks[name]) === 0);
    if (!valid) throw Object.assign(new Error("PAJ-Refresh-Ziel ist nicht sicher freigegeben"), { code: "PAJ_REFRESH_TARGET_INVALID", checks });
    return Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, Number(value)]));
  } finally { await client.end(); }
}

function inspectPajRefresh(root, command = "inspect") {
  const profile = verifyPajRefreshPackage(root);
  const transformed = transformSource(root);
  const summary = summarizeTransform(transformed, command);
  if (transformed.status !== "ready") throw Object.assign(new Error("PAJ-Refresh ist durch Importbefunde blockiert"), { code: "PAJ_REFRESH_BLOCKED", findings: transformed.findings });
  return { ...summary, profile: profile.profile, credentialCount: profile.credentialCount, revokedMonitorCount: profile.revokedMonitorCount, disabledDeliveryCount: profile.disabledDeliveryCount };
}

async function applyPajRefresh({ root, connectionConfig, output = () => {} }) {
  output(JSON.stringify({ event: "paj_refresh_import_started", command: "apply" }));
  try {
    const inspection = inspectPajRefresh(root, "apply");
    const imported = await applyImport({ root, connectionConfig, output });
    const checks = await validatePajRefreshTarget(connectionConfig);
    output(JSON.stringify({ event: "paj_refresh_import_completed", command: "apply", result: "success", exportRunId: inspection.exportRunId, targetSha256: imported.targetSha256, accounts: checks.accounts }));
    return { inspection, imported, checks };
  } catch (error) {
    output(JSON.stringify({ event: "paj_refresh_import_completed", command: "apply", result: error.outcome || "failed", errorCode: error.code || "PAJ_REFRESH_IMPORT_FAILED" }));
    throw Object.assign(error, { completionLogged: true });
  }
}

async function validatePajRefresh({ root, connectionConfig, output = () => {} }) {
  output(JSON.stringify({ event: "paj_refresh_import_started", command: "validate" }));
  try {
    const inspection = inspectPajRefresh(root, "validate");
    const imported = await validateImport({ root, connectionConfig, output });
    const checks = await validatePajRefreshTarget(connectionConfig);
    output(JSON.stringify({ event: "paj_refresh_import_completed", command: "validate", result: "success", exportRunId: inspection.exportRunId, targetSha256: imported.targetSha256, accounts: checks.accounts }));
    return { inspection, imported, checks };
  } catch (error) {
    output(JSON.stringify({ event: "paj_refresh_import_completed", command: "validate", result: "failed", errorCode: error.code || "PAJ_REFRESH_VALIDATE_FAILED" }));
    throw Object.assign(error, { completionLogged: true });
  }
}

module.exports = { applyPajRefresh, inspectPajRefresh, validatePajRefresh, validatePajRefreshTarget };
