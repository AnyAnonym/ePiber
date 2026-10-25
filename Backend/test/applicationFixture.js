// Explicit in-memory HTTP/WS fixture. Production composition is PostgreSQL-only.
const { createApplication } = require("../server.js");
const { AuthService } = require("../authService.js");
const { StateRepository } = require("../stateRepository.js");
const { ScoreLogRepository } = require("../scoreLogRepository.js");
const { AuditLogRepository } = require("../auditLogRepository.js");
const { MessagingRepository } = require("../messagingRepository.js");
const { MessagingService } = require("../messagingService.js");
const { HallTimeService } = require("../hallTimeService.js");
const { FrontendLoggingService } = require("../frontendLoggingService.js");
const { MonitorBroker } = require("../monitorBroker.js");
const { CourtAutomation } = require("../courtAutomation.js");
const { EmailMessagingAdapter } = require("../emailMessagingAdapter.js");
const { WhatsappMessagingAdapter } = require("../whatsappMessagingAdapter.js");
const dataStore = require("../dataStore.js");
const dataProvider = require("../dataProvider.js");
const stateStore = require("../stateStore.js");
const courtPoller = require("../courtPoller.js");
const logger = require("../logger.js");
const { version: appVersion } = require("../package.json");

function createApplicationFixture(overrides = {}) {
  const repository = overrides.repository || new StateRepository(":memory:");
  repository.init();
  stateStore.init(repository);
  const scoreLogRepository = new ScoreLogRepository(":memory:", { instanceId: "test" });
  const auditLogRepository = new AuditLogRepository(":memory:", { instanceId: "test", journal: true });
  const messagingRepository = new MessagingRepository(":memory:", { log: logger.log });
  const messagingService = new MessagingService({
    repository: messagingRepository, emailAdapter: new EmailMessagingAdapter(), whatsappAdapter: new WhatsappMessagingAdapter(),
    publish: dataProvider.publish,
  });
  const playService = overrides.playService;
  const authService = new AuthService({ repository, identityWriter: playService });
  return createApplication({
    repository, scoreLogRepository, auditLogRepository, messagingRepository, messagingService, playService,
    competitionService: playService,
    hallTimeService: new HallTimeService({ repository, messagingService, publish: dataProvider.publish, log: logger.log }),
    authService,
    frontendLoggingService: new FrontendLoggingService({ repository, authService, log: logger.log, appVersion }),
    monitorBroker: new MonitorBroker({ repository, stateStore, dataStore }),
    courtAutomation: new CourtAutomation({ stateStore, dataStore, courtPoller, auditLogRepository }),
    projectionLoader: {
      initialLoad: async () => ({ success: true }),
      getStatus: () => ({ lastSuccessfulRefreshAt: null, dataAgeMs: null, inProgress: null, lastControlledFailure: null }),
      stop: async () => {},
    },
    ...overrides,
  });
}

module.exports = { createApplicationFixture };
