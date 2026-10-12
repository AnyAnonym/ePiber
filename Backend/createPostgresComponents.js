"use strict";

const dataStore = require("./dataStore.js");
const { createRuntimeRepositories } = require("./db/createRuntimeRepositories");
const { PostgresAuthService } = require("./postgresAuthService");
const { PostgresCompetitionService } = require("./postgresCompetitionService");
const { PostgresProjectionLoader } = require("./postgresProjectionLoader");
const { PostgresProjectionService } = require("./postgresProjectionService");
const { PostgresPreferenceService } = require("./postgresPreferenceService");
const { PostgresFrontendLoggingService } = require("./postgresFrontendLoggingService");
const { PostgresMessagingService } = require("./postgresMessagingService");
const { PostgresAuditAdapter } = require("./postgresAuditAdapter");
const { PostgresMonitorBroker } = require("./postgresMonitorBroker");
const { AUDIT_CONTRACTS, IDEMPOTENCY_CONTRACTS, LEGACY_AUDIT_CONTRACTS, MESSAGE_EVENT_CONTRACTS } = require("./postgresRuntimeContracts");
const { PostgresStateAdapter } = require("./postgresStateAdapter");

const MISSING_SERVER_CAPABILITIES = Object.freeze([
  "court-control-writes",
  "hall-time-writes",
  "match-and-ranking-writes",
  "messaging-reporting",
  "production-worker-handlers",
]);

async function createPostgresComponents({
  connectionConfig,
  expectedTenantCode,
  sourceInstance,
  rateLimitSecret,
  sessionTtlMs,
  sessionRefreshIntervalMs,
  sessionMaxPerUser,
  publish = () => {},
  log = () => {},
}) {
  const runtime = createRuntimeRepositories({
    connectionConfig,
    expectedTenantCode,
    sourceInstance,
    auditContracts: { ...AUDIT_CONTRACTS, ...LEGACY_AUDIT_CONTRACTS },
    idempotencyContracts: IDEMPOTENCY_CONTRACTS,
    messageEventContracts: MESSAGE_EVENT_CONTRACTS,
    log,
  });
  const repositories = await runtime.connect();
  const projectionService = new PostgresProjectionService(repositories);
  const projectionLoader = new PostgresProjectionLoader({ projectionService, dataStore, publish, log });
  const frontendLoggingService = await PostgresFrontendLoggingService.create({ identityRepository: repositories.identity, log });
  const messagingService = new PostgresMessagingService({ messaging: repositories.messaging, ops: repositories.ops, publish, log });
  const monitorBroker = await PostgresMonitorBroker.create({ venue: repositories.venue, ops: repositories.ops, dataStore, log });
  const preferenceService = new PostgresPreferenceService({ identity: repositories.identity, ops: repositories.ops });
  const components = {
    runtime,
    repositories,
    authService: new PostgresAuthService({ repository: repositories.identity, rateLimitSecret, sessionTtlMs, sessionRefreshIntervalMs, sessionMaxPerUser }),
    competitionService: new PostgresCompetitionService(repositories),
    frontendLoggingService,
    messagingService,
    auditLogRepository: new PostgresAuditAdapter({ ops: repositories.ops }),
    monitorBroker,
    projectionLoader,
    startInvalidationListener: () => runtime.listen("epiber_app_invalidate", () => {
      projectionLoader.refresh("invalidation").catch((error) => log("error", "postgres_invalidation_refresh_failed", { errorCode: error.code || "POSTGRES_INVALIDATION_REFRESH_FAILED" }));
    }),
    stateAdapter: new PostgresStateAdapter({ identity: repositories.identity, venue: repositories.venue, ops: repositories.ops, preferences: preferenceService }),
    capabilities: Object.freeze({ serverReady: false, missing: MISSING_SERVER_CAPABILITIES }),
  };
  return Object.freeze(components);
}

module.exports = { MISSING_SERVER_CAPABILITIES, createPostgresComponents };
