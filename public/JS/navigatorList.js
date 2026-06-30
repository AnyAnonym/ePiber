import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const readNavigator = httpsCallable(functions, "readNavigator");
const setNavigatorTarget = httpsCallable(functions, "setNavigatorTarget");
const getNavigatorTarget = httpsCallable(functions, "getNavigatorTarget");

let currentActiveBtn = null;
let pendingBtn = null;
let statusPollId = null;

async function loadNavigator() {
  const container = document.getElementById("navigator-container");
  if (!container) return;

  try {
    const res = await readNavigator();
    const { success, values, error } = res.data;
    if (!success) {
      container.innerHTML = "<p>Fehler: " + (error || "Unbekannter Fehler") + "</p>";
      return;
    }
    if (!Array.isArray(values) || values.length <= 1) {
      container.innerHTML = "<p>Keine Navigationseinträge gefunden.</p>";
      return;
    }

    const header = values[0].map((h) => String(h).trim().toLowerCase());
    const nameIdx = header.indexOf("name");
    const zielIdx = header.indexOf("ziel");
    if (nameIdx === -1) {
      container.innerHTML = "<p>Spalte Name fehlt.</p>";
      return;
    }

    const rows = values.slice(1)
      .map((row) => ({
        name: String(row[nameIdx] || "").trim(),
        ziel: zielIdx >= 0 ? String(row[zielIdx] || "").trim() : "",
      }))
      .filter((r) => r.name);

    container.innerHTML = "";
    if (rows.length === 0) {
      container.innerHTML = "<p>Keine Navigationseinträge gefunden.</p>";
      return;
    }

    const gap = 12;
    const cols = 4;
    const availableWidth = document.documentElement.clientWidth - gap * 2;
    const btnWidth = Math.floor((availableWidth - gap * (cols - 1)) / cols);
    const btnHeight = Math.floor(btnWidth * 0.5);

    container.style.width = "100%";
    container.style.padding = gap + "px";
    container.style.gap = gap + "px";

    rows.forEach(({ name, ziel }) => {
      const btn = document.createElement("button");
      btn.className = "nav-btn";
      btn.textContent = name;
      btn.style.width = btnWidth + "px";
      btn.style.height = btnHeight + "px";
      if (ziel) {
        btn.addEventListener("click", async () => {
          document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active", "blink-yellow"));
          btn.classList.add("blink-yellow");
          pendingBtn = btn;
          try {
            await setNavigatorTarget({path: ziel});
          } catch (err) {
            console.error("setNavigatorTarget Fehler:", err);
          }
          if (!statusPollId) {
            statusPollId = setInterval(pollStatus, 150);
          }
        });
      }
      container.appendChild(btn);
    });
  } catch (err) {
    console.error("Navigator Fehler:", err);
    container.innerHTML = "<p>Fehler beim Laden der Navigation.</p>";
  }
}

async function pollStatus() {
  try {
    const res = await getNavigatorTarget();
    const { success, status } = res.data;
    if (!success || status !== "loaded") return;
    if (pendingBtn) {
      pendingBtn.classList.remove("blink-yellow");
      pendingBtn.classList.add("active");
      if (currentActiveBtn && currentActiveBtn !== pendingBtn) {
        currentActiveBtn.classList.remove("active");
      }
      currentActiveBtn = pendingBtn;
      pendingBtn = null;
    }
    if (statusPollId) {
      clearInterval(statusPollId);
      statusPollId = null;
    }
  } catch (err) {
    // silent
  }
}

document.addEventListener("DOMContentLoaded", loadNavigator);
