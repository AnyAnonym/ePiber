"use strict";

const { CoreRepository } = require("./repositories/coreRepository");
const { IdentityRepository } = require("./repositories/identityRepository");
const { PostgresMessagingRepository } = require("./repositories/messagingRepository");
const { OpsRepository } = require("./repositories/opsRepository");
const { PlayRepository } = require("./repositories/playRepository");
const { VenueRepository } = require("./repositories/venueRepository");
const { RuntimeDatabase } = require("./runtimeDatabase");

function createRuntimeRepositories({
  connectionConfig,
  expectedTenantCode,
  sourceInstance = "devel",
  auditContracts = {},
  idempotencyContracts = {},
  messageEventContracts = {},
  log = () => {},
  poolFactory,
}) {
  const runtime = new RuntimeDatabase({
    connectionConfig,
    expectedTenantCode,
    ...(poolFactory ? { poolFactory } : {}),
    log,
  });
  runtime.registerDomain("core", ({ database, context }) => new CoreRepository({ database, context }));
  runtime.registerDomain("identity", ({ database, context }) => new IdentityRepository({ database, context }));
  runtime.registerDomain("play", ({ database, context }) => new PlayRepository({ database, context }));
  runtime.registerDomain("venue", ({ database, context }) => new VenueRepository({ database, context, sourceInstance }));
  runtime.registerDomain("messaging", ({ database, context }) => new PostgresMessagingRepository({
    database,
    context,
    eventContracts: messageEventContracts,
    log,
  }));
  runtime.registerDomain("ops", ({ database, context }) => new OpsRepository({ database, context, sourceInstance, auditContracts, idempotencyContracts, log }));
  return runtime;
}

module.exports = { createRuntimeRepositories };
