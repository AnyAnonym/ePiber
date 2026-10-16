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
const { PostgresCourtService, PostgresScoreService } = require("./postgresCourtService");
const { PostgresHallTimeService } = require("./postgresHallTimeService");
const { PostgresPlayService } = require("./postgresPlayService");
const { AUDIT_CONTRACTS, IDEMPOTENCY_CONTRACTS, LEGACY_AUDIT_CONTRACTS, MESSAGE_EVENT_CONTRACTS } = require("./postgresRuntimeContracts");
const { PostgresStateAdapter } = require("./postgresStateAdapter");

const MISSING_SERVER_CAPABILITIES = Object.freeze([]);

async function createPostgresComponents({
  connectionConfig,
  expectedTenantCode,
  sourceInstance,
  rateLimitSecret,
  sessionTtlMs,
  sessionRefreshIntervalMs,
  sessionMaxPerUser,
  appVersion,
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
  let repositories;
  try {
    repositories = await runtime.connect();
    const projectionService = new PostgresProjectionService(repositories);
    const projectionLoader = new PostgresProjectionLoader({ projectionService, dataStore, publish, log });
    const frontendLoggingService = await PostgresFrontendLoggingService.create({ identityRepository: repositories.identity, log, appVersion });
    const messagingService = new PostgresMessagingService({ messaging: repositories.messaging, ops: repositories.ops, publish, log });
    const monitorBroker = await PostgresMonitorBroker.create({ venue: repositories.venue, ops: repositories.ops, dataStore, log });
    const preferenceService = new PostgresPreferenceService({ identity: repositories.identity, ops: repositories.ops });
    const courtService = new PostgresCourtService({ venue: repositories.venue, ops: repositories.ops, publish, log });
    await courtService.refresh("startup");
    const hallTimeService = new PostgresHallTimeService({ venue: repositories.venue, ops: repositories.ops, messagingService, publish, log });
    await hallTimeService.grids();
    const playService = new PostgresPlayService({
      play: repositories.play, identity: repositories.identity, messaging: repositories.messaging,
      ops: repositories.ops, projectionLoader, log,
    });
    const components = {
      runtime,
      repositories,
      authService: new PostgresAuthService({ repository: repositories.identity, rateLimitSecret, sessionTtlMs, sessionRefreshIntervalMs, sessionMaxPerUser }),
      competitionService: new PostgresCompetitionService(repositories),
      frontendLoggingService,
      messagingService,
      auditLogRepository: new PostgresAuditAdapter({ ops: repositories.ops }),
      monitorBroker,
      courtService,
      scoreLogRepository: new PostgresScoreService(repositories.venue),
      hallTimeService,
      sheetService: playService,
      projectionLoader,
      dataPoller: {
        initialLoad: () => projectionLoader.refresh("startup"),
        start() {},
        stop: () => Promise.resolve(),
        getStatus: () => ({ ...projectionLoader.getStatus(), backend: "postgres", polling: false }),
      },
      startInvalidationListener: () => runtime.listen("epiber_app_invalidate", (rawPayload) => {
        let projection = null;
        try { projection = JSON.parse(rawPayload || "{}").projection || null; } catch {}
        Promise.all([
          projectionLoader.refresh("invalidation"),
          ...(projection === "venue" ? [courtService.refresh("invalidation"), monitorBroker.refresh()] : []),
          ...(projection === "identity" ? [frontendLoggingService.refresh()] : []),
        ]).catch((error) => log("error", "postgres_invalidation_refresh_failed", { projection, errorCode: error.code || "POSTGRES_INVALIDATION_REFRESH_FAILED" }));
      }),
      stateAdapter: new PostgresStateAdapter({ identity: repositories.identity, venue: repositories.venue, ops: repositories.ops, preferences: preferenceService }),
      capabilities: Object.freeze({ serverReady: MISSING_SERVER_CAPABILITIES.length === 0, missing: MISSING_SERVER_CAPABILITIES }),
    };
    return Object.freeze(components);
  } catch (error) {
    await runtime.close().catch(() => {});
    throw error;
  }
}

module.exports = { MISSING_SERVER_CAPABILITIES, createPostgresComponents };
