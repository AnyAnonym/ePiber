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

const byId = (id) => document.getElementById(id);
const errorText = (error) => error?.message || "Der Vorgang ist fehlgeschlagen.";

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

function slotPast(slot) {
  return new Date(`${slot.date}T${slot.end}:00`).getTime() <= Date.now();
}

function setFeedback(text = "", state = "") {
  byId("hall-time-feedback").textContent = text;
  byId("hall-time-feedback").dataset.state = state;
}

function statusButton(slot, person) {
  const value = entry(slot.id, person.id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `hall-time-state is-${value?.status || "empty"}`;
  button.textContent = value?.status === "confirmed" ? "✓" : value?.status === "waitlist" ? `⌛ ${value.waitlistPosition}` : "×";
  const own = person.id === grid.currentPersonId;
  const editable = (own || grid.canAdminister) && (!slotPast(slot) || grid.canAdminister);
  button.disabled = busy || !editable;
  button.title = value?.status === "confirmed" ? "Fixplatz – abmelden" : value?.status === "waitlist" ? `Wartelistenplatz ${value.waitlistPosition} – abmelden` : editable ? "Für diesen Termin anmelden" : "Nicht eingetragen";
  button.setAttribute("aria-label", `${person.name}, ${dateLabel(slot).full}: ${button.title}`);
  if (editable) button.addEventListener("click", () => toggle(slot, person, !value));
  return button;
}

function render() {
  document.title = `ASKÖ Piberbach – ${grid.name}`;
  byId("hall-time-title").textContent = grid.name;
  byId("hall-time-description").textContent = grid.description;
  byId("hall-time-rules").replaceChildren(...[
    `${grid.capacity} Fixplätze pro Termin`,
    grid.waitlistEnabled ? "Warteliste aktiv" : "Keine Warteliste",
    grid.mode === "equal" ? "Gleichberechtigte Aufteilung" : `FairUse: ${grid.fairUse.base} · ${grid.fairUse.extendedDays} Tage / ${grid.fairUse.percent} % · frei ab ${grid.fairUse.openDays} Tagen`,
  ].map((text) => Object.assign(document.createElement("span"), { textContent: text })));

  const head = byId("hall-time-head");
  head.replaceChildren();
  const playerHead = document.createElement("th"); playerHead.scope = "col"; playerHead.textContent = "Spieler"; playerHead.className = "hall-time-player"; head.appendChild(playerHead);
  for (const slot of grid.slots) {
    const th = document.createElement("th"); th.scope = "col"; th.title = dateLabel(slot).full;
    const [weekday, date] = dateLabel(slot).short.split(", ");
    th.innerHTML = `<span>${weekday || ""}</span><strong>${date || dateLabel(slot).short}</strong><small>${slot.start}</small>`;
    head.appendChild(th);
  }
  const sumHead = document.createElement("th"); sumHead.scope = "col"; sumHead.textContent = "Σ"; sumHead.title = "Fixplätze (Warteliste)"; sumHead.className = "hall-time-sum"; head.appendChild(sumHead);

  const body = byId("hall-time-body"); body.replaceChildren();
  for (const person of grid.participants) {
    const row = document.createElement("tr");
    if (person.id === grid.currentPersonId) row.className = "is-current-player";
    const name = document.createElement("th"); name.scope = "row"; name.textContent = person.name; name.className = "hall-time-player"; row.appendChild(name);
    for (const slot of grid.slots) { const cell = document.createElement("td"); cell.appendChild(statusButton(slot, person)); row.appendChild(cell); }
    const confirmed = grid.entries.filter((value) => value.personId === person.id && value.status === "confirmed").length;
    const waiting = grid.entries.filter((value) => value.personId === person.id && value.status === "waitlist").length;
    const sum = document.createElement("td"); sum.className = "hall-time-sum"; sum.textContent = `${confirmed}${waiting ? ` (${waiting})` : ""}`; sum.title = `${confirmed} Fixplätze, ${waiting} Wartelistenplätze`; row.appendChild(sum);
    body.appendChild(row);
  }

  const foot = byId("hall-time-foot"); foot.replaceChildren();
  const label = document.createElement("th"); label.scope = "row"; label.textContent = "Belegung"; label.className = "hall-time-player"; foot.appendChild(label);
  for (const slot of grid.slots) {
    const confirmed = grid.entries.filter((value) => value.slotId === slot.id && value.status === "confirmed").length;
    const waiting = grid.entries.filter((value) => value.slotId === slot.id && value.status === "waitlist").length;
    const cell = document.createElement("td"); cell.textContent = `${confirmed}/${grid.capacity}${waiting ? ` (${waiting})` : ""}`; cell.title = `${confirmed} von ${grid.capacity} Fixplätzen, ${waiting} auf der Warteliste`; foot.appendChild(cell);
  }
  const empty = document.createElement("td"); empty.className = "hall-time-sum"; foot.appendChild(empty);
  refreshFavoriteButtons();
}

const HISTORY_TEXT = {
  booking_added: "hat sich angemeldet", waitlist_added: "hat sich auf die Warteliste gesetzt",
  booking_removed: "hat sich abgemeldet", waitlist_promoted: "ist von der Warteliste nachgerückt",
  waitlist_expired: "ist nach Terminende von der Warteliste entfernt worden",
  assigned_by_distribution: "wurde automatisch eingeteilt", distribution_replaced: "hat die zukünftige Verteilung neu erstellt",
  grid_created: "hat den Raster erstellt", grid_updated: "hat den Raster geändert",
};

function renderHistory(entries) {
  const list = byId("hall-time-history-list"); list.replaceChildren();
  for (const item of entries) {
    const li = document.createElement("li"); li.className = "competition-history-entry";
    const time = document.createElement("time"); time.dateTime = new Date(item.at).toISOString(); time.textContent = new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short" }).format(item.at); li.appendChild(time);
    const person = item.personName ? `${item.personName} ` : "";
    const slot = item.slot ? ` (${dateLabel(item.slot).full})` : "";
    const title = document.createElement("p"); title.className = "competition-history-entry-title"; title.textContent = `${person}${HISTORY_TEXT[item.action] || item.action}${slot}`; li.appendChild(title);
    if (item.actorName && item.actorName !== "System" && item.actorName !== item.personName) {
      const actor = document.createElement("p"); actor.className = "competition-history-entry-meta"; actor.textContent = `Eingetragen durch: ${item.actorName}`; li.appendChild(actor);
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
  busy = true; render(); setFeedback("Änderung wird gespeichert …", "loading");
  const key = `hall-time:${grid.id}:${slot.id}:${person.id}:${selected}`;
  try {
    const response = await writeBooking({ operationId: getOperationId(key), gridId: grid.id, slotId: slot.id, ...(grid.canAdminister && person.id !== grid.currentPersonId ? { personId: person.id } : {}), selected });
    releaseOperationId(key); grid = response.data.grid; render();
    const value = entry(slot.id, person.id);
    setFeedback(value?.status === "waitlist" ? `Wartelistenplatz ${value.waitlistPosition} wurde gespeichert.` : selected ? "Fixplatz wurde gespeichert." : "Abmeldung wurde gespeichert.", "success");
    const history = await readHistory({ gridId: grid.id }); renderHistory(history.data.entries || []);
  } catch (error) {
    releaseOperationId(key, error); setFeedback(errorText(error), "error"); diagnostic.error("hall_time_write_failed", error);
  } finally { busy = false; if (grid) render(); }
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
ready.catch((error) => diagnostic.error("hall_time_load_failed", error));
