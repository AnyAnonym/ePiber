"use strict";

function createWorkerHandlers(repository) {
  return Object.freeze({
    jobs: Object.freeze({
      "retention.short": Object.freeze({ version: 1, maxAttempts: 5, run: ({ payload }) => repository.retentionShort(payload?.batchSize) }),
      "retention.hourly": Object.freeze({ version: 1, maxAttempts: 5, run: ({ payload }) => repository.retentionHourly(payload?.batchSize) }),
      "retention.daily": Object.freeze({ version: 1, maxAttempts: 5, run: ({ payload }) => repository.retentionDaily(payload?.batchSize) }),
      "hall_time.expire_waitlists": Object.freeze({ version: 1, maxAttempts: 5, run: ({ payload }) => repository.expireHallTimeWaitlists(payload?.batchSize) }),
    }),
    outbox: Object.freeze({
      "websocket.invalidate": Object.freeze({
        version: 1,
        maxAttempts: 5,
        run: ({ payload }) => repository.publishInvalidation(payload),
      }),
    }),
  });
}

module.exports = { createWorkerHandlers };
