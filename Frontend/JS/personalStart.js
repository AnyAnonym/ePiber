import { ready } from "./authClient.js";
import { navigateToPersonalStart } from "./startPreference.js";

if (window.location.pathname.endsWith("/")) {
  ready.then(() => navigateToPersonalStart({ replace: true }));
}
