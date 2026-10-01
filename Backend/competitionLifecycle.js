function parseCompetitionEnd(raw) {
  const value = String(raw || "").trim();
  if (!value) return { present: false, valid: true, endAt: null };
  const match = value.match(/^(\d{2}|\d{4})(\d{2})(\d{2})(?:-(\d{2})(\d{2}))?$/);
  if (!match) return { present: true, valid: false, endAt: null };
  const [, yearValue, monthValue, dayValue, hourValue, minuteValue] = match;
  const year = yearValue.length === 2
    ? (Number(yearValue) >= 50 ? 1900 + Number(yearValue) : 2000 + Number(yearValue))
    : Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = hourValue === undefined ? 23 : Number(hourValue);
  const minute = minuteValue === undefined ? 59 : Number(minuteValue);
  const second = hourValue === undefined ? 59 : 0;
  const date = new Date(year, month - 1, day, hour, minute, second);
  const valid = date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hour
    && date.getMinutes() === minute;
  return { present: true, valid, endAt: valid ? date.getTime() : null };
}

function competitionLifecycle(raw, now = Date.now()) {
  const parsed = parseCompetitionEnd(raw);
  const nowValue = now instanceof Date ? now.getTime() : Number(now);
  return {
    ...parsed,
    competitionEndAt: parsed.endAt,
    competitionEnded: Boolean(parsed.valid && parsed.endAt !== null && parsed.endAt < nowValue),
  };
}

module.exports = { competitionLifecycle, parseCompetitionEnd };
