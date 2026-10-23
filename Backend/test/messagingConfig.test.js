const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const SYSTEMD_ROOT = path.resolve(BACKEND_ROOT, "../Project/server-configs/systemd");

test("Messaging-SQLite verwendet ohne eigenen Pfad den Namen messaging.sqlite neben STATE_FILE", () => {
  const script = `
    process.env.STATE_FILE = "/var/lib/epiber-paj/state.sqlite";
    delete process.env.MESSAGING_FILE;
    process.stdout.write(require("./config.js").MESSAGING_FILE);
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: BACKEND_ROOT,
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "/var/lib/epiber-paj/messaging.sqlite");
});

test("aktive systemd-Appvorlagen verwenden PostgreSQL ohne Google-Credentials", () => {
  for (const system of ["live", "devel"]) {
    const unit = fs.readFileSync(path.join(SYSTEMD_ROOT, `epiber-${system}.service`), "utf8");
    assert.match(unit, /PERSISTENCE_MODE=postgres/, system);
    assert.doesNotMatch(unit, /GOOGLE_|google-service-account|MESSAGING_FILE=/, system);
  }
});

test("Messaging-Reporting verlangt bei Aktivierung Deployment und starken Base64url-Token", () => {
  const script = `require("./config.js").validateRuntimeConfig()`;
  const baseEnv = {
    ...process.env,
    PERSISTENCE_MODE: "postgres",
    PGUSER: "epiber_app_login",
    EPIBER_TENANT_CODE: "devel-epiber",
    EPIBER_AUTH_RATE_LIMIT_SECRET: "b".repeat(43),
    COURT_URL: "https://court.invalid/data.json",
    STATE_FILE: ":memory:",
    SCORELOG_FILE: ":memory:",
    AUDITLOG_FILE: ":memory:",
    MESSAGING_FILE: ":memory:",
    MESSAGING_REPORT_ENABLED: "true",
  };
  const invalid = spawnSync(process.execPath, ["-e", script], { cwd: BACKEND_ROOT, encoding: "utf8", env: baseEnv });
  assert.notEqual(invalid.status, 0);
  assert.doesNotMatch(invalid.stderr, /a{43}/);
  const valid = spawnSync(process.execPath, ["-e", script], {
    cwd: BACKEND_ROOT,
    encoding: "utf8",
    env: { ...baseEnv, MESSAGING_REPORT_DEPLOYMENT: "paj", EPIBER_OBSERVABILITY_API_TOKEN: "a".repeat(43) },
  });
  assert.equal(valid.status, 0, valid.stderr);
  const devel = spawnSync(process.execPath, ["-e", script], {
    cwd: BACKEND_ROOT,
    encoding: "utf8",
    env: { ...baseEnv, MESSAGING_REPORT_DEPLOYMENT: "devel", EPIBER_OBSERVABILITY_API_TOKEN: "a".repeat(43) },
  });
  assert.equal(devel.status, 0, devel.stderr);
});

test("PostgreSQL-Modus verlangt keine Legacydateien und validiert seine eigenen Laufzeitgeheimnisse", () => {
  const secretDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-auth-secret-"));
  const secretFile = path.join(secretDirectory, "secret");
  fs.writeFileSync(secretFile, "c".repeat(43), { mode: 0o600 });
  try {
  const config = spawnSync(process.execPath, ["-e", "require('./config.js').validateRuntimeConfig()"], {
    cwd: BACKEND_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      PERSISTENCE_MODE: "postgres",
      PGUSER: "epiber_app_login",
      EPIBER_TENANT_CODE: "devel-epiber",
      EPIBER_AUTH_RATE_LIMIT_SECRET: "b".repeat(43),
      COURT_URL: "https://court.test/scores.json",
    },
  });
  assert.equal(config.status, 0, config.stderr);
  const fileConfig = spawnSync(process.execPath, ["-e", "require('./config.js').validateRuntimeConfig()"], {
    cwd: BACKEND_ROOT, encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", PERSISTENCE_MODE: "postgres", PGUSER: "epiber_app_login", EPIBER_TENANT_CODE: "devel-epiber", EPIBER_AUTH_RATE_LIMIT_SECRET: "", EPIBER_AUTH_RATE_LIMIT_SECRET_FILE: secretFile, COURT_URL: "https://court.test/scores.json" },
  });
  assert.equal(fileConfig.status, 0, fileConfig.stderr);
  const missingSecret = spawnSync(process.execPath, ["-e", "require('./config.js').validateRuntimeConfig()"], {
    cwd: BACKEND_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      PERSISTENCE_MODE: "postgres",
      PGUSER: "epiber_app_login",
      EPIBER_TENANT_CODE: "devel-epiber",
      EPIBER_AUTH_RATE_LIMIT_SECRET: "",
      COURT_URL: "https://court.test/scores.json",
    },
  });
  assert.notEqual(missingSecret.status, 0);
  assert.match(missingSecret.stderr, /EPIBER_AUTH_RATE_LIMIT_SECRET/);
  } finally { fs.rmSync(secretDirectory, { recursive: true, force: true }); }
});

test("entfernter Legacy-Modus wird auch im Read-only-Betrieb ausdruecklich abgelehnt", () => {
  const script = "require('./config.js').validateRuntimeConfig()";
  const legacy = spawnSync(process.execPath, ["-e", script], {
    cwd: BACKEND_ROOT, encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", PERSISTENCE_MODE: "legacy", EPIBER_WRITE_MODE: "read_only", COURT_URL: "https://court.test/scores.json" },
  });
  assert.notEqual(legacy.status, 0);
  assert.match(legacy.stderr, /Nur PERSISTENCE_MODE=postgres wird unterstuetzt/);
});

test("PostgreSQL-Devel-Units trennen App und Worker mit systemd-Credentials", () => {
  const app = fs.readFileSync(path.join(SYSTEMD_ROOT, "epiber-devel.service"), "utf8");
  const worker = fs.readFileSync(path.join(SYSTEMD_ROOT, "epiber-devel-worker.service"), "utf8");
  assert.match(app, /PERSISTENCE_MODE=postgres/);
  assert.match(app, /MESSAGING_REPORT_DEPLOYMENT=devel/);
  assert.match(app, /messaging-api\.env/);
  assert.match(app, /LoadCredential=database:\/etc\/epiber-devel\/credentials\/postgres-app-password/);
  assert.match(app, /LoadCredential=rate-limit-key:\/etc\/epiber-devel\/credentials\/auth-rate-limit-secret/);
  assert.match(app, /EPIBER_DB_PASSWORD_FILE=%d\/database/);
  assert.match(app, /EPIBER_AUTH_RATE_LIMIT_SECRET_FILE=%d\/rate-limit-key/);
  assert.match(app, /Conflicts=epiber-paj\.service/);
  assert.match(worker, /PGUSER=epiber_devel_worker/);
  assert.match(worker, /LoadCredential=database:\/etc\/epiber-devel\/credentials\/postgres-worker-password/);
  assert.match(worker, /EPIBER_DB_PASSWORD_FILE=%d\/database/);
  assert.match(worker, /PUBLIC_ORIGIN=https:\/\/epiber\.at:8081/);
  assert.match(worker, /SyslogIdentifier=epiber-devel-worker/);
  assert.match(worker, /RestrictAddressFamilies=AF_UNIX/);
});

test("nur PostgreSQL-Appvorlagen konfigurieren den internen Reportingvertrag", () => {
  for (const [system, deployment] of [["live", "live"], ["devel", "devel"]]) {
    const unit = fs.readFileSync(path.join(SYSTEMD_ROOT, `epiber-${system}.service`), "utf8");
    assert.match(unit, /EnvironmentFile=-\/etc\/epiber-observability\/messaging-api\.env/);
    assert.equal(unit.includes("MESSAGING_REPORT_ENABLED=true"), false);
    assert.match(unit, new RegExp(`MESSAGING_REPORT_DEPLOYMENT=${deployment}(?: |$)`));
  }
  for (const system of ["piber", "paj", "pk"]) assert.equal(fs.existsSync(path.join(SYSTEMD_ROOT, `epiber-${system}.service`)), false);
  const credentialTemplate = fs.readFileSync(path.join(SYSTEMD_ROOT, "../observability/grafana/messaging-api.env.example"), "utf8");
  assert.match(credentialTemplate, /^MESSAGING_REPORT_ENABLED=true$/m);
  const caddy = fs.readFileSync(path.join(SYSTEMD_ROOT, "../Caddyfile"), "utf8")
    + fs.readFileSync(path.join(SYSTEMD_ROOT, "../caddy/epiber-live-modes/active.caddy"), "utf8");
  assert.equal((caddy.match(/handle \/internal\/\*/g) || []).length, 3);
  assert.equal((caddy.match(/handle \/internal\/\* \{\s*respond 404/g) || []).length, 3);
});
