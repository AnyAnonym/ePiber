"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { loadImportContracts } = require("../importContracts");

const SQLITE_FILES = {
  "state.sqlite": "sqlite/state.sqlite",
  "messaging.sqlite": "sqlite/messaging.sqlite",
  "scorelog.sqlite": "sqlite/scorelog.sqlite",
  "audit.sqlite": "sqlite/audit.sqlite",
};
const OPTIONAL_FIELDS = Object.freeze({ "messaging.sqlite:event_participants": new Set(["inbox_visible"]) });

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function inspectSqliteSchemas(root) {
  const { matrix } = loadImportContracts();
  const summary = {};
  for (const [source, relative] of Object.entries(SQLITE_FILES)) {
    const database = new DatabaseSync(path.join(root, ...relative.split("/")), { readOnly: true });
    try {
      const actualTables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name);
      const expectedTables = Object.keys(matrix.sources[source]).sort();
      if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
        throw Object.assign(new Error(`SQLite-Tabellen weichen fuer ${source} ab`), { code: "SOURCE_SQLITE_TABLE_DRIFT", source });
      }
      let fieldCount = 0;
      for (const table of expectedTables) {
        const actualFields = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(({ name }) => name).sort();
        const expectedFields = Object.keys(matrix.sources[source][table].fields).sort();
        const requiredFields = expectedFields.filter((field) => !OPTIONAL_FIELDS[`${source}:${table}`]?.has(field));
        const unexpectedFields = actualFields.filter((field) => !expectedFields.includes(field));
        if (requiredFields.some((field) => !actualFields.includes(field)) || unexpectedFields.length) {
          throw Object.assign(new Error(`SQLite-Felder weichen fuer ${source}.${table} ab`), { code: "SOURCE_SQLITE_FIELD_DRIFT", source, table });
        }
        fieldCount += actualFields.length;
      }
      summary[source] = { tableCount: actualTables.length, fieldCount };
    } finally {
      database.close();
    }
  }
  return summary;
}

module.exports = { SQLITE_FILES, inspectSqliteSchemas };
