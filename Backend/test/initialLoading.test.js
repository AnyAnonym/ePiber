const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendRoot = path.resolve(__dirname, "../../Frontend");
const initialLoadingPages = [
  "Bewerbe.html",
  "bewerbsRaster.html",
  "Matches1.html",
  "players.html",
  "RoundRobin.html",
  "entryList.html",
  "rangliste.html",
];

test("datenabhaengige Seiten liefern den deckenden Loader vor Inhalt und Footer aus", () => {
  for (const page of initialLoadingPages) {
    const html = fs.readFileSync(path.join(frontendRoot, page), "utf8");
    assert.match(html, /<body[^>]*aria-busy="true"[^>]*>/, `${page}: initiales aria-busy fehlt`);
    assert.equal((html.match(/data-initial-loading-overlay/g) || []).length, 1, `${page}: genau ein Initialloader erwartet`);
    assert.match(html, /class="loading-overlay" data-initial-loading-overlay role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(html, /class="loading-spinner" aria-hidden="true"/);
    assert.match(html, /<div class="loading-text">Lade Daten \.\.\.<\/div>/);
    const loaderPosition = html.indexOf("data-initial-loading-overlay");
    const footerPosition = html.indexOf('id="footer-container"');
    const scriptPosition = html.indexOf("<script");
    assert.ok(loaderPosition > 0 && loaderPosition < footerPosition, `${page}: Loader muss vor dem Footer stehen`);
    assert.ok(loaderPosition < scriptPosition, `${page}: Loader muss vor den Skripten stehen`);
  }
});
