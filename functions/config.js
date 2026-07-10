import {google} from "googleapis";
import {SHEET_ID} from "./backendVariables.js";

export {SHEET_ID};

export async function getSheetsClient(readonly = true) {
  const scopes = readonly ?
    ["https://www.googleapis.com/auth/spreadsheets.readonly"] :
    ["https://www.googleapis.com/auth/spreadsheets"];
  const auth = new google.auth.GoogleAuth({scopes});
  return google.sheets({version: "v4", auth});
}
