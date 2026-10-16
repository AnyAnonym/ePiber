"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { loadImportContracts } = require("../db/importContracts");
const { SQLITE_FILES, inspectSqliteSchemas } = require("../db/import/sourceInspector");

function createSyntheticSqliteSources(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-source-inspector-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { matrix } = loadImportContracts();
  for (const [source, relative] of Object.entries(SQLITE_FILES)) {
    const filename = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(filename);
    for (const [table, contract] of Object.entries(matrix.sources[source])) {
      const columns = Object.keys(contract.fields).map((field) => `"${field}" TEXT`).join(", ");
      database.exec(`CREATE TABLE "${table}" (${columns})`);
    }
    database.close();
  }
  return root;
}

test("SQLite-Inspektor akzeptiert nur die vollstaendig bekannte Quellstruktur", (t) => {
  const root = createSyntheticSqliteSources(t);
  const summary = inspectSqliteSchemas(root);
  assert.equal(summary["state.sqlite"].tableCount, 5);

  const database = new DatabaseSync(path.join(root, "sqlite", "state.sqlite"));
  database.exec("ALTER TABLE sessions ADD COLUMN unexpected TEXT");
  database.close();
  assert.throws(() => inspectSqliteSchemas(root), (error) => error.code === "SOURCE_SQLITE_FIELD_DRIFT");
});

test("SQLite-Inspektor akzeptiert das produktive Messaging-Schema vor inbox_visible", (t) => {
  const root = createSyntheticSqliteSources(t);
  const database = new DatabaseSync(path.join(root, "sqlite", "messaging.sqlite"));
  database.exec("ALTER TABLE event_participants DROP COLUMN inbox_visible");
  database.close();
  assert.equal(inspectSqliteSchemas(root)["messaging.sqlite"].tableCount > 0, true);
});
