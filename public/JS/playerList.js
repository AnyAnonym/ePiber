import { functions } from "./SDK.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

function formatTelefon(val) {
  if (!val || String(val).trim() === "") return "---";
  return String(val).trim().replace(/^0043/, "+43");
}

function formatAktiv(val) {
  return String(val).trim() === "1" ? "✅" : "";
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
      tbody.innerHTML = "<tr><td colspan='4'>Keine Spieler gefunden.</td></tr>";
      return;
    }

    const header = data[0].map((h) => h.trim().toLowerCase());
    const idIdx = header.indexOf("id");
    const fnIdx = header.indexOf("vorname");
    const lnIdx = header.indexOf("nachname");
    const telIdx = header.indexOf("telefonmobil");
    const aktIdx = header.indexOf("aktiv");

    data.slice(1).forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row[idIdx] || ""}</td>
        <td>${(row[fnIdx] || "").trim()} ${(row[lnIdx] || "").trim()}</td>
        <td>${formatTelefon(row[telIdx])}</td>
        <td>${formatAktiv(row[aktIdx])}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("❌ Fehler beim Laden der Daten:", err);
  }
}

window.addEventListener("load", main);
