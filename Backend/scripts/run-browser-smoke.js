const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { profiles } = require("../test/browserProfiles");

const backendRoot = path.resolve(__dirname, "..");
const selectedTests = [
  "test/navbar.browser.js",
  "test/matches1.browser.js",
  "test/bewerbe.browser.js",
  "test/scoreboardRecentMatches.browser.js",
];
const mobileProfiles = new Set(["chrome-android", "safari-iphone", "safari-ipad"]);
const failures = [];

for (const [profileName, profile] of Object.entries(profiles)) {
  const navigationTest = mobileProfiles.has(profileName)
    ? "Mobiler Drawer"
    : "Desktop verwendet denselben Drawer";
  const testPattern = `^(${navigationTest}|30-Tage-Session|Persoenliche Startseite|Spielerverzeichnis filtert|Matches zeigen WO|Bewerbshistorie|Scoreboard zeigt WO|Scoreboard holt beim Aufwachen|Scoreboard kehrt)`;
  console.log(`\nBrowser-Smoke: ${profile.label}`);
  const result = spawnSync(process.execPath, [
    "--test",
    "--test-concurrency=1",
    "--test-name-pattern",
    testPattern,
    ...selectedTests,
  ], {
    cwd: backendRoot,
    env: { ...process.env, PLAYWRIGHT_PROFILE: profileName },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error);
    failures.push(profile.label);
    continue;
  }
  if (result.status !== 0) failures.push(profile.label);
}

if (failures.length) {
  console.error(`\nBrowser-Smoke fehlgeschlagen: ${failures.join(", ")}`);
  process.exit(1);
}
