"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../../Project/server-configs");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("manueller Development-Start wechselt fail-closed von Legacy auf PostgreSQL-App und Worker", () => {
  const script = read("bin/development-services-start");
  const postgres = script.indexOf('systemctl start "$POSTGRES_SERVICE"');
  const gitea = script.indexOf('systemctl start "$GITEA_SERVICE"');
  const m365 = script.indexOf('systemctl start "$M365_SERVICE"');
  const legacy = script.indexOf('systemctl stop "$LEGACY_SERVICE"');
  const app = script.indexOf('systemctl start "$APP_SERVICE"');
  const readiness = script.indexOf("http://127.0.0.1:8083/ready");
  const worker = script.indexOf('systemctl start "$WORKER_SERVICE"');
  assert.ok(postgres >= 0 && postgres < gitea && gitea < m365 && m365 < legacy && legacy < app && app < readiness && readiness < worker);
  assert.match(script, /M365_CONNECTOR_NOT_READY/);
  assert.match(script, /Host: m365-connector\.pi-tec\.at/);
  assert.match(script, /EPIBER_DEVEL_NOT_READY/);
  assert.match(script, /LEGACY_SERVICE_ACTIVE/);
  assert.doesNotMatch(script, /systemctl start "\$LEGACY_SERVICE"/);
  assert.match(script, /development_services_start_completed/);
});

test("Development-Start toleriert entfernte Legacy-Unit, aber keinen Abfrage- oder Stopfehler", () => {
  const script = read("bin/development-services-start");
  const guard = script.slice(script.indexOf('legacy_load_state="$('), script.indexOf('systemctl start "$APP_SERVICE"'));
  assert.match(guard, /systemctl show "\$LEGACY_SERVICE" --property=LoadState --value/);
  assert.match(guard, /"\$legacy_load_state" != "not-found"/);
  const exercise = (state, probeStatus = 0, stopStatus = 0) => spawnSync("bash", ["-c", `
    set -Eeuo pipefail
    LEGACY_SERVICE="epiber-paj.service"
    systemctl() {
      case "$1" in
        show) printf '%s\\n' "$TEST_LOAD_STATE"; return "$TEST_PROBE_STATUS" ;;
        stop) printf 'stopped\\n'; return "$TEST_STOP_STATUS" ;;
        *) exit 99 ;;
      esac
    }
    ${guard}
    printf 'continued\\n'
  `], { encoding: "utf8", env: { ...process.env, TEST_LOAD_STATE: state, TEST_PROBE_STATUS: String(probeStatus), TEST_STOP_STATUS: String(stopStatus) } });
  const absent = exercise("not-found");
  assert.equal(absent.status, 0, absent.stderr);
  assert.equal(absent.stdout, "continued\n");
  const installed = exercise("loaded");
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(installed.stdout, "stopped\ncontinued\n");
  for (const result of [exercise("loaded", 1), exercise("loaded", 0, 1)]) {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout.includes("continued"), false);
  }
});

test("Development-Stop beendet App und Worker vor Datenbank und Volume", () => {
  const script = read("bin/development-services-stop");
  const applications = script.indexOf('systemctl stop "$WORKER_SERVICE" "$APP_SERVICE" "$M365_SERVICE"');
  const gitea = script.indexOf('systemctl stop "$GITEA_SERVICE"');
  const postgres = script.indexOf('systemctl stop "$POSTGRES_SERVICE"');
  const unmount = script.indexOf('systemctl stop "$MOUNT_UNIT"');
  const close = script.indexOf('systemctl stop "$CRYPT_UNIT"');
  assert.ok(applications >= 0 && applications < gitea && gitea < postgres && postgres < unmount && unmount < close);
  assert.match(script, /development_services_stop_completed/);
  assert.doesNotMatch(script, /\bumount\b|cryptsetup close/);
  assert.match(script, /systemd-cryptsetup detach "\$MAPPER"/);
  assert.match(script, /ist nach dem Stop noch aktiv/);
});

test("PostgreSQL-App schliesst den nur manuell startbaren Legacy-Dienst aus", () => {
  const unit = read("systemd/epiber-devel.service");
  assert.match(unit, /Requires=postgresql-devel\.service/);
  assert.match(unit, /Conflicts=epiber-paj\.service/);
});

test("automatischer Boot bindet LUKS-Keydatei, Mount und Worker an die PostgreSQL-App", () => {
  const crypttab = read("postgresql/crypttab-development-data.conf").trim();
  const fstab = read("postgresql/fstab-development-data.conf").trim();
  const postgres = read("systemd/postgresql-devel.service");
  const worker = read("systemd/epiber-devel-worker.service");
  assert.equal(crypttab, "development-data UUID=77e54240-7e46-43dc-a41a-3e1a778df078 /etc/cryptsetup-keys.d/development-data.key luks");
  assert.match(fstab, /^\/dev\/mapper\/development-data \/var\/lib\/development-data ext4 /);
  assert.doesNotMatch(crypttab, /\bnoauto\b|\bnone\b/);
  assert.doesNotMatch(fstab, /\bnoauto\b/);
  assert.match(fstab, /nodev/);
  assert.match(fstab, /nosuid/);
  assert.match(fstab, /noexec/);
  assert.match(postgres, /RequiresMountsFor=\/var\/lib\/development-data/);
  assert.match(worker, /After=postgresql-devel\.service epiber-devel\.service/);
  assert.match(worker, /Requires=postgresql-devel\.service epiber-devel\.service/);
  const m365 = read("systemd/m365-connector-development-data.conf");
  assert.match(m365, /RequiresMountsFor=\/var\/lib\/development-data/);
});

test("Google-basierte Export- und Refreshwrapper sind entfernt; Offline-Import bleibt erhalten", () => {
  for (const name of ["epiber-migration-staging-run", "epiber-paj-refresh-run"]) {
    assert.equal(fs.existsSync(path.join(root, "bin", name)), false);
  }
  assert.equal(fs.existsSync(path.resolve(__dirname, "../scripts/db-paj-refresh.js")), true);
  assert.equal(fs.existsSync(path.resolve(__dirname, "../scripts/db-paj-refresh-swap.js")), true);
});
