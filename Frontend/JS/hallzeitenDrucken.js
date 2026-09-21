import { hasRole, ready } from "./authClient.js";
import { createEndpoint } from "./dataClient.js";
import { diagnostic } from "./diagnostics.js";

const readGrid = createEndpoint("hallTimeGrid");
const params = new URLSearchParams(location.search);
const gridId = String(params.get("id") || "").trim();
const view = params.get("ansicht") === "all" ? "all" : "mine";
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

function renderTable(grid, people, slots, layout, { blank = false } = {}) {
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
    appendCell(row, "th", blank ? "________________________" : [person.lastName, person.firstName].filter(Boolean).join(" ") || person.name, "print-name");
    for (const slot of slots) {
      if (slot.blank) { appendCell(row, "td", "", "is-empty print-empty-slot"); continue; }
      const value = statusFor(grid, slot.id, person.id);
      const text = blank ? "" : value?.status === "confirmed" ? "✓" : value?.status === "waitlist" ? `W${value.waitlistPosition || ""}` : "×";
      appendCell(row, "td", text, `is-${value?.status || "empty"}`);
    }
    body.appendChild(row);
  }
  table.appendChild(body);
  return table;
}

function render(grid) {
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
    section.appendChild(renderTable(grid, people, slots, layout, { blank }));
    pages.appendChild(section);
  }
  document.title = `${grid.name} – ${view === "all" ? "Gesamter Raster" : "Mein Raster"}`;
  byId("hall-time-print-access").hidden = true;
  byId("hall-time-print-app").hidden = false;
}

async function start() {
  try {
    await ready;
    if (!hasRole("admin")) throw new Error("Diese Druckvorlagen sind ausschließlich für Administratoren verfügbar.");
    if (!gridId) throw new Error("Kein Hallenzeiten-Raster angegeben.");
    const response = await readGrid({ gridId });
    render(response.data.grid);
  } catch (error) {
    byId("hall-time-print-message").textContent = errorText(error);
    diagnostic.error("hall_time_admin_load_failed", error);
  }
}

start();
