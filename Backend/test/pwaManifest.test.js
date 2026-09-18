const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendRoot = path.resolve(__dirname, "../../Frontend");
const manifestPath = path.join(frontendRoot, "manifest.json");
const installEntryPages = [
  "index.html",
  "Bewerbe.html",
  "bewerbsRaster.html",
  "Matches1.html",
  "players.html",
  "scoreboard.html",
  "navigator.html",
  "entryList.html",
  "rangliste.html",
  "RoundRobin.html",
];
const excludedPages = [
  "monitor.html",
  "Sponsoren.html",
  "court-score-test.html",
  "adminLogging.html",
  "servicebereich.html",
  "personenNormalisieren.html",
  "mitgliederAbgleichen.html",
];

function readPngDimensions(filename) {
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${filename} ist kein PNG`);
  assert.ok(bytes.length > 10_000, `${filename} enthaelt kein belastbares App-Motiv`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("PWA-Manifest beschreibt die installierbare Online-Anwendung", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.name, "ePiber Tennis");
  assert.equal(manifest.short_name, "ePiber");
  assert.equal(manifest.description, "Digitalisierungsplattform des ASKÖ Piberbach");
  assert.equal(manifest.start_url, "/index.html");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "any");
  assert.equal(manifest.theme_color, "#176b4a");
  assert.equal(manifest.background_color, "#ffffff");
  assert.deepEqual(manifest.icons.map(({ sizes, purpose }) => [sizes, purpose]), [
    ["192x192", "any"],
    ["512x512", "any"],
    ["512x512", "maskable"],
  ]);

  for (const icon of manifest.icons) {
    const filename = path.join(frontendRoot, icon.src.slice(1));
    assert.equal(fs.existsSync(filename), true, `${icon.src} fehlt`);
    const [expectedWidth, expectedHeight] = icon.sizes.split("x").map(Number);
    assert.deepEqual(readPngDimensions(filename), { width: expectedWidth, height: expectedHeight });
  }
  assert.deepEqual(readPngDimensions(path.join(frontendRoot, "Images/pwa/apple-touch-icon.png")), {
    width: 180,
    height: 180,
  });
});

test("nur vorgesehene Seiten bieten den Installationseinstieg an", () => {
  for (const page of installEntryPages) {
    const html = fs.readFileSync(path.join(frontendRoot, page), "utf8");
    assert.match(html, /<link rel="manifest" href="\/manifest\.json" \/>/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/Images\/pwa\/apple-touch-icon\.png" \/>/);
    assert.match(html, /<meta name="theme-color" content="#176b4a" \/>/);
    assert.match(html, /<meta name="apple-mobile-web-app-title" content="ePiber" \/>/);
  }
  for (const page of excludedPages) {
    const html = fs.readFileSync(path.join(frontendRoot, page), "utf8");
    assert.doesNotMatch(html, /rel="manifest"/);
  }
});

test("PWA Light registriert bewusst keinen Service Worker", () => {
  const scripts = fs.readdirSync(path.join(frontendRoot, "JS"))
    .filter((filename) => filename.endsWith(".js"))
    .map((filename) => fs.readFileSync(path.join(frontendRoot, "JS", filename), "utf8"))
    .join("\n");
  assert.doesNotMatch(scripts, /serviceWorker\s*\.\s*register/);
});

test("Dashboard und gemeinsame Oberflaeche verwenden dieselbe gruene Primaerfarbe", () => {
  const sharedStyles = fs.readFileSync(path.join(frontendRoot, "CSS/styles.css"), "utf8");
  const dashboardStyles = fs.readFileSync(path.join(frontendRoot, "CSS/dashboard.css"), "utf8");
  const roundRobinStyles = fs.readFileSync(path.join(frontendRoot, "CSS/RoundRobin.css"), "utf8");
  assert.match(sharedStyles, /--accent: #176b4a;/);
  assert.match(sharedStyles, /header \{[\s\S]*?background: var\(--accent\);/);
  assert.match(sharedStyles, /\.mobile-nav-header \{[\s\S]*?background: var\(--accent\);/);
  assert.match(dashboardStyles, /--green: var\(--accent\);/);
  assert.doesNotMatch(`${sharedStyles}\n${dashboardStyles}\n${roundRobinStyles}`, /#0b57d0/i);
});
