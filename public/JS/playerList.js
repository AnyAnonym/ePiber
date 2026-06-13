import { functions } from "./SDK.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

function formatTelefon(val) {
  if (!val || String(val).trim() === "") return "---";
  return String(val).trim().replace(/^0043/, "+43");
}

async function main() {
  try {
    console.log("⏳ Spieler werden geladen...");

    const getPlayers = httpsCallable(functions, "readPlayersList");
    const result = await getPlayers();

    const data = result.data?.values;
    if (!data) throw new Error("Backend lieferte keine gültigen Daten!");

    console.log("✅ Empfangene Spieler-Rohdaten:", data);

    const tbody = document.querySelector("#tbl tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (data.length < 2) {
      tbody.innerHTML = "<tr><td colspan='3' style='text-align:center;'>Keine Spieler gefunden.</td></tr>";
      return;
    }

    const header = data[0].map((h) => h.trim().toLowerCase());
    const fnIdx = header.indexOf("vorname");
    const lnIdx = header.indexOf("nachname");
    const telIdx = header.indexOf("telefonmobil");
    const aktIdx = header.indexOf("aktiv");

    const rows = data.slice(1).filter((row) => {
      return String(row[aktIdx] || "").trim() === "1";
    });

    rows.sort((a, b) => {
      const lnA = (a[lnIdx] || "").trim().toLowerCase();
      const lnB = (b[lnIdx] || "").trim().toLowerCase();
      return lnA.localeCompare(lnB);
    });

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${(row[lnIdx] || "").trim()}</td>
        <td>${(row[fnIdx] || "").trim()}</td>
        <td>${formatTelefon(row[telIdx])}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("❌ Fehler beim Laden der Daten:", err);
  }
}

window.addEventListener("load", main);
