import { getUser, subscribeAuth } from "./authClient.js";
import { createEndpoint, getOperationId, releaseOperationId, subscribe } from "./dataClient.js";
import { diagnostic } from "./diagnostics.js";

const readFavorites = createEndpoint("myFavorites");
const writeFavorites = createEndpoint("setMyFavorites");
const readCompetitions = createEndpoint("bewerbe");
const readHallTimeGrids = createEndpoint("hallTimeGrids");
const listeners = new Set();
const buttonUpdaters = new Set();
const channel = "BroadcastChannel" in window ? new BroadcastChannel("epiber-favorites") : null;

const PAGE_CONFIG = Object.freeze({
  "index.html": { page: "index", label: "Dashboard", selector: "#welcome-title", centered: true },
  "Matches1.html": { page: "Matches1", label: "Matches", selector: "main > section > h2", centered: true },
  "players.html": { page: "players", label: "Spieler", selector: "main > section > h2", centered: true },
  "Bewerbe.html": { page: "Bewerbe", label: "Bewerbe", selector: ".bewerbe-page-heading > h2", existingRow: true },
  "scoreboard.html": { page: "scoreboard", label: "Scoreboard", selector: "#platz1", scoreboard: true },
  "RoundRobin.html": { page: "RoundRobin", label: "Gruppenphase", selector: "#roundRobinHeading", centered: true },
  "entryList.html": { page: "entryList", label: "Eintragungsliste", selector: "#entryListHeading", centered: true },
  "rangliste.html": { page: "rangliste", label: "Rangliste", selector: "#rankingSection > h2", centered: true },
  "bewerbsRaster.html": { page: "bewerbsRaster", label: "Turnierraster", selector: "#bracketHeading", centered: true },
  "hallzeiten.html": { page: "hallzeiten", label: "Hallenzeiten", selector: "#hall-time-title", existingRow: true },
  "adminLogging.html": { page: "adminLogging", label: "Frontend-Logging", selector: "#logging-app .logging-heading h1" },
  "personenNormalisieren.html": { page: "personenNormalisieren", label: "Datenpflege", selector: "#normalization-app .normalization-heading h1" },
  "mitgliederAbgleichen.html": { page: "mitgliederAbgleichen", label: "Mitgliederabgleich", selector: "#reconciliation-app .normalization-heading h1" },
  "servicebereich.html": { page: "servicebereich", label: "Servicebereich", selector: "#service-app .service-heading h1" },
  "hallzeitenVerwalten.html": { page: "hallzeitenVerwalten", label: "Hallenzeiten verwalten", selector: "#hall-time-admin-app .hall-time-admin-heading h1" },
  "navigator.html": { page: "navigator", label: "Monitorsteuerung", selector: "#navigator-app .navigator-title-block h1" },
  "monitor.html": { page: "monitor", label: "Monitor", selector: "#monitor-stage", floating: true },
});

const PAGE_LABELS = Object.freeze(Object.fromEntries(Object.values(PAGE_CONFIG).map(({ page, label }) => [page, label])));
const ADMIN_PAGES = new Set(["adminLogging", "personenNormalisieren", "mitgliederAbgleichen", "servicebereich", "hallzeitenVerwalten"]);
const OPERATOR_PAGES = new Set(["navigator"]);
const PARAMETERIZED_PAGES = new Set(["RoundRobin", "entryList", "rangliste", "bewerbsRaster", "hallzeiten"]);
let state = { identity: null, favorites: [], revision: 0, loading: false, ready: false };
let loadGeneration = 0;
let competitionGeneration = 0;
let mutationQueue = Promise.resolve();
let competitionNames = new Map();
let hallTimeNames = new Map();
let unreadMessageCount = 0;

const OVERLAY_LABELS = Object.freeze({
  "match-result": "Ergebnis eingeben",
  "match-appointment": "Termin festlegen / ändern",
  profile: "Profil",
});

function notify() {
  const snapshot = favoriteSnapshot();
  for (const listener of listeners) listener(snapshot);
}

function favoriteErrorMessage(error, fallback) {
  return error?.message || error?.error?.message || fallback;
}

function userHasRole(user, role) {
  return user?.role === role || (Array.isArray(user?.roles) && user.roles.includes(role));
}

function pageFile() {
  return window.location.pathname.split("/").pop() || "index.html";
}

function currentPageTarget(config) {
  const params = new URLSearchParams(window.location.search);
  const target = { type: "page", page: config.page };
  if (PARAMETERIZED_PAGES.has(config.page)) {
    const id = String(params.get("id") || "").trim();
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) return null;
    target.params = { id };
    if (config.page === "RoundRobin" && params.has("paarungslayout")) {
      const layout = Number(params.get("paarungslayout"));
      if (Number.isInteger(layout) && layout >= 0 && layout <= 5) target.params.paarungslayout = layout;
    }
  } else if (config.page === "navigator") {
    const profil = String(params.get("profil") || "").trim();
    if (/^[A-Za-z0-9_.:-]{1,32}$/.test(profil)) target.params = { profil };
  }
  return target;
}

function comparableTarget(target) {
  if (target?.type === "overlay") return `overlay:${target.overlay}`;
  if (target?.type !== "page") return "";
  const params = target.params || {};
  return `page:${target.page}:${Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&")}`;
}

function isSameTarget(left, right) {
  return comparableTarget(left) === comparableTarget(right);
}

async function loadForUser(user, { force = false } = {}) {
  const identity = user?.id ? String(user.id) : null;
  if (!identity) {
    loadGeneration += 1;
    competitionGeneration += 1;
    competitionNames = new Map();
    hallTimeNames = new Map();
    state = { identity: null, favorites: [], revision: 0, loading: false, ready: true };
    notify();
    return;
  }
  if (!force && state.identity === identity && (state.loading || state.ready)) return;
  const generation = ++loadGeneration;
  state = { identity, favorites: [], revision: 0, loading: true, ready: false };
  notify();
  try {
    const response = await readFavorites();
    if (generation !== loadGeneration || String(getUser()?.id || "") !== identity) return;
    const data = response.data;
    state = {
      identity,
      favorites: Array.isArray(data?.favorites) ? data.favorites : [],
      revision: Number.isInteger(data?.revision) ? data.revision : 0,
      loading: false,
      ready: true,
    };
    notify();
    loadCompetitionNames(identity, state.favorites);
  } catch (error) {
    if (generation !== loadGeneration) return;
    state = { identity, favorites: [], revision: 0, loading: false, ready: false };
    diagnostic.error("favorites_load_failed", error);
    notify();
  }
}

async function loadCompetitionNames(identity = state.identity, favorites = state.favorites) {
  const competitionIds = new Set(favorites.filter(({ page }) => page !== "hallzeiten").map((favorite) => String(favorite?.params?.id || "")).filter(Boolean));
  const hallTimeIds = new Set(favorites.filter(({ page }) => page === "hallzeiten").map((favorite) => String(favorite?.params?.id || "")).filter(Boolean));
  const generation = ++competitionGeneration;
  if (!identity || (!competitionIds.size && !hallTimeIds.size)) {
    if (competitionNames.size || hallTimeNames.size) {
      competitionNames = new Map();
      hallTimeNames = new Map();
      notify();
    }
    return;
  }
  try {
    const [competitionResponse, hallTimeResponse] = await Promise.all([
      competitionIds.size ? readCompetitions() : Promise.resolve({ data: { values: [] } }),
      hallTimeIds.size ? readHallTimeGrids() : Promise.resolve({ data: { grids: [] } }),
    ]);
    if (generation !== competitionGeneration || state.identity !== identity) return;
    const values = competitionResponse.data?.values;
    if (competitionIds.size) {
      if (!Array.isArray(values) || !Array.isArray(values[0])) throw new Error("Bewerbe sind nicht verfügbar.");
      const header = values[0].map((value) => String(value || "").trim().toLowerCase());
      const idIndex = header.indexOf("id");
      const nameIndex = header.indexOf("bezeichnung");
      if (idIndex < 0 || nameIndex < 0) throw new Error("Bewerbsnamen sind unvollständig.");
      competitionNames = new Map(values.slice(1).flatMap((row) => {
        const id = String(row[idIndex] || "").trim();
        const name = String(row[nameIndex] || "").trim();
        return competitionIds.has(id) && name ? [[id, name]] : [];
      }));
    } else competitionNames = new Map();
    hallTimeNames = new Map((hallTimeResponse.data?.grids || []).filter(({ id }) => hallTimeIds.has(String(id))).map(({ id, name }) => [String(id), String(name)]));
    notify();
  } catch (error) {
    if (generation !== competitionGeneration || state.identity !== identity) return;
    diagnostic.error("favorite_labels_load_failed", error);
  }
}

async function saveNow(identity, nextFavorites) {
  if (!state.identity || state.identity !== identity || String(getUser()?.id || "") !== identity) throw new Error("Benutzersitzung wurde geändert.");
  const previous = state;
  const operationKey = `favorites:${state.identity}:${state.revision}:${JSON.stringify(nextFavorites)}`;
  try {
    const response = await writeFavorites({
      operationId: getOperationId(operationKey),
      expectedRevision: previous.revision,
      favorites: nextFavorites.map(({ targetId, ...target }) => target),
    });
    const data = response.data;
    releaseOperationId(operationKey);
    if (state.identity !== identity || String(getUser()?.id || "") !== identity) return favoriteSnapshot();
    if (Number.isInteger(data?.revision) && data.revision < state.revision) return favoriteSnapshot();
    state = {
      identity: previous.identity,
      favorites: Array.isArray(data?.favorites) ? data.favorites : nextFavorites,
      revision: Number.isInteger(data?.revision) ? data.revision : previous.revision + 1,
      loading: false,
      ready: true,
    };
    notify();
    loadCompetitionNames(identity, state.favorites);
    channel?.postMessage({ identity: state.identity, revision: state.revision });
    return favoriteSnapshot();
  } catch (error) {
    releaseOperationId(operationKey, error);
    if (state.identity !== identity || String(getUser()?.id || "") !== identity) throw error;
    diagnostic.error("favorites_save_failed", error);
    if (error?.code === "REVISION_CONFLICT") loadForUser(getUser(), { force: true });
    throw error;
  }
}

function mutateFavorites(buildNext) {
  const identity = String(getUser()?.id || "");
  if (!identity) return Promise.reject(new Error("Bitte zuerst anmelden."));
  const execute = async () => {
    if (state.identity !== identity || !state.ready) throw new Error("Favoriten werden noch geladen.");
    return saveNow(identity, buildNext(state.favorites.map((favorite) => ({ ...favorite }))));
  };
  const operation = mutationQueue.catch(() => {}).then(execute);
  mutationQueue = operation.catch(() => {});
  return operation;
}

export function favoriteSnapshot() {
  return { ...state, favorites: state.favorites.map((favorite) => ({ ...favorite, params: favorite.params ? { ...favorite.params } : undefined })) };
}

export function subscribeFavorites(listener) {
  listeners.add(listener);
  listener(favoriteSnapshot());
  return () => listeners.delete(listener);
}

export function isFavorite(target) {
  return state.favorites.some((favorite) => isSameTarget(favorite, target));
}

export async function toggleFavorite(target) {
  return mutateFavorites((favorites) => favorites.some((favorite) => isSameTarget(favorite, target))
    ? favorites.filter((favorite) => !isSameTarget(favorite, target))
    : [...favorites, target]);
}

export async function reorderFavorites(targetIds) {
  return mutateFavorites((favorites) => {
    const byId = new Map(favorites.map((favorite) => [favorite.targetId, favorite]));
    const visibleIds = favorites.filter((favorite) => favoriteVisibleForUser(favorite)).map((favorite) => favorite.targetId);
    if (targetIds.length !== visibleIds.length || new Set(targetIds).size !== visibleIds.length || targetIds.some((id) => !visibleIds.includes(id))) {
      throw new Error("Favoritenreihenfolge ist unvollständig.");
    }
    const orderedVisible = targetIds.map((id) => byId.get(id));
    let visibleIndex = 0;
    return favorites.map((favorite) => visibleIds.includes(favorite.targetId) ? orderedVisible[visibleIndex++] : favorite);
  });
}

export function favoriteVisibleForUser(target, user = getUser()) {
  if (!user || target?.type === "overlay") return Boolean(user);
  if (ADMIN_PAGES.has(target.page)) return userHasRole(user, "admin");
  if (OPERATOR_PAGES.has(target.page)) return userHasRole(user, "operator") || userHasRole(user, "admin");
  return true;
}

export function favoriteLabel(target) {
  if (target?.type === "overlay") {
    if (target.overlay === "profile-messages") return `Meldungen (${unreadMessageCount})`;
    return OVERLAY_LABELS[target.overlay] || "Aktion";
  }
  if (target?.page === "Bewerbe" && target?.params?.history === "all") return "Historie aller Bewerbe";
  if (target?.page === "Bewerbe" && target?.params?.history === "competition") {
    const competitionName = competitionNames.get(String(target.params.id || ""));
    return competitionName ? `Historie – ${competitionName}` : "Bewerbshistorie";
  }
  if (target?.page === "hallzeiten") return hallTimeNames.get(String(target?.params?.id || "")) || "Hallenzeiten";
  const base = PAGE_LABELS[target?.page] || "Seite";
  const id = target?.params?.id;
  return id ? competitionNames.get(String(id)) || base : base;
}

export function favoriteHasUnreadMessages(target) {
  return target?.type === "overlay" && target.overlay === "profile-messages" && unreadMessageCount > 0;
}

export function favoriteHref(target) {
  if (target?.type !== "page") return "#";
  if (target.page === "index") return "index.html?dashboard=1";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(target.params || {})) params.set(key, String(value));
  return `${target.page}.html${params.size ? `?${params}` : ""}`;
}

export function refreshFavoriteButtons() {
  for (const update of buttonUpdaters) update();
}

export function createFavoriteButton(targetOrProvider, { className = "" } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `favorite-star${className ? ` ${className}` : ""}`;
  button.innerHTML = '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="m233-120 65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Z"></path></svg>';
  const target = () => typeof targetOrProvider === "function" ? targetOrProvider() : targetOrProvider;
  const update = () => {
    const currentTarget = target();
    const active = currentTarget ? isFavorite(currentTarget) : false;
    const authenticated = Boolean(getUser());
    button.hidden = !authenticated || !currentTarget;
    button.disabled = authenticated && Boolean(currentTarget) && !state.ready;
    button.classList.toggle("is-favorite", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen");
    button.title = active ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen";
  };
  buttonUpdaters.add(update);
  subscribeFavorites(update);
  button.addEventListener("click", async () => {
    const currentTarget = target();
    if (!currentTarget) return;
    button.disabled = true;
    try {
      await toggleFavorite(currentTarget);
    } catch (error) {
      window.showToast?.(favoriteErrorMessage(error, "Favorit konnte nicht gespeichert werden."), "error");
    } finally {
      update();
    }
  });
  update();
  return button;
}

function mountPageFavorite() {
  const config = PAGE_CONFIG[pageFile()];
  if (!config || document.querySelector(".page-favorite-star")) return;
  const target = currentPageTarget(config);
  const anchor = document.querySelector(config.selector);
  if (!target || !anchor) return;
  const button = createFavoriteButton(target, { className: "page-favorite-star" });
  if (config.scoreboard) {
    anchor.appendChild(button);
    return;
  }
  if (config.floating) {
    anchor.appendChild(button);
    return;
  }
  if (config.existingRow) {
    anchor.parentElement.classList.add("favorite-title-row");
    anchor.insertAdjacentElement("afterend", button);
    return;
  }
  const row = document.createElement("div");
  row.className = `favorite-title-row${config.centered ? " favorite-title-row-centered" : ""}`;
  anchor.parentElement.insertBefore(row, anchor);
  row.append(anchor, button);
}

subscribeAuth((user, authState) => {
  if (authState.status === "authenticated") loadForUser(user);
  else if (authState.status === "anonymous") loadForUser(null);
});

channel?.addEventListener("message", (event) => {
  if (event.data?.identity === state.identity && event.data?.revision !== state.revision) loadForUser(getUser(), { force: true });
});

subscribe("bewerbe", () => loadCompetitionNames());
subscribe("hall-times", () => loadCompetitionNames());

window.addEventListener("epiber-message-summary", (event) => {
  const nextCount = Math.max(0, Number(event.detail?.unreadCount) || 0);
  if (nextCount === unreadMessageCount) return;
  unreadMessageCount = nextCount;
  notify();
});

mountPageFavorite();
