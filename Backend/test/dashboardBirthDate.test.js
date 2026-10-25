"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../../Frontend/JS/dashboard.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf("function parseBirthDate"), source.indexOf("function calendarDay")), context);
test("Dashboard akzeptiert echte PostgreSQL-ISO-Geburtstage ohne Zeitzonenverschiebung", () => {
  for (const [value, expected] of [["2000-02-29", { year: 2000, month: 2, day: 29 }], ["1980-12-31", { year: 1980, month: 12, day: 31 }], ["31.12.1980", { year: 1980, month: 12, day: 31 }], ["19801231", { year: 1980, month: 12, day: 31 }], ["801231", { year: 1980, month: 12, day: 31 }]]) {
    assert.deepEqual(JSON.parse(JSON.stringify(context.parseBirthDate(value))), expected);
  }
  for (const value of ["1900-02-29", "2026-02-30", "2026-13-01", "2026-00-01", "2026-01-00", "0000-01-01", "2026-01-01T00:00:00Z", ""]) assert.equal(context.parseBirthDate(value), null);
});
