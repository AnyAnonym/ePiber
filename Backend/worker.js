"use strict";

const { INSTANCE_ID, LOG_LEVEL, SHUTDOWN_GRACE_MS } = require("./config.js");
const { createWorkerRuntime } = require("./db/createWorkerRuntime.js");
const { createConnectionConfig } = require("./db/connectionConfig.js");
const { createLogger } = require("./logger.js");
const { WorkerService } = require("./workerService.js");
const { createWorkerHandlers } = require("./workerHandlers.js");

async function createWorkerApplication({ env = process.env, log = null } = {}) {
  const logger = log || createLogger({ level: LOG_LEVEL, service: "epiber-worker", instance: INSTANCE_ID });
  const expectedTenantCode = String(env.EPIBER_TENANT_CODE || "").trim();
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(expectedTenantCode)) throw Object.assign(new Error("TENANT_CODE_REQUIRED"), { code: "TENANT_CODE_REQUIRED" });
  const connectionConfig = createConnectionConfig({ ...env, PGAPPNAME: env.PGAPPNAME || `epiber-${INSTANCE_ID}-worker` });
  const runtime = createWorkerRuntime({
    connectionConfig,
    expectedTenantCode,
    log: logger.log,
  });
  const repositories = await runtime.connect();
  const handlers = createWorkerHandlers(repositories.ops);
  const worker = new WorkerService({
    repository: repositories.ops,
    workerId: `${INSTANCE_ID}-${process.pid}`,
    ...handlers,
    subscribe: (wake) => runtime.listen("epiber_worker_wake", wake),
    log: logger.log,
  });
  return {
    runtime,
    worker,
    async start() {
      worker.start();
      logger.log("info", "postgres_worker_started", { tenantCode: expectedTenantCode });
    },
    async stop(reason = "shutdown") {
      const startedAt = Date.now();
      await worker.stop();
      await runtime.close();
      await logger.flush();
      logger.log("info", "postgres_worker_stopped", { reason, durationMs: Date.now() - startedAt });
      await logger.flush();
    },
  };
}

async function main() {
  const application = await createWorkerApplication();
  await application.start();
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS);
    timer.unref?.();
    application.stop(signal).then(() => {
      clearTimeout(timer);
      process.exitCode = 0;
    }).catch((error) => {
      console.error(JSON.stringify({ event: "postgres_worker_shutdown_failed", errorCode: error.code || "WORKER_SHUTDOWN_FAILED" }));
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "postgres_worker_start_failed", errorCode: error.code || "WORKER_START_FAILED" }));
    process.exitCode = 1;
  });
}

module.exports = { createWorkerApplication };
