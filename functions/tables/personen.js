/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";
import {logEntry} from "./logging.js";

export async function readPlayersData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Personen",
  });
  return res.data.values || [];
}

export const readPlayersList = onCall(async () => {
  try {
    const sheets = await getSheetsClient(true);
    const values = await readPlayersData(sheets);
    return {success: true, values};
  } catch (err) {
    console.error("Fehler in readPlayersList:", err);
    return {success: false, error: err.message};
  }
});

function parsePlayerHeader(rows) {
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return {
    idIdx: header.indexOf("id"),
    firstNameIdx: header.indexOf("vorname"),
    lastNameIdx: header.indexOf("nachname"),
    emailIdx: header.indexOf("e-mail"),
    hashIdx: header.indexOf("passwdhash"),
    birthIdx: header.indexOf("geburtsdatum"),
    kennwortVergessenIdx: header.indexOf("kennwortvergessen"),
    telefonIdx: header.indexOf("telefonmobil"),
    aktivIdx: header.indexOf("aktiv"),
  };
}

export async function readPlayerDetailsData(sheets) {
  const values = await readPlayersData(sheets);
  if (values.length < 2) throw new Error("Keine Spielerdaten gefunden.");
  const idx = parsePlayerHeader(values);
  return values.slice(1).map((row) => ({
    id: row[idx.idIdx] || "",
    firstName: (row[idx.firstNameIdx] || "").trim(),
    lastName: (row[idx.lastNameIdx] || "").trim(),
    fullName: `${(row[idx.firstNameIdx] || "").trim()} ${(row[idx.lastNameIdx] || "").trim()}`.trim(),
    email: row[idx.emailIdx] || "",
    birthDate: row[idx.birthIdx] || "",
    telefon: row[idx.telefonIdx] || "",
  }));
}

export const readPlayerDetails = onCall(async () => {
  try {
    const sheets = await getSheetsClient(true);
    const players = await readPlayerDetailsData(sheets);
    return {success: true, players};
  } catch (err) {
    console.error("Fehler in readPlayerDetails:", err);
    return {success: false, error: err.message};
  }
});


export async function verifyUserLoginData(sheets, {email, passwordHash}) {
  const values = await readPlayersData(sheets);
  if (values.length < 2) throw new Error("Keine Benutzerdaten.");

  const idx = parsePlayerHeader(values);
  const userRow = values.slice(1).find(
      (row) => row[idx.emailIdx] && row[idx.emailIdx].trim().toLowerCase() === email.trim().toLowerCase(),
  );
  if (!userRow) return {valid: false, message: "E-Mail nicht gefunden."};

  const storedHash = userRow[idx.hashIdx] ? userRow[idx.hashIdx].trim() : "";
  return {valid: storedHash === passwordHash};
}

export const verifyUserLogin = onCall(async (request) => {
  try {
    const sheets = await getSheetsClient(true);
    const result = await verifyUserLoginData(sheets, request.data);
    return {success: true, ...result};
  } catch (err) {
    console.error("Fehler in verifyUserLogin:", err);
    return {success: false, error: err.message};
  }
});

export async function resetPasswordData(sheets, {email, passwordHash}) {
  const values = await readPlayersData(sheets);
  if (values.length < 2) throw new Error("Keine Benutzerdaten.");

  const idx = parsePlayerHeader(values);
  let userRowIndex = -1;
  let userRow = null;

  for (let i = 1; i < values.length; i++) {
    if (values[i][idx.emailIdx] && values[i][idx.emailIdx].trim().toLowerCase() === email.trim().toLowerCase()) {
      userRowIndex = i;
      userRow = values[i];
      break;
    }
  }
  if (!userRow) throw new Error("E-Mail nicht gefunden.");

  if (idx.kennwortVergessenIdx !== -1) {
    const kennwortVergessen = userRow[idx.kennwortVergessenIdx] ? userRow[idx.kennwortVergessenIdx].trim() : "";
    if (kennwortVergessen !== "x") throw new Error("Passwort-Reset nicht autorisiert.");
  } else {
    throw new Error("Spalte kennwortVergessen nicht vorhanden.");
  }

  const newRow = [...userRow];
  newRow[idx.hashIdx] = passwordHash;
  newRow[idx.kennwortVergessenIdx] = "";

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Personen!A${userRowIndex + 1}:N${userRowIndex + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {values: [newRow.slice(0, 14)]},
  });
  return {message: "Passwort erfolgreich zurückgesetzt."};
}

export const resetPassword = onCall(async (request) => {
  try {
    const sheets = await getSheetsClient(false);
    const result = await resetPasswordData(sheets, request.data);
    logEntry({sheets, source: "resetPassword", entry: `Passwort zurückgesetzt für ${request.data?.email}`});
    return {success: true, ...result};
  } catch (err) {
    console.error("Fehler in resetPassword:", err);
    return {success: false, error: err.message};
  }
});
