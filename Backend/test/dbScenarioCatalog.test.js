"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { REQUIRED_DIMENSIONS, loadScenarioCatalog } = require("../db/scenarioCatalog");

test("synthetischer PostgreSQL-Szenariokatalog deckt alle freigegebenen Dimensionen ab", () => {
  const catalog = loadScenarioCatalog();
  const scenarios = catalog.packages.flatMap((seedPackage) => seedPackage.scenarios);
  const dimensions = new Set(scenarios.flatMap(({ dimensions: values }) => values));
  assert.equal(catalog.packages.length, 6);
  assert.ok(scenarios.length >= 40);
  for (const dimension of REQUIRED_DIMENSIONS) assert.ok(dimensions.has(dimension), dimension);
});
