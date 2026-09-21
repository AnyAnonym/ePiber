import { ready, subscribeAuth } from "./authClient.js";
import { createEndpoint, getOperationId, releaseOperationId, subscribe } from "./dataClient.js";
import { diagnostic } from "./diagnostics.js";

const readGrids = createEndpoint("adminHallTimeGrids");
const readPlayers = createEndpoint("memberDirectory");
const saveGrid = createEndpoint("adminSaveHallTimeGrid");
const distributeGrid = createEndpoint("adminDistributeHallTimeGrid");
const clearAllStatuses = createEndpoint("adminClearAllHallTimeStatuses");
const byId = (id) => document.getElementById(id);
let grids = [];
let players = [];
let selectedId = null;
let revision = 0;
let slots = [];
let selectedParticipantIds = new Set();
let authorized = false;
let busy = false;

function feedback(text = "", state = "") { byId("hall-time-admin-feedback").textContent = text; byId("hall-time-admin-feedback").dataset.state = state; }
function errorText(error) { return String(error?.message || "Der Vorgang ist fehlgeschlagen.").replace(/\s*\((?:Referenz|Support-ID):[^)]*\)\s*$/iu, ""); }
function openDialog(dialog) {
  dialog.style.setProperty("--hall-time-dialog-offset-x", `${window.visualViewport?.offsetLeft || 0}px`);
  dialog.style.setProperty("--hall-time-dialog-offset-y", `${window.visualViewport?.offsetTop || 0}px`);
  dialog.showModal();
}

function parsePlayers(values) {
  if (!Array.isArray(values) || !Array.isArray(values[0])) return [];
  const header = values[0].map((value) => String(value || "").trim().toLowerCase());
  const indexes = { id: header.indexOf("id"), first: header.indexOf("vorname"), last: header.indexOf("nachname"), active: header.indexOf("aktiv") };
  return values.slice(1).flatMap((row) => {
    const id = String(row[indexes.id] || "").trim();
    if (!id || (indexes.active >= 0 && String(row[indexes.active] || "").trim() !== "1")) return [];
    const firstName = String(row[indexes.first] || "").trim();
    const lastName = String(row[indexes.last] || "").trim();
    const name = [lastName, firstName].filter(Boolean).join(" ") || id;
    return [{ id, firstName, lastName, name }];
  }).sort((left, right) => left.lastName.localeCompare(right.lastName, "de") || left.firstName.localeCompare(right.firstName, "de") || left.id.localeCompare(right.id));
}

function currentGrid() { return grids.find(({ id }) => id === selectedId) || null; }

function renderList() {
  const nav = byId("hall-time-grid-list"); nav.replaceChildren();
  for (const grid of grids.sort((a, b) => a.name.localeCompare(b.name, "de"))) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = `${grid.name}${grid.active ? "" : " (archiviert)"}`;
    button.classList.toggle("active", grid.id === selectedId); button.addEventListener("click", () => selectGrid(grid.id)); nav.appendChild(button);
  }
}

function renderPlayers() {
  const filter = byId("hall-time-player-filter").value.trim().toLocaleLowerCase("de");
  const container = byId("hall-time-players"); container.replaceChildren();
  for (const player of players.filter(({ name }) => name.toLocaleLowerCase("de").includes(filter))) {
    const label = document.createElement("label"); const check = document.createElement("input"); check.type = "checkbox"; check.value = player.id; check.checked = selectedParticipantIds.has(player.id); check.addEventListener("change", () => { if (check.checked) selectedParticipantIds.add(player.id); else selectedParticipantIds.delete(player.id); }); label.append(check, document.createTextNode(player.name)); container.appendChild(label);
  }
}

function renderSlots() {
  const container = byId("hall-time-slots"); container.replaceChildren();
  slots.sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`)).forEach((slot) => {
    const row = document.createElement("div"); row.className = "hall-time-slot-row";
    for (const field of ["date", "start", "end"]) { const input = document.createElement("input"); input.type = field === "date" ? "date" : "time"; input.value = slot[field]; input.addEventListener("change", () => { slot[field] = input.value; }); row.appendChild(input); }
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Entfernen"; remove.addEventListener("click", () => { slots = slots.filter((value) => value !== slot); renderSlots(); }); row.appendChild(remove); container.appendChild(row);
  });
}

function applyGrid(grid) {
  byId("hall-time-form-title").textContent = grid ? grid.name : "Neuer Raster";
  byId("hall-time-name").value = grid?.name || ""; byId("hall-time-description-input").value = grid?.description || "";
  byId("hall-time-mode").value = grid?.mode || "equal"; byId("hall-time-capacity").value = grid?.capacity || 4;
  byId("hall-time-waitlist").checked = grid?.waitlistEnabled ?? true; byId("hall-time-active").checked = grid?.active ?? true;
  byId("hall-time-waitlist-limit").value = grid?.maxWaitlistEntries ?? 2; byId("hall-time-public-join").checked = grid?.publicJoinable ?? false;
  byId("hall-time-fair-base").value = grid?.fairUse?.base ?? 2; byId("hall-time-fair-extended").value = grid?.fairUse?.extendedDays ?? 7;
  byId("hall-time-fair-percent").value = grid?.fairUse?.percent ?? 50; byId("hall-time-fair-open").value = grid?.fairUse?.openDays ?? 2;
  slots = structuredClone(grid?.slots || []); renderSlots();
  selectedParticipantIds = new Set((grid?.participants || []).map(({ id }) => id)); byId("hall-time-player-filter").value = ""; renderPlayers();
  byId("hall-time-open").hidden = !grid?.active; if (grid) byId("hall-time-open").href = `hallzeiten.html?id=${encodeURIComponent(grid.id)}`;
  byId("hall-time-print-actions").hidden = !grid;
  if (grid) {
    const base = `hallzeitenDrucken.html?id=${encodeURIComponent(grid.id)}`;
    byId("hall-time-print-mine").href = `${base}&ansicht=mine`;
    byId("hall-time-print-all").href = `${base}&ansicht=all`;
  }
  updateMode(); updateWaitlist(); renderList();
}

function selectGrid(id) { selectedId = id; applyGrid(currentGrid()); }
function updateMode() { const equal = byId("hall-time-mode").value === "equal"; byId("hall-time-fair-use").disabled = equal; byId("hall-time-distribute").hidden = !equal || !selectedId; byId("hall-time-clear-all-statuses").hidden = !selectedId || !(currentGrid()?.entries?.length); }
function updateWaitlist() { byId("hall-time-waitlist-limit").disabled = !byId("hall-time-waitlist").checked; }
function selectedPlayers() { return [...selectedParticipantIds]; }

function dateAfterWeeks(date, weeks) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + (weeks * 7));
  return value.toISOString().slice(0, 10);
}

function addSlotSeries() {
  const date = byId("hall-time-slot-date").value;
  const start = byId("hall-time-slot-start").value;
  const end = byId("hall-time-slot-end").value;
  const followUps = Number(byId("hall-time-slot-repeat").value);
  if (!date || !start || !end) return feedback("Datum, Beginn und Ende sind erforderlich.", "error");
  if (end <= start) return feedback("Das Terminende muss nach dem Beginn liegen.", "error");
  if (!Number.isInteger(followUps) || followUps < 0 || followUps > 249) return feedback("Folgetermine müssen eine ganze Zahl zwischen 0 und 249 sein.", "error");
  const existing = new Set(slots.map((slot) => `${slot.date}:${slot.start}:${slot.end}`));
  const additions = [];
  for (let week = 0; week <= followUps; week++) {
    const candidate = { date: dateAfterWeeks(date, week), start, end };
    const key = `${candidate.date}:${start}:${end}`;
    if (!existing.has(key)) { additions.push(candidate); existing.add(key); }
  }
  if (slots.length + additions.length > 250) return feedback("Ein Raster darf maximal 250 Termine enthalten.", "error");
  if (!additions.length) return feedback("Alle Termine dieser Serie sind bereits vorhanden.", "error");
  slots.push(...additions); renderSlots();
  const skipped = followUps + 1 - additions.length;
  feedback(`${additions.length} Termin${additions.length === 1 ? "" : "e"} übernommen${skipped ? `, ${skipped} bereits vorhandene übersprungen` : ""}.`, "success");
}

async function load() {
  if (!authorized) return;
  feedback("Raster werden geladen …", "loading");
  try {
    const [gridResponse, playerResponse] = await Promise.all([readGrids(), readPlayers()]);
    grids = gridResponse.data.grids || []; revision = gridResponse.data.revision || 0; players = parsePlayers(playerResponse.data.values);
    if (selectedId && !grids.some(({ id }) => id === selectedId)) selectedId = null;
    applyGrid(currentGrid()); feedback();
  } catch (error) { feedback(errorText(error), "error"); diagnostic.error("hall_time_admin_load_failed", error); }
}

async function submit(event) {
  event.preventDefault(); if (busy) return;
  const fairUse = { base: Number(byId("hall-time-fair-base").value), extendedDays: Number(byId("hall-time-fair-extended").value), percent: Number(byId("hall-time-fair-percent").value), openDays: Number(byId("hall-time-fair-open").value) };
  const payload = { expectedRevision: revision, ...(selectedId ? { gridId: selectedId } : {}), name: byId("hall-time-name").value.trim(), description: byId("hall-time-description-input").value.trim(), mode: byId("hall-time-mode").value, capacity: Number(byId("hall-time-capacity").value), waitlistEnabled: byId("hall-time-waitlist").checked, maxWaitlistEntries: Number(byId("hall-time-waitlist-limit").value), publicJoinable: byId("hall-time-public-join").checked, fairUse, active: byId("hall-time-active").checked, participantIds: selectedPlayers(), slots: slots.map(({ id, date, start, end }) => ({ ...(id ? { id } : {}), date, start, end })) };
  const key = `hall-time-admin-save:${selectedId || "new"}:${revision}`; busy = true; feedback("Raster wird gespeichert …", "loading");
  try { const response = await saveGrid({ ...payload, operationId: getOperationId(key) }); releaseOperationId(key); selectedId = response.data.grid.id; await load(); feedback("Raster wurde gespeichert.", "success"); }
  catch (error) { releaseOperationId(key, error); feedback(errorText(error), "error"); diagnostic.error("hall_time_admin_write_failed", error); if (error.code === "REVISION_CONFLICT") await load(); }
  finally { busy = false; }
}

async function distribute() {
  if (!selectedId || busy) return; const key = `hall-time-distribute:${selectedId}:${revision}`; busy = true; feedback("Verteilung wird berechnet …", "loading");
  try { await distributeGrid({ operationId: getOperationId(key), gridId: selectedId, expectedRevision: revision }); releaseOperationId(key); await load(); feedback("Zukünftige Termine wurden neu verteilt.", "success"); }
  catch (error) { releaseOperationId(key, error); feedback(errorText(error), "error"); diagnostic.error("hall_time_admin_write_failed", error); if (error.code === "REVISION_CONFLICT") await load(); }
  finally { busy = false; }
}

async function removeAllStatuses() {
  if (!selectedId || busy) return;
  const key = `hall-time-clear-all-statuses:${selectedId}:${revision}`;
  busy = true; feedback("Alle Stati werden gelöscht …", "loading");
  try {
    const response = await clearAllStatuses({ operationId: getOperationId(key), gridId: selectedId, expectedRevision: revision });
    releaseOperationId(key); await load();
    feedback(`${response.data.deletedEntryCount || 0} Stati wurden gelöscht.`, "success");
  } catch (error) {
    releaseOperationId(key, error); feedback(errorText(error), "error"); diagnostic.error("hall_time_admin_write_failed", error);
    if (error.code === "REVISION_CONFLICT") await load();
  } finally { busy = false; }
}

byId("hall-time-form").addEventListener("submit", submit);
byId("hall-time-new").addEventListener("click", () => { selectedId = null; applyGrid(null); });
byId("hall-time-mode").addEventListener("change", updateMode);
byId("hall-time-waitlist").addEventListener("change", updateWaitlist);
byId("hall-time-player-filter").addEventListener("input", renderPlayers);
byId("hall-time-slot-add").addEventListener("click", addSlotSeries);
byId("hall-time-distribute").addEventListener("click", () => {
  const dialog = byId("hall-time-distribute-dialog");
  if (typeof dialog.showModal === "function") openDialog(dialog);
  else if (window.confirm("Alle grünen und gelben Einträge zukünftiger Termine ersetzen?")) distribute();
});
byId("hall-time-distribute-confirm").addEventListener("click", (event) => { event.preventDefault(); byId("hall-time-distribute-dialog").close(); distribute(); });
byId("hall-time-clear-all-statuses").addEventListener("click", () => {
  const dialog = byId("hall-time-clear-statuses-dialog");
  if (typeof dialog.showModal === "function") openDialog(dialog);
  else if (window.confirm("Wirklich alle Stati auf den Terminen löschen?")) removeAllStatuses();
});
byId("hall-time-clear-statuses-confirm").addEventListener("click", (event) => { event.preventDefault(); byId("hall-time-clear-statuses-dialog").close(); removeAllStatuses(); });
subscribeAuth((user, authState) => { authorized = authState.status === "authenticated" && user?.role === "admin"; byId("hall-time-admin-access").hidden = authorized; byId("hall-time-admin-app").hidden = !authorized; if (authorized) load(); else byId("hall-time-admin-access-message").textContent = authState.status === "loading" ? "Sitzung wird geprüft …" : "Diese Seite ist ausschließlich für Administratoren verfügbar."; });
subscribe("hall-times", () => { if (authorized && !busy) load(); });
ready.catch((error) => diagnostic.error("hall_time_admin_load_failed", error));
