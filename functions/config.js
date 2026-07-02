/* eslint-disable max-len */
import {google} from "googleapis";
import {SHEET_ID} from "./backendVariables.js";

export {SHEET_ID};
// export const SHEET_ID = "11LgQskt3buVDS881NlsT4HW2tEeoZWvYT0fTT8VH1lk"; // for testing
// export const SHEET_ID = "1E1CYezDcScIBvH9ebjN0hOkvttTdA6PFIgYKDMaeE04"; // for live use

export async function getSheetsClient(readonly = true) {
  const scopes = readonly ?
    ["https://www.googleapis.com/auth/spreadsheets.readonly"] :
    ["https://www.googleapis.com/auth/spreadsheets"];
  const auth = new google.auth.GoogleAuth({scopes});
  return google.sheets({version: "v4", auth});
}
