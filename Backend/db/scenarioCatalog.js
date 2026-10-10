"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CATALOG_FILE = path.join(__dirname, "seeds", "scenarios.json");
const REQUIRED_DIMENSIONS = new Set([
  "tenant", "player", "admin", "operator", "inactive", "legacy-sha256",
  "bracket", "round-robin", "bye", "open-bracket", "walkover", "retirement",
  "ranking-effect", "score-event", "monitor-navigation", "confirmed", "waiting",
  "event", "idempotency-key", "outbox", "started", "success", "failed", "unknown",
  "deadlock", "app-no-ddl", "dst-gap", "dst-overlap", "12-months", "24-months",
]);

function loadScenarioCatalog(filename = CATALOG_FILE) {
  const catalog = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (catalog.version !== 1 || !Array.isArray(catalog.packages) || !catalog.packages.length) throw new Error("SCENARIO_CATALOG_INVALID");
  const packageIds = new Set(catalog.packages.map(({ id }) => id));
  if (packageIds.size !== catalog.packages.length) throw new Error("SCENARIO_PACKAGE_DUPLICATE");
  const scenarioIds = new Set();
  const dimensions = new Set();
  for (const seedPackage of catalog.packages) {
    if (!/^[a-z][a-z0-9-]+$/.test(seedPackage.id) || !Array.isArray(seedPackage.dependsOn) || !Array.isArray(seedPackage.scenarios)) throw new Error("SCENARIO_PACKAGE_INVALID");
    for (const dependency of seedPackage.dependsOn) if (!packageIds.has(dependency) || dependency === seedPackage.id) throw new Error("SCENARIO_DEPENDENCY_INVALID");
    for (const scenario of seedPackage.scenarios) {
      if (!/^[a-z][a-z0-9-]+$/.test(scenario.id) || scenarioIds.has(scenario.id) || !Array.isArray(scenario.dimensions) || !scenario.dimensions.length) throw new Error("SCENARIO_INVALID");
      scenarioIds.add(scenario.id);
      scenario.dimensions.forEach((dimension) => dimensions.add(dimension));
    }
  }
  for (const required of REQUIRED_DIMENSIONS) if (!dimensions.has(required)) throw new Error(`SCENARIO_DIMENSION_MISSING:${required}`);

  const visited = new Set();
  const active = new Set();
  const byId = new Map(catalog.packages.map((item) => [item.id, item]));
  function visit(id) {
    if (active.has(id)) throw new Error("SCENARIO_DEPENDENCY_CYCLE");
    if (visited.has(id)) return;
    active.add(id);
    byId.get(id).dependsOn.forEach(visit);
    active.delete(id);
    visited.add(id);
  }
  packageIds.forEach(visit);
  return catalog;
}

module.exports = { CATALOG_FILE, REQUIRED_DIMENSIONS, loadScenarioCatalog };
