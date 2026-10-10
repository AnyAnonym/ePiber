"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function run(binary, args, options = {}) {
  return execFileSync(binary, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function startPostgresTestCluster() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epiber-postgres-"));
  const data = path.join(root, "data");
  const socket = path.join(root, "socket");
  const port = 50000 + (process.pid % 10000);
  fs.mkdirSync(socket, { mode: 0o700 });
  run("initdb", ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust", "--username=postgres"]);
  run("pg_ctl", [
    "-D", data,
    "-l", path.join(root, "postgres.log"),
    "-o", `-k ${socket} -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700 -c fsync=off -c synchronous_commit=off`,
    "-w", "start",
  ], { stdio: "ignore" });

  let stopped = false;
  return {
    root,
    connectionConfig: {
      host: socket,
      port,
      database: "postgres",
      user: "postgres",
      application_name: "epiber-postgres-test",
      ssl: false,
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

module.exports = { startPostgresTestCluster };
