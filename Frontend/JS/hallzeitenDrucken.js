import { hasRole, ready } from "./authClient.js";
import { createEndpoint } from "./dataClient.js";
import { diagnostic } from "./diagnostics.js";

const readGrid = createEndpoint("hallTimeGrid");
const readPreview = createEndpoint("adminPreviewHallTimeDistribution");
const params = new URLSearchParams(location.search);
const gridId = String(params.get("id") || "").trim();
const view = params.get("ansicht") === "all" ? "all" : "mine";
const previewParameter = params.get("vorschau");
const previewMode = previewParameter !== null;
const byId = (id) => document.getElementById(id);
const errorText = (error) => String(error?.message || "Die Druckansicht konnte nicht geladen werden.").replace(/\s*\((?:Referenz|Support-ID):[^)]*\)\s*$/iu, "");

function dateLabel(slot) {
  const [year, month, day] = slot.date.split("-").map(Number);
  return `${day}.${month}.${String(year).slice(-2)}`;
}

function shortTime(value) {
  return String(value || "").replace(/:00$/, "");
}

function statusFor(grid, slotId, personId) {
  return grid.entries.find((entry) => entry.slotId === slotId && entry.personId === personId) || null;
}

function constraintFor(grid, slotId, personId) {
  return (grid.constraints || []).find((entry) => entry.slotId === slotId && entry.personId === personId)?.kind || "";
}

function comparePeople(left, right) {
  return String(left.lastName || left.name || "").localeCompare(String(right.lastName || right.name || ""), "de")
    || String(left.firstName || "").localeCompare(String(right.firstName || ""), "de")
    || String(left.id || "").localeCompare(String(right.id || ""), "de");
}

function appendCell(row, tag, text, className = "") {
  const cell = document.createElement(tag);
  cell.textContent = text;
  if (className) cell.className = className;
  row.appendChild(cell);
  return cell;
}

function measuredWidth(values) {
  const probe = document.createElement("span");
  probe.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;white-space:nowrap;font:700 7pt Arial,Helvetica,sans-serif";
  document.body.appendChild(probe);
  let width = 0;
  for (const value of values) { probe.textContent = value; width = Math.max(width, probe.getBoundingClientRect().width); }
  probe.remove();
  return Math.ceil(width) + 4;
}

function printLayout(grid, people, { blank = false } = {}) {
  const names = blank ? ["Name", "________________________"] : ["Name", ...people.map((person) => [person.lastName, person.firstName].filter(Boolean).join(" ") || person.name)];
  const slotValues = grid.slots.flatMap((slot) => [dateLabel(slot), `${shortTime(slot.start)}-${shortTime(slot.end)}`]);
  for (const entry of grid.entries) slotValues.push(entry.status === "waitlist" ? `W${entry.waitlistPosition || ""}` : entry.status === "confirmed" ? "✓" : "×");
  return { nameWidth: measuredWidth(names), slotWidth: measuredWidth(slotValues.length ? slotValues : [""]) };
}

function renderTable(grid, people, slots, layout, { blank = false, showConstraints = false } = {}) {
  const table = document.createElement("table");
  table.className = "hall-time-print-table";
  table.style.setProperty("--print-name-width", `${layout.nameWidth}px`);
  table.style.setProperty("--print-slot-width", `${layout.slotWidth}px`);
  table.style.setProperty("--print-table-width", `${layout.nameWidth + slots.length * layout.slotWidth}px`);
  const columns = document.createElement("colgroup");
  columns.appendChild(Object.assign(document.createElement("col"), { className: "print-name-column" }));
  for (const _slot of slots) columns.appendChild(Object.assign(document.createElement("col"), { className: "print-slot-column" }));
  table.appendChild(columns);
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  appendCell(headRow, "th", "Name", "print-name");
  for (const slot of slots) appendCell(headRow, "th", slot.blank ? "" : `${dateLabel(slot)}\n${shortTime(slot.start)}-${shortTime(slot.end)}`, "print-slot");
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement("tbody");
  for (const person of people) {
    const row = document.createElement("tr");
    row.dataset.personId = person.id;
    appendCell(row, "th", blank ? "________________________" : [person.lastName, person.firstName].filter(Boolean).join(" ") || person.name, "print-name");
    for (const slot of slots) {
      if (slot.blank) { appendCell(row, "td", "", "is-empty print-empty-slot"); continue; }
      const value = statusFor(grid, slot.id, person.id);
      const text = blank ? "" : value?.status === "confirmed" ? "✓" : value?.status === "waitlist" ? `W${value.waitlistPosition || ""}` : "×";
      const constraint = showConstraints ? constraintFor(grid, slot.id, person.id) : "";
      const cell = appendCell(row, "td", text, `is-${value?.status || "empty"}${constraint ? ` has-constraint constraint-${constraint}` : ""}`);
      cell.dataset.slotId = slot.id;
    }
    body.appendChild(row);
  }
  table.appendChild(body);
  return table;
}

function appendConstraintLegend(container) {
  const legend = document.createElement("aside"); legend.className = "hall-time-print-legend"; legend.setAttribute("aria-label", "Legende der Verhinderungen und Wünsche");
  for (const [className, label] of [["constraint-unavailable", "Verhindert"], ["constraint-avoid", "Möglichst vermeiden"]]) {
    const item = document.createElement("span"); const marker = document.createElement("i"); marker.className = className; marker.setAttribute("aria-hidden", "true"); item.append(marker, document.createTextNode(label)); legend.appendChild(item);
  }
  container.appendChild(legend);
}

function render(grid, { showConstraints = false } = {}) {
  if (!grid.canAdminister) throw new Error("Diese Druckvorlagen sind ausschließlich für Administratoren verfügbar.");
  const ownPeople = grid.participants.filter(({ id }) => id === grid.currentPersonId);
  const blank = view === "mine" && !ownPeople.length;
  const people = [...(view === "all" ? grid.participants : ownPeople.length ? ownPeople : [{ id: "", firstName: "", lastName: "", name: "" }])].sort(comparePeople);
  const layout = printLayout(grid, people, { blank });
  const pages = byId("hall-time-print-pages");
  const splitAt = Math.ceil(grid.slots.length / 2);
  const blocks = [grid.slots.slice(0, splitAt), grid.slots.slice(splitAt)];
  if (blocks[0].length > blocks[1].length) blocks[1].push({ id: "", blank: true });
  for (const slots of blocks) {
    const section = document.createElement("section");
    section.className = "hall-time-print-page";
    section.appendChild(renderTable(grid, people, slots, layout, { blank, showConstraints }));
    pages.appendChild(section);
  }
  if (showConstraints) appendConstraintLegend(pages.lastElementChild);
  document.title = `${grid.name} – ${showConstraints ? "Verteilungsvorschau" : view === "all" ? "Gesamter Raster" : "Mein Raster"}`;
  byId("hall-time-print-access").hidden = true;
  byId("hall-time-print-app").hidden = false;
}

async function start() {
  try {
    await ready;
    if (!hasRole("admin")) throw new Error("Diese Druckvorlagen sind ausschließlich für Administratoren verfügbar.");
    if (!gridId) throw new Error("Kein Hallenzeiten-Raster angegeben.");
    const response = await readGrid({ gridId });
    let grid = response.data.grid;
    if (previewMode) {
      if (view !== "all" || !/^[0-9a-f]{64}$/u.test(previewParameter)) throw new Error("Die angeforderte Druckvorschau ist ungültig.");
      const previewResponse = await readPreview({ gridId, expectedRevision: grid.revision });
      const preview = previewResponse.data.preview;
      if (preview.previewHash !== previewParameter) throw new Error("Diese Druckvorschau ist nicht mehr aktuell. Bitte berechne sie erneut.");
      const previewSlotIds = new Set(preview.slotSummaries.map(({ slot }) => slot.id));
      grid = { ...grid, entries: [...grid.entries.filter(({ slotId }) => !previewSlotIds.has(slotId)), ...preview.entries] };
    }
    render(grid, { showConstraints: previewMode });
  } catch (error) {
    byId("hall-time-print-message").textContent = errorText(error);
    diagnostic.error("hall_time_admin_load_failed", error);
  }
}

start();
