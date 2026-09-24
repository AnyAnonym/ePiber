const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { profiles } = require("../test/browserProfiles");

const backendRoot = path.resolve(__dirname, "..");
const fullTests = [
  "test/navbar.browser.js",
  "test/matches1.browser.js",
  "test/bewerbe.browser.js",
  "test/scoreboardRecentMatches.browser.js",
  "test/hallzeiten.browser.js",
  "test/navigator.browser.js",
];
const mobileProfiles = new Set(["chrome-android", "samsung-internet-android", "safari-iphone", "safari-ipad"]);
const coreProfiles = new Set(["chrome-windows", "safari-macos", "firefox-windows"]);
const args = process.argv.slice(2);
let suite = "full";
let listOnly = false;
const requestedProfiles = new Set();
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--suite") {
    suite = args[index + 1];
    index += 1;
  } else if (args[index] === "--profile") {
    requestedProfiles.add(args[index + 1]);
    index += 1;
  } else if (args[index] === "--list") listOnly = true;
  else throw new Error(`Unbekanntes Argument: ${args[index]}`);
}
if (!["core", "lifecycle", "full"].includes(suite)) throw new Error(`Unbekannte Browser-Smokesuite: ${suite}`);
for (const profile of requestedProfiles) {
  if (!profiles[profile]) throw new Error(`Unbekanntes Browserprofil: ${profile}`);
}

const suiteProfiles = suite === "core" ? coreProfiles : new Set(Object.keys(profiles));
const selectedProfiles = Object.entries(profiles).filter(([name]) =>
  suiteProfiles.has(name) && (!requestedProfiles.size || requestedProfiles.has(name)),
);
const lifecyclePattern = "^(Scoreboard holt beim Aufwachen ohne Seitenreload einen aktuellen Snapshot)$";
const failures = [];

if (listOnly) {
  process.stdout.write(`${JSON.stringify({
    suite,
    profiles: selectedProfiles.map(([name]) => name),
    tests: suite === "lifecycle" ? ["test/scoreboardRecentMatches.browser.js"] : fullTests,
  }, null, 2)}\n`);
  process.exit(0);
}

for (const [profileName, profile] of selectedProfiles) {
  const navigationTest = mobileProfiles.has(profileName)
    ? "Mobiler Drawer"
    : "Desktop verwendet denselben Drawer";
  const testPattern = suite === "lifecycle"
    ? lifecyclePattern
    : `^(${navigationTest}|30-Tage-Session|Erfolgreiche An- und Abmeldung|Dashboard ist trotz|Persoenliche Startseite|Profil und Meldungen sind favorisierbar|Ergebniseingabe und Terminauswahl|Spielerverzeichnis filtert|Matches zeigen WO|Bewerbshistorie|Scoreboard zeigt WO|Scoreboard zeigt ein bestaetigtes Ergebnis|Scoreboard holt beim Aufwachen|Scoreboard kehrt|Hallenzeiten-Raster|Hallenzeiten-Verwaltung|Hallenzeiten liegen|Profilmodal zeigt|Navigator zeigt den automatischen Courtstart)`;
  const selectedTests = suite === "lifecycle" ? ["test/scoreboardRecentMatches.browser.js"] : fullTests;
  console.log(`\nBrowser-Smoke (${suite}): ${profile.label}`);
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
