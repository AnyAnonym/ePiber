import { createEndpoint, subscribeInvalidations } from "./dataClient.js";
import { ready, getUser, subscribeAuth } from "./authClient.js";
import { signalMonitorReady, signalMonitorFailed } from "./monitorReady.js";
import { diagnostic } from "./diagnostics.js";
import { showLoadingOverlay, hideLoadingOverlay } from "./loadingHelper.js";

const readMemberDirectory = createEndpoint("memberDirectory");
let directoryRenderGeneration = 0;

function formatTelefon(value) {
  return String(value || "").trim().replace(/^0043/, "+43") || "---";
}

function formatGeburtsdatum(value) {
  const raw = String(value || "").trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[3]}.${compact[2]}.${compact[1]}`;
  const short = raw.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (short) return `${short[3]}.${short[2]}.${Number(short[1]) >= 50 ? "19" : "20"}${short[1]}`;
  return raw || "---";
}

function getElements() {
  return {
    table: document.getElementById("tbl"),
    tbody: document.querySelector("#tbl tbody"),
    message: document.getElementById("playerDirectoryMessage"),
    filter: document.getElementById("playerDirectoryFilter"),
    filterInput: document.getElementById("playerDirectoryFilterInput"),
  };
}

function normalizeFilterText(value) {
  return String(value || "").toLocaleLowerCase("de");
}

function applyDirectoryFilter() {
  const { tbody, filterInput } = getElements();
  if (!tbody || !filterInput) return;

  tbody.querySelector(".player-filter-empty")?.remove();
  const terms = normalizeFilterText(filterInput.value).trim().split(/\s+/).filter(Boolean);
  const rows = [...tbody.querySelectorAll("tr[data-filter-text]")];
  let visibleRows = 0;

  rows.forEach((row) => {
    const matches = terms.every((term) => row.dataset.filterText.includes(term));
    row.hidden = !matches;
    if (matches) visibleRows += 1;
  });

  if (rows.length > 0 && visibleRows === 0) {
    const row = document.createElement("tr");
    row.className = "player-filter-empty";
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.style.textAlign = "center";
    cell.textContent = "Keine Spieler entsprechen dem Filter.";
    row.appendChild(cell);
    tbody.appendChild(row);
  }
}

function renderAnonymous() {
  const { table, tbody, message, filter, filterInput } = getElements();
  if (!table || !tbody || !message) return;

  table.hidden = true;
  if (filter) filter.hidden = true;
  if (filterInput) filterInput.value = "";
  tbody.replaceChildren();
  message.hidden = false;
  message.replaceChildren();

  const text = document.createElement("p");
  text.textContent = "Bitte melden Sie sich an, um das Spielerverzeichnis zu sehen.";

  const loginButton = document.createElement("button");
  loginButton.type = "button";
  loginButton.className = "btn-login";
  loginButton.textContent = "Anmelden";
  loginButton.addEventListener("click", () => window.openLoginModal?.());

  message.appendChild(text);
  message.appendChild(loginButton);
}

function renderError(error) {
  const { table, tbody, message, filter } = getElements();
  if (!table || !tbody || !message) return;

  table.hidden = true;
  if (filter) filter.hidden = true;
  tbody.replaceChildren();
  message.hidden = false;
  message.textContent = error?.message || "Spielerverzeichnis konnte nicht geladen werden.";
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = String(value || "");
  row.appendChild(cell);
}

async function renderDirectory(user = getUser()) {
  const generation = ++directoryRenderGeneration;

  if (!user) {
    renderAnonymous();
    return;
  }

  const { table, tbody, message, filter } = getElements();
  if (!table || !tbody || !message) {
    const error = new Error("Spielerverzeichnis-Elemente fehlen.");
    error.code = "PLAYER_DIRECTORY_CONTAINER_MISSING";
    throw error;
  }

  let result;
  try {
    result = await readMemberDirectory();
  } catch (error) {
    if (generation !== directoryRenderGeneration) return;
    throw error;
  }
  if (generation !== directoryRenderGeneration) return;

  if (!result.data?.success) {
    if (result.data?.error?.code === "AUTH_REQUIRED") {
      renderAnonymous();
      return;
    }
    const error = new Error(result.data?.error?.message || "Spielerverzeichnis konnte nicht geladen werden.");
    error.code = result.data?.error?.code || "PLAYER_DIRECTORY_LOAD_FAILED";
    throw error;
  }

  const values = result.data.values || [];
  const rowsFragment = document.createDocumentFragment();

  if (values.length < 2) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.style.textAlign = "center";
    cell.textContent = "Keine Spieler gefunden.";
    row.appendChild(cell);
    rowsFragment.appendChild(row);
  } else {
    const header = values[0].map((value) => String(value || "").trim().toLowerCase());
    const firstNameIndex = header.indexOf("vorname");
    const lastNameIndex = header.indexOf("nachname");
    const phoneIndex = header.indexOf("telefonmobil");
    const emailIndex = header.indexOf("e-mail");
    const birthDateIndex = header.indexOf("geburtsdatum");
    const activeIndex = header.indexOf("aktiv");
    const idIndex = header.indexOf("id");

    const rows = values.slice(1)
      .filter((row) => activeIndex < 0 || String(row[activeIndex] || "").trim() === "1")
      .sort((a, b) => {
        const lastNameA = String(a[lastNameIndex] || "").trim().toLocaleLowerCase("de");
        const lastNameB = String(b[lastNameIndex] || "").trim().toLocaleLowerCase("de");
        return lastNameA.localeCompare(lastNameB, "de");
      });

    rows.forEach((valuesRow) => {
      const row = document.createElement("tr");
      const playerId = String(valuesRow[idIndex] || "").trim();
      const lastName = String(valuesRow[lastNameIndex] || "").trim();
      const firstName = String(valuesRow[firstNameIndex] || "").trim();
      const phone = formatTelefon(valuesRow[phoneIndex]);
      const email = String(valuesRow[emailIndex] || "").trim() || "---";
      const birthDate = formatGeburtsdatum(valuesRow[birthDateIndex]);
      row.dataset.filterText = normalizeFilterText([lastName, firstName, phone, email, birthDate].join(" "));
      if (playerId === String(user.id || "")) row.classList.add("current-player");
      appendCell(row, lastName);
      appendCell(row, firstName);
      appendCell(row, phone);
      appendCell(row, email);
      appendCell(row, birthDate);
      if (playerId) {
        const openProfile = () => window.openProfileModal?.({ playerId });
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.setAttribute("aria-label", `Profil von ${firstName} ${lastName} öffnen`);
        row.addEventListener("click", openProfile);
        row.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          openProfile();
        });
      }
      rowsFragment.appendChild(row);
    });
  }

  tbody.replaceChildren(rowsFragment);
  applyDirectoryFilter();
  message.hidden = true;
  message.replaceChildren();
  if (filter) filter.hidden = false;
  table.hidden = false;
}

let directoryInitialized = false;
let observedUserId = null;

subscribeAuth((user) => {
  const nextUserId = String(user?.id || "");
  const authChanged = directoryInitialized && nextUserId !== observedUserId;
  observedUserId = nextUserId;
  if (!authChanged) return;

  if (!user) {
    renderDirectory(null);
    return;
  }

  queueMicrotask(() => {
    if (String(getUser()?.id || "") !== nextUserId) return;
    renderDirectory(getUser()).catch((error) => {
      diagnostic.error("player_directory_refresh_failed", error);
      renderError(error);
    });
  });
});

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("playerDirectoryFilterInput")?.addEventListener("input", applyDirectoryFilter);
  showLoadingOverlay();
  try {
    const user = await ready;
    observedUserId = String(user?.id || "");
    directoryInitialized = true;
    await renderDirectory(user);
    hideLoadingOverlay();
    subscribeInvalidations(["players"], () => renderDirectory(getUser()));
    signalMonitorReady();
  } catch (error) {
    hideLoadingOverlay();
    diagnostic.error("player_directory_initialization_failed", error);
    renderError(error);
    signalMonitorFailed(error.code || "PLAYER_DIRECTORY_LOAD_FAILED");
  }
});
