import { getUser, subscribeAuth } from "./authClient.js";
import { favoriteHref, favoriteLabel, favoriteVisibleForUser, reorderFavorites, subscribeFavorites } from "./favorites.js";
import { favoriteIconName, mobileNavIcon } from "./navbar.js";
import "./modals.js";

const list = document.getElementById("favoritesPageList");
const status = document.getElementById("favoritesPageStatus");
const editButton = document.getElementById("favoritesPageEdit");
const announcement = document.getElementById("favoritesPageAnnouncement");
let editing = false;
let latestState = { favorites: [], loading: true, ready: false };
let draggedRow = null;
let pointerId = null;

editButton.innerHTML = mobileNavIcon("edit");

function visibleFavorites() {
  return latestState.favorites.filter((favorite) => favoriteVisibleForUser(favorite));
}

function updateHandleLabels() {
  const rows = [...list.querySelectorAll(".favorites-page-item")];
  rows.forEach((row, index) => {
    const label = row.querySelector(".favorites-page-link span")?.textContent || "Favorit";
    const handle = row.querySelector(".favorites-page-drag-handle");
    handle.tabIndex = editing ? 0 : -1;
    handle.setAttribute("aria-label", `${label}, Position ${index + 1} von ${rows.length}, mit Pfeiltasten verschieben`);
  });
}

function render() {
  const favorites = visibleFavorites();
  list.replaceChildren();
  editButton.hidden = favorites.length < 2;
  editButton.setAttribute("aria-pressed", String(editing));
  editButton.setAttribute("aria-label", editing ? "Bearbeitung der Favoriten beenden" : "Favoritenreihenfolge bearbeiten");
  list.classList.toggle("is-editing", editing);
  if (!getUser()) {
    status.hidden = false;
    status.textContent = "Bitte anmelden, um persönliche Favoriten anzuzeigen.";
    return;
  }
  if (latestState.loading || !latestState.ready) {
    status.hidden = false;
    status.textContent = "Favoriten werden geladen...";
    return;
  }
  if (!favorites.length) {
    status.hidden = false;
    status.textContent = "Noch keine Favoriten vorhanden. Unterstützte Seiten und Aktionen können über den Stern hinzugefügt werden.";
    return;
  }
  status.hidden = true;
  for (const favorite of favorites) {
    const row = document.createElement("div");
    row.className = "favorites-page-item";
    row.dataset.favoriteId = favorite.targetId;
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "favorites-page-drag-handle";
    handle.innerHTML = mobileNavIcon("drag_handle");
    const link = document.createElement("a");
    link.className = "favorites-page-link";
    link.href = favorite.type === "page" ? favoriteHref(favorite) : "#";
    if (favorite.type === "overlay") link.dataset.favoriteOverlay = favorite.overlay;
    const label = favoriteLabel(favorite);
    link.setAttribute("aria-label", label);
    link.title = label;
    link.innerHTML = `${mobileNavIcon(favoriteIconName(favorite), "mobile-nav-icon favorites-page-icon")}<span></span>`;
    link.querySelector("span").textContent = label;
    row.append(handle, link);
    list.appendChild(row);
  }
  updateHandleLabels();
}

async function saveOrder(focusedRow = null) {
  const ids = [...list.querySelectorAll(".favorites-page-item")].map((row) => row.dataset.favoriteId);
  try {
    await reorderFavorites(ids);
    focusedRow?.querySelector(".favorites-page-drag-handle")?.focus();
  } catch (error) {
    window.showToast?.(error.message || "Reihenfolge konnte nicht gespeichert werden.", "error");
    render();
  }
}

editButton.addEventListener("click", () => {
  editing = !editing;
  render();
});

list.addEventListener("click", (event) => {
  const overlay = event.target.closest("[data-favorite-overlay]");
  if (!overlay) return;
  event.preventDefault();
  window.openFavoriteMatchAction?.(overlay.dataset.favoriteOverlay);
});

list.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest(".favorites-page-drag-handle");
  if (!editing || !handle) return;
  event.preventDefault();
  draggedRow = handle.closest(".favorites-page-item");
  pointerId = event.pointerId;
  handle.setPointerCapture?.(pointerId);
  draggedRow.classList.add("is-dragging");
});

list.addEventListener("pointermove", (event) => {
  if (!draggedRow || event.pointerId !== pointerId) return;
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest(".favorites-page-item");
  if (!row || row === draggedRow || row.parentElement !== list) return;
  const bounds = row.getBoundingClientRect();
  list.insertBefore(draggedRow, event.clientY < bounds.top + bounds.height / 2 ? row : row.nextSibling);
});

list.addEventListener("pointerup", async (event) => {
  if (!draggedRow || event.pointerId !== pointerId) return;
  const row = draggedRow;
  draggedRow.classList.remove("is-dragging");
  draggedRow = null;
  pointerId = null;
  updateHandleLabels();
  const position = [...list.children].indexOf(row) + 1;
  announcement.textContent = `${row.querySelector(".favorites-page-link span").textContent} ist jetzt an Position ${position}.`;
  await saveOrder(row);
});

list.addEventListener("pointercancel", () => {
  draggedRow?.classList.remove("is-dragging");
  draggedRow = null;
  pointerId = null;
  render();
});

list.addEventListener("keydown", async (event) => {
  const handle = event.target.closest(".favorites-page-drag-handle");
  if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const row = handle.closest(".favorites-page-item");
  const sibling = event.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  list.insertBefore(row, event.key === "ArrowUp" ? sibling : sibling.nextSibling);
  updateHandleLabels();
  announcement.textContent = `${row.querySelector(".favorites-page-link span").textContent} wurde verschoben.`;
  await saveOrder(row);
});

subscribeAuth(() => render());
subscribeFavorites((snapshot) => {
  latestState = snapshot;
  render();
});
