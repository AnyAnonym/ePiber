/* eslint-disable max-len */
import {onCall} from "firebase-functions/v2/https";
import {SHEET_ID, getSheetsClient} from "../config.js";
import {logEntry, buildPlayerMap, buildBewerbMap, fmtPlayer, fmtBewerb} from "./logging.js";

export async function readEntryListData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "EntryList",
  });
  return res.data.values || [];
}

export const readEntryList = onCall({region: "europe-west3"}, async (request) => {
  try {
    const bewerbId = request.data?.bewerbId ? String(request.data.bewerbId).trim() : null;
    if (!bewerbId) return {success: false, error: "BewerbID erforderlich"};

    const sheets = await getSheetsClient(true);
    const values = await readEntryListData(sheets);
    console.log(`[readEntryList] BewerbId=${bewerbId} rows=${values.length} header=${JSON.stringify(values[0] || [])}`);
    if (values.length > 1) {
      console.log(`[readEntryList] first data row=${JSON.stringify(values[1])}`);
    }
    return {success: true, values, bewerbId};
  } catch (err) {
    console.error("Fehler in readEntryList:", err);
    return {success: false, error: err.message};
  }
});

function parseSheetDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m8 = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m8) return new Date(+m8[1], +m8[2] - 1, +m8[3]);
  const m6 = s.match(/^(\d{2})(\d{2})(\d{2})/);
  if (m6) {
    const y = +m6[1] >= 50 ? 1900 + +m6[1] : 2000 + +m6[1];
    return new Date(y, +m6[2] - 1, +m6[3]);
  }
  return null;
}

function formatSimpleDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function parseBirthdate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  let match = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) return new Date(+match[3], +match[2] - 1, +match[1]);

  match = s.match(/^(\d{4})[.-](\d{2})[.-](\d{2})$/);
  if (match) return new Date(+match[1], +match[2] - 1, +match[3]);

  match = s.match(/^(\d{2})[.-](\d{2})[.-](\d{4})$/);
  if (match) return new Date(+match[3], +match[2] - 1, +match[1]);

  match = s.match(/^(\d{2})(\d{2})(\d{2})-/);
  if (match) {
    const yyyy = parseInt(match[1], 10) >= 50 ? 1900 + +match[1] : 2000 + +match[1];
    return new Date(yyyy, +match[2] - 1, +match[3]);
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  return null;
}

function calcAge(birthDate) {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) age--;
  return age;
}

function parseAlterRule(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d+)([+-])$/);
  if (!m) return null;
  return {operator: m[2], value: parseInt(m[1], 10)};
}

function checkAlter(alterRaw, birthDate) {
  if (!alterRaw) return null;
  const rule = parseAlterRule(alterRaw);
  if (!rule) return null;
  const age = calcAge(birthDate);
  if (rule.operator === "+") {
    if (age < rule.value) return `Altersvoraussetzung nicht erfüllt: mindestens ${rule.value} Jahre erforderlich (aktuell: ${age})`;
  } else if (rule.operator === "-") {
    if (age >= rule.value) return `Altersvoraussetzung nicht erfüllt: unter ${rule.value} Jahre erforderlich (aktuell: ${age})`;
  }
  return null;
}

function checkGeschlecht(geschlechtRaw, playerGeschlechtId) {
  if (!geschlechtRaw || String(geschlechtRaw).trim() === "") return null;
  const allowedIds = String(geschlechtRaw).split(",").map((s) => s.trim()).filter(Boolean);
  if (allowedIds.length === 0) return null;
  if (!allowedIds.includes(String(playerGeschlechtId).trim())) {
    return "Dein Geschlecht ist für diesen Bewerb nicht zugelassen.";
  }
  return null;
}

export async function addEntryListData(sheets, {bewerbId, personenId, datum}) {
  const values = await readEntryListData(sheets);

  if (values.length > 1) {
    const header = values[0].map((h) => String(h || "").trim().toLowerCase());
    const bewerbIdx = header.findIndex((h) => {
      const bNames = ["bewerbid", "bewerb id", "bewerb-id", "bewerb", "bewerbsid", "bewerbs id"];
      return bNames.includes(h);
    });
    const personenIdx = header.findIndex((h) => {
      const names = ["personenid", "personen id", "personen-id", "personid",
        "person id", "playerid", "player id", "spielerid", "spieler id"];
      return names.includes(h);
    });

    if (bewerbIdx !== -1 && personenIdx !== -1) {
      const alreadyRegistered = values.slice(1).some((r) =>
        String(r[bewerbIdx] || "").trim() === bewerbId &&
        String(r[personenIdx] || "").trim() === personenId);
      if (alreadyRegistered) throw new Error("Du bist für diesen Bewerb bereits eingetragen.");
    }
  }

  const [bewerbRes, playerRes] = await Promise.all([
    sheets.spreadsheets.values.get({spreadsheetId: SHEET_ID, range: "Bewerb!A:Z"}),
    sheets.spreadsheets.values.get({spreadsheetId: SHEET_ID, range: "Personen!A:Z"}),
  ]);

  const bewerbValues = bewerbRes.data.values || [];
  const playerValues = playerRes.data.values || [];

  if (bewerbValues.length >= 2) {
    const bHeader = bewerbValues[0].map((h) => h.trim().toLowerCase());
    const bIdIdx = bHeader.indexOf("id");
    const bEntryStartIdx = bHeader.indexOf("entrystart");
    const bEntryDeadlineIdx = bHeader.indexOf("entrydeadline");
    const bGeschlechtIdx = bHeader.indexOf("geschlecht");
    const bAlterIdx = bHeader.indexOf("alterskategorie");

    console.log(`[addEntryList] Bewerb header: id=${bIdIdx} geschlecht=${bGeschlechtIdx} alter=${bAlterIdx}`);

    if (bIdIdx !== -1) {
      const bewerbRow = bewerbValues.slice(1).find((r) => String(r[bIdIdx] || "").trim() === String(bewerbId).trim());
      if (bewerbRow) {
        if (bEntryStartIdx !== -1 && bewerbRow[bEntryStartIdx]) {
          const start = parseSheetDate(bewerbRow[bEntryStartIdx]);
          if (start && new Date() < start) {
            throw new Error(`Eintragungsliste beginnt erst am ${formatSimpleDate(start)}.`);
          }
        }
        if (bEntryDeadlineIdx !== -1 && bewerbRow[bEntryDeadlineIdx]) {
          const end = parseSheetDate(bewerbRow[bEntryDeadlineIdx]);
          if (end && new Date() > end) {
            throw new Error(`Eintragungsliste endete am ${formatSimpleDate(end)}.`);
          }
        }
      }
      if (bewerbRow && (bGeschlechtIdx !== -1 || bAlterIdx !== -1) && playerValues.length >= 2) {
        const pHeader = playerValues[0].map((h) => h.trim().toLowerCase());
        const pIdIdx = pHeader.indexOf("id");
        const pGeschlechtIdx = pHeader.indexOf("geschlechtid");
        const pBirthIdx = pHeader.indexOf("geburtsdatum");

        console.log(`[addEntryList] Personen header: id=${pIdIdx} geschlechtid=${pGeschlechtIdx} geburtsdatum=${pBirthIdx}`);

        if (pIdIdx !== -1) {
          const playerRow = playerValues.slice(1).find((r) => String(r[pIdIdx] || "").trim() === String(personenId).trim());
          if (playerRow) {
            console.log(`[addEntryList] Player found, birthVal="${playerRow[pBirthIdx]}" alterVal="${bewerbRow[bAlterIdx]}"`);
            if (bGeschlechtIdx !== -1 && pGeschlechtIdx !== -1) {
              const err = checkGeschlecht(bewerbRow[bGeschlechtIdx], playerRow[pGeschlechtIdx]);
              if (err) throw new Error(err);
            }
            if (bAlterIdx !== -1 && pBirthIdx !== -1) {
              const birthDate = parseBirthdate(playerRow[pBirthIdx]);
              console.log(`[addEntryList] parseBirthdate result: ${birthDate}`);
              if (birthDate) {
                const err = checkAlter(bewerbRow[bAlterIdx], birthDate);
                console.log(`[addEntryList] alterRule="${bewerbRow[bAlterIdx]}" checkResult="${err}"`);
                if (err) throw new Error(err);
              }
            }
          } else {
            console.log(`[addEntryList] Player row NOT found for personenId="${personenId}"`);
          }
        }
      } else {
        console.log(`[addEntryList] Skip: row=${!!bewerbRow} cols=${bGeschlechtIdx !== -1 || bAlterIdx !== -1}`);
      }
    }
  } else {
    console.log(`[addEntryList] bewerbValues too short: ${bewerbValues.length}`);
  }

  let nextId = 1;
  if (values.length > 1) {
    const idIdx = values[0].findIndex((h) => h.trim().toLowerCase() === "id");
    if (idIdx !== -1) {
      const numericIds = values.slice(1).map((r) => parseInt(r[idIdx], 10)).filter((n) => !isNaN(n));
      nextId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
    } else {
      nextId = values.length;
    }
  }

  console.log(`[addEntryList] Writing entry: id=${nextId} bewerb=${bewerbId} person=${personenId} datum=${datum}`);

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "EntryList",
    valueInputOption: "USER_ENTERED",
    requestBody: {values: [[nextId, bewerbId, personenId, datum]]},
  });
  console.log(`[addEntryList] Append response: ${JSON.stringify(appendRes.status)}`);
  return {id: nextId};
}

export const addEntryList = onCall({region: "europe-west3"}, async (request) => {
  try {
    const sheets = await getSheetsClient(false);
    const result = await addEntryListData(sheets, request.data);
    const pmap = await buildPlayerMap(sheets);
    const bmap = await buildBewerbMap(sheets);
    logEntry({sheets, source: "addEntryList", entry: `Nennung: ${fmtPlayer(request.data?.personenId, pmap)} in Bewerb ${fmtBewerb(request.data?.bewerbId, bmap)}`});
    return {success: true, ...result};
  } catch (err) {
    console.error("Fehler in addEntryList:", err);
    return {success: false, error: err.message};
  }
});

export async function removeEntryListData(sheets, {bewerbId, personenId}) {
  const spreadsheet = await sheets.spreadsheets.get({spreadsheetId: SHEET_ID});
  const entrySheet = spreadsheet.data.sheets.find((s) => s.properties.title === "EntryList");
  if (!entrySheet) throw new Error("Tabelle EntryList nicht gefunden");
  const sheetId = entrySheet.properties.sheetId;

  const values = await readEntryListData(sheets);
  if (values.length < 2) throw new Error("Keine Einträge gefunden");

  const header = values[0].map((h) => String(h || "").trim().toLowerCase());
  const bewerbIdx = header.findIndex((h) => {
    const names = ["bewerbid", "bewerb id", "bewerb-id", "bewerb", "bewerbsid", "bewerbs id"];
    return names.includes(h);
  });
  const personenIdx = header.findIndex((h) => {
    const names = ["personenid", "personen id", "personen-id", "personid",
      "person id", "playerid", "player id", "spielerid", "spieler id"];
    return names.includes(h);
  });

  if (bewerbIdx === -1 || personenIdx === -1) throw new Error("Spalten nicht gefunden");

  const rowIndex = values.findIndex((r, i) =>
    i > 0 &&
    String(r[bewerbIdx] || "").trim() === String(bewerbId).trim() &&
    String(r[personenIdx] || "").trim() === String(personenId).trim());

  if (rowIndex === -1) throw new Error("Kein passender Eintrag gefunden");

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1},
        },
      }],
    },
  });
}

export const removeEntryList = onCall({region: "europe-west3"}, async (request) => {
  try {
    const sheets = await getSheetsClient(false);
    await removeEntryListData(sheets, request.data);
    const pmap = await buildPlayerMap(sheets);
    const bmap = await buildBewerbMap(sheets);
    logEntry({sheets, source: "removeEntryList", entry: `Nennung entfernt: ${fmtPlayer(request.data?.personenId, pmap)} in Bewerb ${fmtBewerb(request.data?.bewerbId, bmap)}`});
    return {success: true};
  } catch (err) {
    console.error("Fehler in removeEntryList:", err);
    return {success: false, error: err.message};
  }
});
