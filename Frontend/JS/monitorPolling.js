import { createEndpoint } from "./dataClient.js";

const getNavigatorTarget = createEndpoint("getNavigatorTarget");
const setNavigatorTarget = createEndpoint("setNavigatorTarget");
const getNavigatorScroll = createEndpoint("getNavigatorScroll");
const setNavigatorScroll = createEndpoint("setNavigatorScroll");
const frame = document.getElementById("monitor-frame");
const overlay = document.getElementById("monitor-overlay");

let currentTarget = "";
let pendingTarget = "";
let lastScrollTs = 0;

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

async function pollScroll() {
  try {
    const res = await getNavigatorScroll();
    const { success, amount, ts } = res.data;
    if (!success || !amount || ts <= lastScrollTs) return;
    lastScrollTs = ts;
    if (frame.contentWindow) {
      frame.contentWindow.scrollBy(0, amount);
    }
    await setNavigatorScroll({ amount: 0 });
  } catch (err) {
    // silent
  }
}

async function poll() {
  try {
    const res = await getNavigatorTarget();
    const { success, path } = res.data;

    if (success && path && path !== currentTarget) {
      // OL-Pfade ignorieren (Overlays, keine HTML-Seiten)
      if (/^OL-/i.test(path)) return;
      currentTarget = path;
      pendingTarget = path;
      const cacheBust = "&_t=" + Date.now();
      const suffix = path.includes("?") ? "&monitor=1" + cacheBust : "?monitor=1" + cacheBust;
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
setInterval(pollScroll, 150);
