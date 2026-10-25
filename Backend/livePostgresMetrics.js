"use strict";

// Narrow metrics-only backport for the otherwise unchanged Live 5.0.0 runtime.
// No database calls, mutation, arbitrary labels or inference from SQLite gauges.
const TABLES = ["bewerbe", "bewerbsart", "entryList", "matches1", "matchtyp", "navigator", "players", "rlPlatzierung"];
const COMPONENTS = ["postgres_runtime", "postgres_score_state", "postgres_audit", "postgres_messaging", "postgres_projections"];
const LEGACY_COMPONENT = /component="(?:state_sqlite|scorelog_sqlite|auditlog_sqlite|messaging_sqlite|sheet_data)"/;

function renderPostgresMetrics(text, { readiness, loaderStatus } = {}) {
  const components = readiness?.components;
  if (!components || !Object.hasOwn(components, "postgres_runtime")) return text;
  const lines = text.trimEnd().split("\n").filter((line) => {
    if (/^(?:# (?:TYPE|HELP) )?epiber_(?:sheet_|sqlite_)/.test(line)) return false;
    return !(line.startsWith("epiber_readiness_component_ready{") && LEGACY_COMPONENT.test(line));
  });
  const names = ["epiber_projection_table_available", "epiber_projection_table_current", "epiber_projection_table_age_seconds",
    "epiber_projection_refresh_in_progress", "epiber_projection_refresh_failed", "epiber_projection_last_success_age_seconds"];
  for (const name of names) lines.push(`# TYPE ${name} gauge`);
  lines.push("# TYPE epiber_live_metrics_backport_info gauge");
  lines.push('epiber_live_metrics_backport_info{revision="1"} 1');
  for (const component of COMPONENTS) {
    lines.push(`epiber_readiness_component_ready{component="${component}"} ${components[component] === true ? 1 : 0}`);
  }
  for (const table of TABLES) {
    const status = readiness.data?.tables?.[table];
    lines.push(`epiber_projection_table_available{table="${table}"} ${status?.available === true ? 1 : 0}`);
    lines.push(`epiber_projection_table_current{table="${table}"} ${status?.current === true ? 1 : 0}`);
    const age = Number.isFinite(status?.ageMs) ? Math.max(0, status.ageMs) / 1000 : -1;
    lines.push(`epiber_projection_table_age_seconds{table="${table}"} ${age}`);
  }
  lines.push(`epiber_projection_refresh_in_progress ${loaderStatus?.active ? 1 : 0}`);
  // Unknown loader status is not silently represented as a successful refresh.
  const known = loaderStatus && Object.hasOwn(loaderStatus, "lastErrorCode");
  lines.push(`epiber_projection_refresh_failed ${!known || loaderStatus.lastErrorCode ? 1 : 0}`);
  const completedAt = loaderStatus?.lastCompletedAt;
  const age = Number.isFinite(completedAt) && completedAt > 0 ? Math.max(0, Date.now() - completedAt) / 1000 : -1;
  lines.push(`epiber_projection_last_success_age_seconds ${age}`);
  return `${lines.join("\n")}\n`;
}

module.exports = { renderPostgresMetrics };
