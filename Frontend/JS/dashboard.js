import { createEndpoint, subscribeInvalidations } from "./dataClient.js";
import { getUser, ready, subscribeAuth } from "./authClient.js";
import { diagnostic } from "./diagnostics.js";

const readMemberDirectory = createEndpoint("memberDirectory");
const DAY_MS = 24 * 60 * 60 * 1000;
const colors = ["avatar-blue", "avatar-coral", "avatar-gold", "avatar-green"];
let renderGeneration = 0;
let initialized = false;
let observedUserId = "";
let dayRefreshTimer = null;

function parseBirthDate(value) {
  const raw = String(value || "").trim();
  let match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) return { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
  match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return { day: Number(match[3]), month: Number(match[2]), year: Number(match[1]) };
  match = raw.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const shortYear = Number(match[1]);
  return { day: Number(match[3]), month: Number(match[2]), year: shortYear >= 50 ? 1900 + shortYear : 2000 + shortYear };
}

function calendarDay(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
}

function birthdayOccurrence(birthDate, today) {
  return [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]
    .map((year) => new Date(year, birthDate.month - 1, birthDate.day, 12))
    .filter((date) => date.getMonth() === birthDate.month - 1 && date.getDate() === birthDate.day)
    .sort((left, right) => Math.abs(left - today) - Math.abs(right - today))[0] || null;
}

function birthdayDescription(dayOffset, age, occurrence) {
  if (dayOffset === 0) return `wird heute ${age} Jahre`;
  if (dayOffset === -1) return `wurde gestern ${age} Jahre`;
  if (dayOffset < 0) return `wurde vor ${Math.abs(dayOffset)} Tagen ${age} Jahre`;
  if (dayOffset === 1) return `wird morgen ${age} Jahre`;
  const date = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "numeric", month: "long" }).format(occurrence);
  return `wird am ${date} ${age} Jahre`;
}

function showStatus(message, withLogin = false) {
  const status = document.getElementById("birthdayStatus");
  const list = document.getElementById("birthdayList");
  if (!status || !list) return;
  list.hidden = true;
  list.replaceChildren();
  status.hidden = false;
  status.replaceChildren(document.createTextNode(message));
  if (!withLogin) return;
  status.appendChild(document.createElement("br"));
  const loginButton = document.createElement("button");
  loginButton.type = "button";
  loginButton.className = "btn-login";
  loginButton.textContent = "Anmelden";
  loginButton.addEventListener("click", () => window.openLoginModal?.());
  status.appendChild(loginButton);
}

function initials(firstName, lastName) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toLocaleUpperCase("de-AT");
}

function renderBirthdays(values) {
  const list = document.getElementById("birthdayList");
  const status = document.getElementById("birthdayStatus");
  if (!list || !status) return;
  const header = (values[0] || []).map((value) => String(value || "").trim().toLocaleLowerCase("de-AT"));
  const index = (name) => header.indexOf(name);
  const idIndex = index("id");
  const firstNameIndex = index("vorname");
  const lastNameIndex = index("nachname");
  const birthDateIndex = index("geburtsdatum");
  const activeIndex = index("aktiv");
  const today = calendarDay();

  const birthdays = values.slice(1).flatMap((row) => {
    if (activeIndex >= 0 && String(row[activeIndex] || "").trim() !== "1") return [];
    const playerId = String(row[idIndex] || "").trim();
    const firstName = String(row[firstNameIndex] || "").trim();
    const lastName = String(row[lastNameIndex] || "").trim();
    const birthDate = parseBirthDate(row[birthDateIndex]);
    if (!playerId || !firstName || !lastName || !birthDate) return [];
    const occurrence = birthdayOccurrence(birthDate, today);
    if (!occurrence) return [];
    const dayOffset = Math.round((occurrence - today) / DAY_MS);
    if (dayOffset < -7 || dayOffset > 7) return [];
    return [{ playerId, firstName, lastName, occurrence, dayOffset, age: occurrence.getFullYear() - birthDate.year }];
  }).sort((left, right) => left.dayOffset - right.dayOffset || left.lastName.localeCompare(right.lastName, "de-AT"));

  list.replaceChildren();
  if (!birthdays.length) {
    showStatus("In den vergangenen und kommenden sieben Tagen gibt es keine eingetragenen Geburtstage.");
    return;
  }

  birthdays.forEach((birthday, position) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `birthday${birthday.dayOffset < 0 ? " birthday-past" : ""}${birthday.dayOffset === 0 ? " birthday-today" : ""}`;
    button.setAttribute("aria-label", `Profil von ${birthday.firstName} ${birthday.lastName} öffnen`);
    button.addEventListener("click", () => window.openProfileModal?.({ playerId: birthday.playerId }));
    if (birthday.dayOffset === 0) {
      const todayBadge = document.createElement("span");
      todayBadge.className = "today-badge";
      todayBadge.textContent = "Heute";
      button.appendChild(todayBadge);
    }
    const avatar = document.createElement("span");
    avatar.className = `avatar ${colors[position % colors.length]}`;
    avatar.textContent = initials(birthday.firstName, birthday.lastName);
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = `${birthday.firstName} ${birthday.lastName}`;
    const description = document.createElement("span");
    description.textContent = birthdayDescription(birthday.dayOffset, birthday.age, birthday.occurrence);
    copy.append(name, description);
    button.append(avatar, copy);
    list.appendChild(button);
  });
  status.hidden = true;
  list.hidden = false;
}

async function loadBirthdays(user = getUser()) {
  const generation = ++renderGeneration;
  if (!user) {
    showStatus("Bitte melden Sie sich an, um die Geburtstage der Mitglieder zu sehen.", true);
    return;
  }
  showStatus("Geburtstage werden geladen...");
  try {
    const result = await readMemberDirectory();
    if (generation !== renderGeneration) return;
    if (!result.data?.success) throw new Error(result.data?.error?.message || "Geburtstage konnten nicht geladen werden.");
    renderBirthdays(result.data.values || []);
  } catch (error) {
    if (generation !== renderGeneration) return;
    diagnostic.error("dashboard_birthdays_load_failed", error);
    showStatus(error?.message || "Geburtstage konnten nicht geladen werden.");
  }
}

function scheduleDayRefresh() {
  if (dayRefreshTimer) clearTimeout(dayRefreshTimer);
  const now = new Date();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  dayRefreshTimer = setTimeout(async () => {
    await loadBirthdays(getUser());
    scheduleDayRefresh();
  }, nextDay - now);
}

subscribeAuth((user) => {
  const nextUserId = String(user?.id || "");
  if (!initialized || nextUserId === observedUserId) return;
  observedUserId = nextUserId;
  loadBirthdays(user);
});

document.addEventListener("DOMContentLoaded", async () => {
  const user = await ready;
  initialized = true;
  observedUserId = String(user?.id || "");
  await loadBirthdays(user);
  subscribeInvalidations(["players"], () => loadBirthdays(getUser()));
  scheduleDayRefresh();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && initialized) loadBirthdays(getUser());
});

window.addEventListener("pagehide", () => {
  if (dayRefreshTimer) clearTimeout(dayRefreshTimer);
}, { once: true });
