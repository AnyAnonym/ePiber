"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const serverConfigRoot = path.resolve(__dirname, "../../Project/server-configs");

test("gemeinsamer Caddy importiert fremde Sites und Live-Pfadrouten getrennt", () => {
  const caddy = fs.readFileSync(path.join(serverConfigRoot, "Caddyfile"), "utf8");
  const externalSites = "import /etc/caddy/conf.d/*.caddy";
  const liveRoutes = "import /etc/caddy/epiber-live-routes/*.caddy";
  const liveSite = caddy.indexOf("epiber.at {");
  const staticFallback = caddy.indexOf("\thandle {", caddy.indexOf(liveRoutes));

  assert.ok(caddy.indexOf(externalSites) < liveSite);
  assert.ok(caddy.indexOf(liveRoutes) > liveSite);
  assert.ok(caddy.indexOf(liveRoutes) < staticFallback);
});

test("WC-Fragment bleibt vor dem ePiber-Fallback auf seinen Loopback-Port begrenzt", () => {
  const route = fs.readFileSync(path.join(serverConfigRoot, "caddy/epiber-live-routes/wc.caddy"), "utf8");
  assert.match(route, /redir \/wc \/wc\/ 308/);
  assert.match(route, /handle_path \/wc\/\*/);
  assert.match(route, /reverse_proxy 127\.0\.0\.1:8090/);
  assert.doesNotMatch(route, /root |file_server/);
});

test("M365-Fragment nutzt internes TLS ohne Access-Log und nur Loopback", () => {
  const site = fs.readFileSync(path.join(serverConfigRoot, "caddy/conf.d/m365-connector.caddy"), "utf8");
  assert.match(site, /m365-connector\.pi-tec\.at/);
  assert.match(site, /tls \/etc\/caddy\/certs\/m365-connector\.pi-tec\.at\//);
  assert.match(site, /reverse_proxy 127\.0\.0\.1:3000/);
  assert.doesNotMatch(site, /\blog\s/);
});
