/* Push only: intentionally no fetch handler, offline cache or application data. */
"use strict";
self.addEventListener("push", (event) => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  if (payload?.version !== 1 || payload.type !== "push-pilot"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.testId)) return;
  event.waitUntil(self.registration.showNotification("ePiber – Push-Test", {
    body: "Deine angeforderte Testbenachrichtigung ist angekommen. Bitte bestätige den Empfang in ePiber.",
    icon: "/Images/pwa/icon-192.png",
    tag: `epiber-push-test-${payload.testId}`,
    data: { testId: payload.testId },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Fixed same-origin destination; provider payloads cannot navigate elsewhere.
  event.waitUntil(self.clients.openWindow(new URL("/push.html", self.location.origin).href));
});
