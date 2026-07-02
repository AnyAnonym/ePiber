/* eslint-disable max-len */
export function formatSheetDate(raw) {
  if (!raw) return "";
  const rawStr = String(raw).trim();
  const match = rawStr.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!match) return rawStr;
  const [, yy, mm, dd, hh, mi] = match;
  const yyyy = parseInt(yy, 10) >= 50 ? "19" + yy : "20" + yy;
  return `${dd}.${mm}.${yyyy} - ${hh}:${mi}`;
}

export function formatSetScore(raw) {
  if (!raw) return "";
  return String(raw).replace(/\((\d+)\)/g, (_, tiebreak) => {
    const superscripts = {"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹"};
    const sup = tiebreak.split("").map((d) => superscripts[d] || d).join("");
    return sup;
  });
}

export function formatErgebnis(raw) {
  if (!raw) return "";
  return String(raw).split("/").map((s) => formatSetScore(s)).join("/");
}
