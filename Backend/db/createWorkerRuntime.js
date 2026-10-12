"use strict";

const { WorkerRepository } = require("./repositories/workerRepository");
const { RuntimeDatabase } = require("./runtimeDatabase");

function createWorkerRuntime({ connectionConfig, expectedTenantCode, log = () => {}, poolFactory }) {
  const runtime = new RuntimeDatabase({
    connectionConfig,
    expectedTenantCode,
    requiredDomains: ["ops"],
    maxConnections: 2,
    ...(poolFactory ? { poolFactory } : {}),
    log,
  });
  runtime.registerDomain("ops", ({ database, context }) => new WorkerRepository({ database, context }));
  return runtime;
}

module.exports = { createWorkerRuntime };
