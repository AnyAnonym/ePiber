const test = require("node:test");
const assert = require("node:assert/strict");
const { renderPostgresMetrics } = require("../livePostgresMetrics.js");

const tables = ["bewerbe", "bewerbsart", "entryList", "matches1", "matchtyp", "navigator", "players", "rlPlatzierung"];
const components = Object.fromEntries(["postgres_runtime", "postgres_score_state", "postgres_audit", "postgres_messaging", "postgres_projections"].map((name) => [name, true]));
const source = [
  "# TYPE epiber_readiness_component_ready gauge",
  'epiber_readiness_component_ready{component="initialized"} 1',
  'epiber_readiness_component_ready{component="state_sqlite"} 0',
  'epiber_readiness_component_ready{component="sheet_data"} 0',
  "# TYPE epiber_sheet_table_current gauge",
  'epiber_sheet_table_current{table="players"} 1',
  "# TYPE epiber_sqlite_ready gauge",
  'epiber_sqlite_ready{database="state"} 0',
  'epiber_http_requests_total{method="GET",route="ready",result="success"} 7',
  'epiber_ws_connections{state="ready"} 3',
  "",
].join("\n");

test("Live-Metrikbackport verwendet echte PostgreSQL-Komponenten und acht begrenzte Projektionen", () => {
  const readiness = { components, data: { tables: Object.fromEntries(tables.map((table) => [table, { current: true, available: true, ageMs: 2500 }])) } };
  const text = renderPostgresMetrics(source, { readiness, loaderStatus: { active: false, lastCompletedAt: Date.now(), lastErrorCode: null } });
  assert.doesNotMatch(text, /epiber_sheet_|epiber_sqlite_|component="(?:state_sqlite|sheet_data)"/);
  assert.ok(text.includes('epiber_http_requests_total{method="GET",route="ready",result="success"} 7'));
  assert.ok(text.includes('epiber_ws_connections{state="ready"} 3'));
  assert.ok(text.includes('epiber_readiness_component_ready{component="initialized"} 1'));
  for (const component of Object.keys(components)) assert.ok(text.includes(`epiber_readiness_component_ready{component="${component}"} 1`));
  for (const table of tables) {
    assert.ok(text.includes(`epiber_projection_table_current{table="${table}"} 1`));
    assert.ok(text.includes(`epiber_projection_table_age_seconds{table="${table}"} 2.5`));
  }
  assert.match(text, /^epiber_projection_refresh_failed 0$/m);
  assert.match(text, /^epiber_projection_refresh_in_progress 0$/m);
  assert.equal((text.match(/^# TYPE epiber_projection_refresh_failed gauge$/gm) || []).length, 1);
});

test("Live-Metrikbackport zeigt Fehler, fehlende Komponenten und Tabellen ohne private Rohwerte", () => {
  const text = renderPostgresMetrics(source, {
    readiness: { components: { postgres_runtime: false }, data: { tables: { private_name: { current: true }, players: { current: false, available: true, ageMs: NaN } } } },
    loaderStatus: { active: true, lastCompletedAt: 0, lastErrorCode: "private-database-error-password-token" },
  });
  assert.match(text, /^epiber_projection_refresh_failed 1$/m);
  assert.match(text, /^epiber_projection_refresh_in_progress 1$/m);
  assert.match(text, /^epiber_projection_last_success_age_seconds -1$/m);
  assert.ok(text.includes('epiber_readiness_component_ready{component="postgres_audit"} 0'));
  assert.ok(text.includes('epiber_projection_table_current{table="bewerbe"} 0'));
  assert.ok(text.includes('epiber_projection_table_age_seconds{table="players"} -1'));
  assert.equal((text.match(/^epiber_projection_table_current\{/gm) || []).length, 8);
  assert.doesNotMatch(text, /private|password|token|NaN|Infinity/);
  assert.match(renderPostgresMetrics(source, { readiness: { components } }), /^epiber_projection_refresh_failed 1$/m);
});

test("Metrikbackport laesst nicht-PostgreSQL-Texte unveraendert", () => {
  assert.equal(renderPostgresMetrics(source), source);
  assert.equal(renderPostgresMetrics(source, { readiness: { components: { state_sqlite: true } } }), source);
});
