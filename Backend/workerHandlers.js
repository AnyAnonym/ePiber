"use strict";

function createWorkerHandlers(repository) {
  return Object.freeze({
    jobs: Object.freeze({}),
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
