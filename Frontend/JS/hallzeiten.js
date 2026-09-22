import { getUser, ready, subscribeAuth } from "./authClient.js";
import { createEndpoint, getOperationId, releaseOperationId, subscribe } from "./dataClient.js";
import { diagnostic } from "./diagnostics.js";
import { refreshFavoriteButtons } from "./favorites.js";

const readGrid = createEndpoint("hallTimeGrid");
const readHistory = createEndpoint("hallTimeHistory");
const writeBooking = createEndpoint("setHallTimeBooking");
const gridId = String(new URLSearchParams(location.search).get("id") || "").trim();
let grid = null;
let busy = false;
let authorized = false;
let generation = 0;
let tableInitiallyPositioned = false;
let tableSizeFrame = 0;
let routedTouchScroll = null;
let viewMode = "all";
let selectedSlotId = null;
let selectedPersonId = null;

const byId = (id) => document.getElementById(id);
const errorText = (error) => String(error?.message || "Der Vorgang ist fehlgeschlagen.").replace(/\s*\((?:Referenz|Support-ID):[^)]*\)\s*$/iu, "");

function dateLabel(slot) {
  const date = new Date(`${slot.date}T12:00:00`);
  return {
    short: new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" }).format(date),
    full: `${new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(date)}, ${slot.start}–${slot.end}`,
  };
}

function entry(slotId, personId) {
  return grid.entries.find((value) => value.slotId === slotId && value.personId === personId) || null;
}

function comparePeople(left, right) {
  return String(left.lastName || left.name || "").localeCompare(String(right.lastName || right.name || ""), "de")
    || String(left.firstName || "").localeCompare(String(right.firstName || ""), "de")
    || String(left.id || "").localeCompare(String(right.id || ""), "de");
}

function appendPersonName(cell, person) {
  cell.setAttribute("aria-label", person.name);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hall-time-player-select";
  button.setAttribute("aria-label", `${person.name} auswählen`);
  const wrapper = document.createElement("span");
  wrapper.className = "hall-time-person-name";
  for (const value of [person.lastName || person.name, person.firstName || ""]) {
    const line = document.createElement("span");
    line.textContent = value;
    wrapper.appendChild(line);
  }
  button.appendChild(wrapper);
  cell.appendChild(button);
}

function fitPersonNames() {
  for (const wrapper of document.querySelectorAll(".hall-time-person-name")) {
    const style = getComputedStyle(wrapper.parentElement);
    const available = wrapper.parentElement.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    for (const line of wrapper.children) {
      const natural = line.scrollWidth;
      line.style.setProperty("--hall-time-name-scale", String(natural > 0 ? Math.min(1, available / natural) : 1));
    }
  }
}

function slotPast(slot) {
  return new Date(`${slot.date}T${slot.end}:00`).getTime() <= Date.now();
}

function upcomingSlot() {
  return grid?.slots.find((slot) => !slotPast(slot)) || grid?.slots[0] || null;
}

function updateViewControls() {
  byId("hall-time-view-all").setAttribute("aria-pressed", String(viewMode === "all"));
  byId("hall-time-view-current").setAttribute("aria-pressed", String(viewMode === "selected" && selectedSlotId === upcomingSlot()?.id));
}

function scrollSelectedSlotToStart() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const scroll = document.querySelector(".hall-time-table-scroll");
    const playerHead = byId("hall-time-head")?.querySelector(".hall-time-player");
    const selected = [...(byId("hall-time-head")?.querySelectorAll("[data-slot-id]") || [])]
      .find((cell) => cell.dataset.slotId === selectedSlotId);
    if (!scroll || !playerHead || !selected) return;
    scroll.scrollLeft += selected.getBoundingClientRect().left - playerHead.getBoundingClientRect().right;
  }));
}

function centerCurrentPlayer() {
  const align = () => {
    const scroll = document.querySelector(".hall-time-table-scroll");
    const row = [...(byId("hall-time-body")?.querySelectorAll("[data-person-id]") || [])]
      .find((candidate) => candidate.dataset.personId === grid?.currentPersonId);
    if (!scroll || !row) return;
    const scrollRect = scroll.getBoundingClientRect();
    const head = byId("hall-time-head")?.querySelector("th")?.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const bodyTop = head?.bottom || scrollRect.top;
    const desiredCenter = bodyTop + Math.max(0, scrollRect.bottom - bodyTop) / 2;
    scroll.scrollTop = Math.max(0, scroll.scrollTop + rowRect.top + rowRect.height / 2 - desiredCenter);
  };
  align();
  requestAnimationFrame(() => requestAnimationFrame(align));
  setTimeout(align, 100);
}

function selectView(mode, slotId = upcomingSlot()?.id || null) {
  viewMode = mode;
  selectedPersonId = null;
  selectedSlotId = slotId;
  render();
  scrollSelectedSlotToStart();
  if (mode === "all") centerCurrentPlayer();
}

function selectPerson(personId) {
  const occupied = grid.slots.filter((slot) => Boolean(entry(slot.id, personId)));
  viewMode = "person";
  selectedPersonId = personId;
  selectedSlotId = occupied[0]?.id || null;
  render();
  scrollSelectedSlotToStart();
}

function setFeedback(text = "", state = "") {
  const feedback = byId("hall-time-feedback");
  feedback.textContent = state === "error" ? "" : text;
  feedback.dataset.state = state;
  if (state === "error" && text) showMessage(text);
}

function openDialog(dialog) {
  dialog.style.setProperty("--hall-time-dialog-offset-x", `${window.visualViewport?.offsetLeft || 0}px`);
  dialog.style.setProperty("--hall-time-dialog-offset-y", `${window.visualViewport?.offsetTop || 0}px`);
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function openGridInfo() { openDialog(byId("hall-time-info-dialog")); }

function showMessage(text) {
  byId("hall-time-message-text").textContent = text;
  openDialog(byId("hall-time-message-dialog"));
}

function sizeTableToViewport() {
  cancelAnimationFrame(tableSizeFrame);
  tableSizeFrame = requestAnimationFrame(() => {
    const card = document.querySelector(".hall-time-table-card");
    const scroll = card?.querySelector(".hall-time-table-scroll");
    const legend = card?.querySelector(".hall-time-legend");
    if (!card || !scroll || !legend) return;
    const cardStyle = getComputedStyle(card);
    const legendStyle = getComputedStyle(legend);
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const measuredDocumentTop = card.getBoundingClientRect().top + window.scrollY;
    const documentTop = Number(card.dataset.documentTop || measuredDocumentTop);
    card.dataset.documentTop = String(documentTop);
    const reserved = parseFloat(cardStyle.paddingTop) + parseFloat(cardStyle.paddingBottom)
      + parseFloat(cardStyle.borderTopWidth) + parseFloat(cardStyle.borderBottomWidth)
      + legend.offsetHeight + parseFloat(legendStyle.marginTop);
    const height = Math.max(0, Math.floor(viewportHeight - documentTop - reserved - 6));
    scroll.style.height = "";
    scroll.style.maxHeight = `${height}px`;
  });
}

function isBookingDataTarget(target) {
  return target instanceof Element && Boolean(target.closest("#hall-time-body td:not(.hall-time-sum)"));
}

function installTableScrollRouting() {
  const scroll = document.querySelector(".hall-time-table-scroll");
  if (!scroll || scroll.dataset.scrollRouting === "true") return;
  scroll.dataset.scrollRouting = "true";
  scroll.addEventListener("wheel", (event) => {
    if (!event.deltaY || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || isBookingDataTarget(event.target)) return;
    event.preventDefault();
    window.scrollBy(0, event.deltaY);
  }, { passive: false });
  scroll.addEventListener("touchstart", (event) => {
    if (isBookingDataTarget(event.target)) return;
    routedTouchScroll = scroll;
    scroll.style.overflowY = "hidden";
  }, { passive: true });
  const restoreTouchScroll = () => {
    if (!routedTouchScroll) return;
    routedTouchScroll.style.overflowY = "auto";
    routedTouchScroll = null;
  };
  scroll.addEventListener("touchend", restoreTouchScroll, { passive: true });
  scroll.addEventListener("touchcancel", restoreTouchScroll, { passive: true });
  window.addEventListener("touchend", restoreTouchScroll, { passive: true });
  window.addEventListener("touchcancel", restoreTouchScroll, { passive: true });
}

function positionTableForCurrentPlayer() {
  if (tableInitiallyPositioned) return;
  tableInitiallyPositioned = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const scroll = byId("hall-time-table")?.closest(".hall-time-table-scroll");
    const playerHead = byId("hall-time-head")?.querySelector(".hall-time-player");
    const firstUpcoming = byId("hall-time-head")?.querySelector("[data-upcoming-slot]");
    const ownRow = [...(byId("hall-time-body")?.querySelectorAll("[data-person-id]") || [])]
      .find((row) => row.dataset.personId === grid.currentPersonId);
    if (!scroll || !playerHead) return;
    if (firstUpcoming && scroll.scrollWidth > scroll.clientWidth) {
      const horizontalOffset = firstUpcoming.getBoundingClientRect().left - playerHead.getBoundingClientRect().right;
      scroll.scrollLeft = Math.max(0, scroll.scrollLeft + horizontalOffset);
    }
    if (ownRow && scroll.scrollHeight > scroll.clientHeight) {
      const scrollRect = scroll.getBoundingClientRect();
      const headerRect = byId("hall-time-head")?.querySelector("th")?.getBoundingClientRect();
      const ownRect = ownRow.getBoundingClientRect();
      const bodyTop = headerRect?.bottom || scrollRect.top;
      const desiredCenter = bodyTop + Math.max(0, scrollRect.bottom - bodyTop) / 2;
      const ownCenter = ownRect.top + ownRect.height / 2;
      scroll.scrollTop = Math.max(0, scroll.scrollTop + ownCenter - desiredCenter);
      requestAnimationFrame(() => {
        if (!ownRow.isConnected || !scroll.isConnected) return;
        const adjustedScrollRect = scroll.getBoundingClientRect();
        const adjustedHeaderRect = byId("hall-time-head")?.querySelector("th")?.getBoundingClientRect();
        const adjustedOwnRect = ownRow.getBoundingClientRect();
        const adjustedBodyTop = adjustedHeaderRect?.bottom || adjustedScrollRect.top;
        const adjustedDesiredCenter = adjustedBodyTop + Math.max(0, adjustedScrollRect.bottom - adjustedBodyTop) / 2;
        const remainingOffset = adjustedOwnRect.top + adjustedOwnRect.height / 2 - adjustedDesiredCenter;
        if (Math.abs(remainingOffset) > 1) scroll.scrollTop = Math.max(0, scroll.scrollTop + remainingOffset);
        scroll.dataset.initialPositioned = "true";
      });
    } else {
      scroll.dataset.initialPositioned = "true";
    }
  }));
}

function statusButton(slot, person) {
  const value = entry(slot.id, person.id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `hall-time-state is-${value?.status || "empty"}`;
  button.textContent = value?.status === "confirmed" ? "✓" : value?.status === "waitlist" ? `⌛ ${value.waitlistPosition}` : "×";
  const editable = !slotPast(slot) || grid.canAdminister;
  button.disabled = busy || !editable;
  button.title = value?.status === "confirmed" ? "Fixplatz – abmelden" : value?.status === "waitlist" ? `Wartelistenplatz ${value.waitlistPosition} – abmelden` : editable ? "Für diesen Termin anmelden" : "Nicht eingetragen";
  button.setAttribute("aria-label", `${person.name}, ${dateLabel(slot).full}: ${button.title}`);
  if (editable) button.addEventListener("click", () => toggle(slot, person, !value));
  return button;
}

function render() {
  const scroll = byId("hall-time-table")?.closest(".hall-time-table-scroll");
  const previousScroll = tableInitiallyPositioned && scroll ? { left: scroll.scrollLeft, top: scroll.scrollTop } : null;
  document.title = `ASKÖ Piberbach – ${grid.name}`;
  byId("hall-time-title").textContent = grid.name;
  byId("hall-time-description").textContent = grid.description;
  byId("hall-time-info-open").hidden = !grid.description;
  document.querySelector(".hall-time-legend .is-waitlist").hidden = !grid.waitlistEnabled;

  const head = byId("hall-time-head");
  head.replaceChildren();
  const playerHead = document.createElement("th"); playerHead.scope = "col"; playerHead.className = "hall-time-player"; playerHead.setAttribute("aria-label", "Spieler"); head.appendChild(playerHead);
  const firstUpcomingSlot = upcomingSlot();
  if (!selectedSlotId || !grid.slots.some(({ id }) => id === selectedSlotId)) selectedSlotId = firstUpcomingSlot?.id || null;
  for (const slot of grid.slots) {
    const th = document.createElement("th"); th.scope = "col"; th.title = dateLabel(slot).full;
    const past = slotPast(slot);
    th.classList.toggle("is-past-slot", past);
    th.dataset.slotId = slot.id;
    th.hidden = viewMode === "person" && !entry(slot.id, selectedPersonId);
    if (slot.id === firstUpcomingSlot?.id) th.dataset.upcomingSlot = "true";
    th.classList.toggle("is-selected-slot", slot.id === selectedSlotId);
    const [weekday, date] = dateLabel(slot).short.split(", ");
    const select = document.createElement("button"); select.type = "button"; select.className = "hall-time-slot-select"; select.setAttribute("aria-label", `${dateLabel(slot).full} auswählen`);
    select.innerHTML = `<span>${weekday || ""}</span><strong>${date || dateLabel(slot).short}</strong><small class="hall-time-start">${slot.start}</small><small class="hall-time-separator">–</small><small class="hall-time-end">${slot.end}</small>`;
    select.addEventListener("click", () => selectView("selected", slot.id)); th.appendChild(select);
    head.appendChild(th);
  }
  const sumHead = document.createElement("th"); sumHead.scope = "col"; sumHead.textContent = "Σ"; sumHead.title = "Fixplätze (Warteliste)"; sumHead.className = "hall-time-sum"; head.appendChild(sumHead);

  const body = byId("hall-time-body"); body.replaceChildren();
  for (const person of [...grid.participants].sort(comparePeople)) {
    const row = document.createElement("tr");
    row.dataset.personId = person.id;
    if (person.id === grid.currentPersonId && viewMode !== "person") row.classList.add("is-current-player");
    if (person.id === grid.currentPersonId && viewMode === "all") row.classList.add("is-current-player-row");
    row.classList.toggle("is-selected-player", person.id === selectedPersonId);
    row.hidden = viewMode === "selected" && !entry(selectedSlotId, person.id);
    const name = document.createElement("th"); name.scope = "row"; name.className = "hall-time-player"; appendPersonName(name, person); name.querySelector("button").addEventListener("click", () => selectPerson(person.id)); row.appendChild(name);
    for (const slot of grid.slots) { const cell = document.createElement("td"); cell.hidden = viewMode === "person" && !entry(slot.id, selectedPersonId); cell.classList.toggle("is-past-slot", slotPast(slot)); cell.classList.toggle("is-selected-slot", slot.id === selectedSlotId); cell.appendChild(statusButton(slot, person)); row.appendChild(cell); }
    const visibleSlotIds = new Set(grid.slots.filter((slot) => viewMode !== "person" || entry(slot.id, selectedPersonId)).map(({ id }) => id));
    const confirmed = grid.entries.filter((value) => visibleSlotIds.has(value.slotId) && value.personId === person.id && value.status === "confirmed").length;
    const waiting = grid.entries.filter((value) => visibleSlotIds.has(value.slotId) && value.personId === person.id && value.status === "waitlist").length;
    const sum = document.createElement("td"); sum.className = "hall-time-sum"; sum.textContent = `${confirmed}${waiting ? ` (${waiting})` : ""}`; sum.title = `${confirmed} Fixplätze, ${waiting} Wartelistenplätze`; row.appendChild(sum);
    body.appendChild(row);
  }

  const foot = byId("hall-time-foot"); foot.replaceChildren();
  const label = document.createElement("th"); label.scope = "row"; label.className = "hall-time-player"; label.setAttribute("aria-label", "Belegung"); foot.appendChild(label);
  for (const slot of grid.slots) {
    const confirmed = grid.entries.filter((value) => value.slotId === slot.id && value.status === "confirmed").length;
    const waiting = grid.entries.filter((value) => value.slotId === slot.id && value.status === "waitlist").length;
    const cell = document.createElement("td"); cell.hidden = viewMode === "person" && !entry(slot.id, selectedPersonId); cell.classList.toggle("is-past-slot", slotPast(slot)); cell.classList.toggle("is-selected-slot", slot.id === selectedSlotId); cell.textContent = `${confirmed}/${grid.capacity}${waiting ? ` (${waiting})` : ""}`; cell.title = `${confirmed} von ${grid.capacity} Fixplätzen, ${waiting} auf der Warteliste`; foot.appendChild(cell);
  }
  const empty = document.createElement("td"); empty.className = "hall-time-sum"; foot.appendChild(empty);
  if (previousScroll && scroll) {
    scroll.scrollLeft = previousScroll.left;
    scroll.scrollTop = previousScroll.top;
  }
  fitPersonNames();
  updateViewControls();
  refreshFavoriteButtons();
  installTableScrollRouting();
  sizeTableToViewport();
  positionTableForCurrentPlayer();
}

const HISTORY_TEXT = {
  booking_added: "hat sich angemeldet", waitlist_added: "hat sich auf die Warteliste gesetzt",
  booking_removed: "hat sich abgemeldet", waitlist_promoted: "ist von der Warteliste nachgerückt",
  waitlist_expired: "ist nach Terminende von der Warteliste entfernt worden",
  assigned_by_distribution: "wurde automatisch eingeteilt", distribution_replaced: "hat die zukünftige Verteilung neu erstellt",
  grid_created: "hat den Raster erstellt", grid_updated: "hat Einstellungen geändert", all_statuses_cleared: "hat alle Stati auf den Terminen gelöscht",
  group_joined: "ist der Gruppe beigetreten", group_left: "hat die Gruppe verlassen",
};

function distributionSummary(summary) {
  if (!summary) return "";
  const parts = [
    [summary.assignedCount, "neu zugeteilt"],
    [summary.promotedCount, "nachgerückt"],
    [summary.removedCount, "entfernt"],
    [summary.unchangedCount, "unverändert"],
  ].filter(([count]) => Number(count) > 0).map(([count, label]) => `${count} ${label}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function renderHistory(entries) {
  const list = byId("hall-time-history-list"); list.replaceChildren();
  for (const item of entries) {
    const li = document.createElement("li"); li.className = "competition-history-entry";
    const hasPersonIds = Boolean(item.actorId && item.personId);
    const actorIsPerson = hasPersonIds ? item.actorId === item.personId : item.actorName === item.personName;
    const actorChangedOther = item.actorName && item.actorName !== "System" && !actorIsPerson;
    const otherActions = {
      booking_added: "angemeldet", waitlist_added: "auf die Warteliste gesetzt", booking_removed: "abgemeldet",
    };
    let text;
    if (actorChangedOther && item.personName && otherActions[item.action]) text = `${item.actorName} hat ${item.personName} ${otherActions[item.action]}`;
    else {
      const personName = actorIsPerson && item.actorName && item.actorName !== "System" ? item.actorName : item.personName;
      const person = personName ? `${personName} ` : item.actorName && item.actorName !== "System" ? `${item.actorName} ` : "";
      text = `${person}${HISTORY_TEXT[item.action] || item.action}`;
      if (item.action === "distribution_replaced") text += distributionSummary(item.summary);
    }
    const changedAt = new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short" }).format(item.at);
    const meta = document.createElement("time"); meta.className = "competition-history-entry-meta"; meta.dateTime = new Date(item.at).toISOString(); meta.textContent = `Geändert am: ${changedAt}`; li.appendChild(meta);
    const title = document.createElement("p"); title.className = "competition-history-entry-title"; title.textContent = text; li.appendChild(title);
    if (item.slot) {
      const slot = document.createElement("p"); slot.className = "competition-history-entry-meta competition-history-slot"; slot.textContent = dateLabel(item.slot).full; li.appendChild(slot);
    }
    list.appendChild(li);
  }
  if (!entries.length) list.appendChild(Object.assign(document.createElement("li"), { textContent: "Noch keine Änderungen vorhanden." }));
}

async function load({ quiet = false } = {}) {
  if (!authorized || !gridId) return;
  const current = ++generation;
  if (!quiet) setFeedback("Raster wird geladen …", "loading");
  try {
    const [gridResponse, historyResponse] = await Promise.all([readGrid({ gridId }), readHistory({ gridId })]);
    if (current !== generation || !authorized) return;
    grid = gridResponse.data.grid;
    byId("hall-time-access").hidden = true;
    byId("hall-time-app").hidden = false;
    render(); renderHistory(historyResponse.data.entries || []);
    setFeedback();
  } catch (error) {
    if (current !== generation) return;
    byId("hall-time-app").hidden = true;
    byId("hall-time-access").hidden = false;
    byId("hall-time-access-message").textContent = errorText(error);
    diagnostic.error("hall_time_load_failed", error);
  }
}

async function toggle(slot, person, selected) {
  if (busy) return;
  busy = true;
  document.querySelectorAll(".hall-time-state").forEach((button) => { button.disabled = true; });
  setFeedback();
  const key = `hall-time:${grid.id}:${slot.id}:${person.id}:${selected}`;
  try {
    const response = await writeBooking({ operationId: getOperationId(key), gridId: grid.id, slotId: slot.id, ...(person.id !== grid.currentPersonId ? { personId: person.id } : {}), selected });
    releaseOperationId(key); grid = response.data.grid;
    const history = await readHistory({ gridId: grid.id }); renderHistory(history.data.entries || []);
  } catch (error) {
    releaseOperationId(key, error); setFeedback(errorText(error), "error"); diagnostic.error("hall_time_write_failed", error);
  } finally { busy = false; if (grid) render(); }
}

byId("hall-time-info-open").addEventListener("click", openGridInfo);
byId("hall-time-view-all").addEventListener("click", () => selectView("all"));
byId("hall-time-view-current").addEventListener("click", () => selectView("selected"));
for (const dialog of [byId("hall-time-info-dialog"), byId("hall-time-message-dialog")]) {
  dialog.querySelector('button[type="submit"]').addEventListener("click", () => {
    if (typeof dialog.close !== "function") dialog.removeAttribute("open");
  });
}

subscribeAuth((user, authState) => {
  authorized = authState.status === "authenticated" && Boolean(user);
  if (!authorized) {
    byId("hall-time-app").hidden = true; byId("hall-time-access").hidden = false;
    byId("hall-time-access-message").textContent = authState.status === "loading" ? "Sitzung wird geprüft …" : "Bitte anmelden, um diesen Raster zu öffnen.";
    return;
  }
  if (!gridId) { byId("hall-time-access-message").textContent = "Kein Hallenzeiten-Raster angegeben."; return; }
  load();
});
subscribe("hall-times", (event) => { if (authorized && (!event?.gridId || event.gridId === gridId)) load({ quiet: true }); });
window.addEventListener("resize", sizeTableToViewport);
window.visualViewport?.addEventListener("resize", sizeTableToViewport);
ready.catch((error) => diagnostic.error("hall_time_load_failed", error));
