"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../Project/server-configs");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("Unbenutzte separate Live-Cluster-Vorlagen bleiben als Alternative erhalten", () => {
  const config = read("postgresql/postgresql-live.conf");
  const unit = read("systemd/postgresql-live.service");
  const hba = read("postgresql/pg_hba-live.conf");
  assert.match(config, /data_directory = '\/var\/lib\/epiber-live\/postgresql\/18\/data'/);
  assert.match(config, /port = 5432/);
  assert.match(config, /unix_socket_directories = '\/run\/postgresql\/epiber-live'/);
  assert.match(config, /archive_mode = off/);
  assert.match(unit, /User=postgres-live/);
  assert.match(unit, /ConditionPathIsMountPoint=\/var\/lib\/epiber-live/);
  assert.doesNotMatch(unit, /development-data|postgres-devel/);
  assert.match(hba, /local epiber_askoe epiber_live_app_readonly scram-sha-256/);
  assert.match(hba, /host all all 127\.0\.0\.1\/32 reject/);
});

test("Live-Appmodi trennen Read-only, Read-write und Worker fail-closed", () => {
  const readOnly = read("systemd/epiber-live-readonly.service");
  const readWrite = read("systemd/epiber-live.service");
  const worker = read("systemd/epiber-live-worker.service");
  for (const unit of [readOnly, readWrite, worker]) {
    assert.match(unit, /PGHOST=\/run\/postgresql\/devel/);
    assert.match(unit, /PGPORT=5433/);
    assert.match(unit, /Requires=postgresql-devel\.service/);
    assert.match(unit, /RequiresMountsFor=\/var\/lib\/development-data/);
    assert.match(unit, /SupplementaryGroups=postgres-devel-client/);
    assert.match(unit, /StandardOutput=journal/);
    assert.match(unit, /LogRateLimitBurst=1000/);
    assert.doesNotMatch(unit, /postgresql-live\.service|PGPORT=5432|postgres-live-client/);
    assert.match(unit, /PGDATABASE=epiber_askoe/);
    assert.match(unit, /EPIBER_TENANT_CODE=askoe-piberbach/);
  }
  assert.match(readOnly, /EPIBER_WRITE_MODE=read_only/);
  assert.match(readOnly, /PGUSER=epiber_live_app_readonly/);
  assert.match(readOnly, /Conflicts=epiber-piber\.service epiber-live\.service/);
  assert.match(readWrite, /EPIBER_WRITE_MODE=read_write/);
  assert.match(readWrite, /PGUSER=epiber_live_app/);
  assert.match(worker, /PGUSER=epiber_live_worker/);
  assert.match(worker, /Conflicts=epiber-live-readonly\.service/);
  assert.match(readWrite, /LISTEN_HOST=127\.0\.0\.1/);
  assert.doesNotMatch(readWrite, /^IPAddressDeny=any$/m);
  assert.match(worker, /RestrictAddressFamilies=AF_UNIX$/m);
});

test("Live-Moduswechsel und Ops-Smoke bleiben aktionsbezogen gegated", () => {
  const controller = read("bin/epiber-live-mode");
  const smoke = read("systemd/epiber-live-ops-smoke.service");
  assert.match(controller, /case "\$\{mode\}" in\s+active\|maintenance/);
  assert.match(controller, /caddy validate --config \/etc\/caddy\/Caddyfile/);
  assert.match(controller, /live_mode_change_completed/);
  assert.match(controller, /CADDY_ACTIVATION_FAILED/);
  assert.match(smoke, /ConditionPathExists=\/etc\/epiber-live\/ops-smoke-approved/);
  assert.match(smoke, /Requires=postgresql-devel\.service epiber-live\.service epiber-live-worker\.service/);
  assert.match(smoke, /PGHOST=\/run\/postgresql\/devel PGPORT=5433 PGDATABASE=epiber_askoe/);
  assert.match(smoke, /EPIBER_DB_SMOKE_CLEANUP_ROLE=epiber_live_owner/);
  assert.match(smoke, /scripts\/db-ops-smoke\.js/);
});
