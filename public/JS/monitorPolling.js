import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const getNavigatorTarget = httpsCallable(functions, "getNavigatorTarget");
const frame = document.getElementById("monitor-frame");
const overlay = document.getElementById("monitor-overlay");

let currentTarget = "";

async function poll() {
  try {
    const res = await getNavigatorTarget();
    const { success, path } = res.data;
    console.log("monitorPolling: success=" + success + " path=" + path + " current=" + currentTarget);

    if (success && path && path !== currentTarget) {
      currentTarget = path;
      const suffix = path.includes("?") ? "&monitor=1" : "?monitor=1";
      console.log("monitorPolling: iframe navigiert zu " + path + suffix);
      frame.src = path + suffix;
      overlay.classList.add("hidden");
    } else if (!path) {
      overlay.classList.remove("hidden");
      overlay.textContent = "Warte auf Navigation...";
      frame.src = "";
    }
  } catch (err) {
    console.error("Monitor Polling Fehler:", err);
  }
}

poll();
setInterval(poll, 2000);
