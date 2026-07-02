/* eslint-disable max-len */
import {SHEET_ID} from "../config.js";

export async function logEntry({sheets, source, entry}) {
  try {
    const now = new Date();
    const ts = String(now.getFullYear()).slice(-2) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      "-" +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      "-" +
      String(now.getSeconds()).padStart(2, "0");

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Logging",
      valueInputOption: "USER_ENTERED",
      requestBody: {values: [[ts, source, entry]]},
    });
  } catch {
    // logging never breaks the caller
  }
}

export function buildMap(rows, idCol, nameCol1, nameCol2) {
  const map = new Map();
  if (rows.length < 2) return map;
  const header = rows[0].map((h) => (h || "").trim().toLowerCase());
  const idIdx = header.indexOf(idCol);
  const n1Idx = header.indexOf(nameCol1);
  const n2Idx = nameCol2 ? header.indexOf(nameCol2) : -1;
  if (idIdx === -1 || n1Idx === -1) return map;
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][idIdx] || "").trim();
    if (!id) continue;
    const name = [rows[i][n1Idx] || "", n2Idx !== -1 ? rows[i][n2Idx] || "" : ""].filter(Boolean).join(" ").trim();
    if (name) map.set(id, name);
  }
  return map;
}

export async function buildPlayerMap(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Personen",
  });
  return buildMap(res.data.values || [], "id", "vorname", "nachname");
}

export async function buildBewerbMap(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Bewerb",
  });
  return buildMap(res.data.values || [], "id", "bezeichnung", null);
}

export function fmtPlayer(id, map) {
  const name = map.get(id);
  return name ? `${id} (${name})` : id;
}

export function fmtBewerb(id, map) {
  const name = map.get(id);
  return name ? `${id} (${name})` : id;
}
