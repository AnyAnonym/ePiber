const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const backendRoot = path.resolve(__dirname, "..");

function listSuite(suite) {
  const result = spawnSync(process.execPath, ["scripts/run-browser-smoke.js", "--suite", suite, "--list"], {
    cwd: backendRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("Browser-Smokerunner trennt Kern-, Lifecycle- und Vollmatrix", () => {
  const core = listSuite("core");
  assert.deepEqual(core.profiles, ["chrome-windows", "safari-macos", "firefox-windows"]);

  const lifecycle = listSuite("lifecycle");
  assert.equal(lifecycle.profiles.length, 8);
  assert.deepEqual(lifecycle.tests, ["test/scoreboardRecentMatches.browser.js"]);

  const full = listSuite("full");
  assert.equal(full.profiles.length, 8);
  assert.ok(full.tests.length > lifecycle.tests.length);
});

test("Containerwrapper verwendet eindeutige IDs und raeumt bei Abbruch auf", () => {
  const wrapper = fs.readFileSync(path.join(backendRoot, "scripts/run-browser-smoke-container.sh"), "utf8");
  assert.match(wrapper, /container_name="epiber-playwright-smoke-\$\(id -u\)-\$\$"/);
  assert.match(wrapper, /--cidfile "\$\{cid_file\}"/);
  assert.match(wrapper, /trap cleanup EXIT INT TERM HUP/);
  assert.match(wrapper, /rm -f "\$\(cat "\$\{cid_file\}"\)"/);
});
