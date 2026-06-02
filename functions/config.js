import {google} from "googleapis";

export const SHEET_ID = "11LgQskt3buVDS881NlsT4HW2tEeoZWvYT0fTT8VH1lk";

export async function getSheetsClient(readonly = true) {
  const scopes = readonly ?
    ["https://www.googleapis.com/auth/spreadsheets.readonly"] :
    ["https://www.googleapis.com/auth/spreadsheets"];
  const auth = new google.auth.GoogleAuth({scopes});
  return google.sheets({version: "v4", auth});
}
