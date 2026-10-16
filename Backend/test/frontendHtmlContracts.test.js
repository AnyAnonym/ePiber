"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const frontend = path.resolve(__dirname, "../../Frontend");

test("jede Seite mit Footer laedt dessen Uhrvertrag davor", () => {
  const pages = fs.readdirSync(frontend).filter((name) => name.endsWith(".html"));
  for (const page of pages) {
    const html = fs.readFileSync(path.join(frontend, page), "utf8");
    const footer = html.indexOf('src="JS/footer.js"');
    if (footer < 0) continue;
    const clock = html.indexOf('src="JS/clock.js"');
    assert.notEqual(clock, -1, `${page} laedt clock.js nicht`);
    assert.ok(clock < footer, `${page} laedt clock.js nicht vor footer.js`);
  }
});
