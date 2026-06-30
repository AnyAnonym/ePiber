import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const getNavigatorTarget = httpsCallable(functions, "getNavigatorTarget");
const setNavigatorTarget = httpsCallable(functions, "setNavigatorTarget");
const frame = document.getElementById("monitor-frame");
const overlay = document.getElementById("monitor-overlay");

let currentTarget = "";
let pendingTarget = "";

frame.addEventListener("load", async () => {
  if (pendingTarget) {
    try {
      await setNavigatorTarget({path: pendingTarget, status: "loaded"});
    } catch (err) {
      console.error("confirm loaded Fehler:", err);
    }
    pendingTarget = "";
  }
});

async function poll() {
  try {
    const res = await getNavigatorTarget();
    const { success, path } = res.data;

    if (success && path && path !== currentTarget) {
      currentTarget = path;
      pendingTarget = path;
      const suffix = path.includes("?") ? "&monitor=1" : "?monitor=1";
      frame.src = path + suffix;
      overlay.classList.add("hidden");
    } else if (!path) {
      overlay.classList.remove("hidden");
      overlay.textContent = "Warte auf Navigation...";
      frame.src = "";
      pendingTarget = "";
    }
  } catch (err) {
    console.error("Monitor Polling Fehler:", err);
  }
}

poll();
setInterval(poll, 2000);
