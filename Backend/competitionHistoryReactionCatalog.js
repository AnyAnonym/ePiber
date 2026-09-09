const rawCatalog = require("./competitionHistoryReactions.json");

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

function loadReactionCatalog(values = rawCatalog) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50) {
    throw new Error("competitionHistoryReactions.json muss 1 bis 50 Eintraege enthalten");
  }
  const keys = new Set();
  const orders = new Set();
  const catalog = values.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Reaktionskatalog enthaelt einen ungueltigen Eintrag");
    if (Object.keys(entry).sort().join(",") !== "active,emoji,key,label,order") throw new Error("Reaktionskatalog enthaelt unbekannte Felder");
    const key = String(entry.key || "");
    const emoji = String(entry.emoji || "");
    const label = String(entry.label || "").trim();
    const order = Number(entry.order);
    if (!KEY_PATTERN.test(key) || keys.has(key)) throw new Error("Reaktionskatalog enthaelt einen ungueltigen oder doppelten Schluessel");
    if (!emoji || [...emoji].length > 12 || !label || label.length > 50) throw new Error("Reaktionskatalog enthaelt ungueltige Anzeigewerte");
    if (!Number.isInteger(order) || orders.has(order)) throw new Error("Reaktionskatalog enthaelt eine ungueltige oder doppelte Reihenfolge");
    if (typeof entry.active !== "boolean") throw new Error("Reaktionskatalog enthaelt einen ungueltigen Aktivstatus");
    keys.add(key);
    orders.add(order);
    return Object.freeze({ key, emoji, label, order, active: entry.active });
  }).sort((left, right) => left.order - right.order);
  return Object.freeze(catalog);
}

const reactionCatalog = loadReactionCatalog();
const reactionByKey = new Map(reactionCatalog.map((entry) => [entry.key, entry]));

module.exports = { loadReactionCatalog, reactionCatalog, reactionByKey };
