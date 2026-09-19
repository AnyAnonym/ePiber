import { ready } from "./authClient.js";
import { navigateToPersonalStart } from "./startPreference.js";

const pathname = window.location.pathname;
const explicitDashboard = new URLSearchParams(window.location.search).get("dashboard") === "1";
const personalEntry = pathname.endsWith("/")
  || (pathname.endsWith("/index.html") && !explicitDashboard);

if (personalEntry) {
  ready.then(() => navigateToPersonalStart({ replace: true }));
}
