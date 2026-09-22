import { ready } from "./authClient.js";
import { navigateToPersonalStart } from "./startPreference.js";

const pathname = window.location.pathname;
const explicitDashboard = new URLSearchParams(window.location.search).get("dashboard") === "1";
const personalEntry = pathname.endsWith("/")
  || (pathname.endsWith("/index.html") && !explicitDashboard);

function showDashboard() {
  document.body.classList.remove("personal-start-pending");
  document.getElementById("personalStartLoading")?.remove();
}

if (personalEntry) {
  ready
    .then(() => navigateToPersonalStart({ replace: true }))
    .then((navigating) => { if (!navigating) showDashboard(); })
    .catch(showDashboard);
} else showDashboard();
