import { functions } from "./SDK.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

async function main() {
  try {
    console.log("⏳ Spieler werden geladen...");

    const getPlayers = httpsCallable(functions, "readPlayersList");
    const result = await getPlayers();

    if (!result.data?.values) {
      throw new Error("Backend lieferte keine gültigen Daten!");
    }

    const data = result.data.values;
    console.log("✅ Empfangenes JSON vom Backend:", data);

    const tbody = document.querySelector("#tbl tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const startIndex = data[0][0] === "ID" || data[0][0] === "id" ? 1 : 0;

    for (let i = startIndex; i < data.length; i++) {
      const [id, firstName, lastName] = data[i];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${id || i}</td>
        <td>${firstName || ""} ${lastName || ""}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error("❌ Fehler beim Laden der Daten:", err);
  }
}

window.addEventListener("load", main);
