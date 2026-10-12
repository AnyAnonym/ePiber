"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { transformSource } = require("./importRunner");

function scoreAnalysis(root) {
  const database = new DatabaseSync(path.join(root, "sqlite", "scorelog.sqlite"), { readOnly: true });
  try {
    const scalar = (sql) => Number(database.prepare(sql).get().count);
    return {
      eventCount: scalar("SELECT count(*) AS count FROM score_log"),
      duplicateEventIdGroups: scalar("SELECT count(*) AS count FROM (SELECT event_id FROM score_log GROUP BY event_id HAVING count(*)>1)"),
      duplicateSourceSequenceGroups: scalar("SELECT count(*) AS count FROM (SELECT instance,court,sequence FROM score_log GROUP BY instance,court,sequence HAVING count(*)>1)"),
      repeatedScoreGroups: scalar("SELECT count(*) AS count FROM (SELECT instance,court,score FROM score_log GROUP BY instance,court,score HAVING count(*)>1)"),
      invalidActiveRows: scalar("SELECT count(*) AS count FROM score_log WHERE court_active<>1"),
      deduplicationRule: "event_id_and_source_instance_court_sequence",
      scoreTextIsNotIdentity: true,
    };
  } finally { database.close(); }
}

function analyzeRealSource(root) {
  const transformed = transformSource(root);
  const findings = transformed.findings.map(({ code, source, projection, severity, count, ruleVersion }) => ({ code, source, projection, severity, count, ruleVersion }));
  return {
    reportVersion: 1,
    exportRunId: transformed.inspection.manifest.exportRunId,
    manifestSha256: transformed.inspection.manifestSha256,
    status: transformed.status,
    sourceCounts: transformed.sourceCounts,
    transformedSha256: transformed.plan?.transformedSha256 || null,
    targetCounts: transformed.plan ? Object.fromEntries(Object.entries(transformed.plan.tables).map(([name, rows]) => [name, rows.length])) : null,
    findings,
    score: scoreAnalysis(root),
  };
}

module.exports = { analyzeRealSource, scoreAnalysis };
