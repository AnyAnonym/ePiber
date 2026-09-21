import { hasRole, ready, subscribeAuth } from "./authClient.js";
import { createEndpoint, subscribe } from "./dataClient.js";
import { HISTORY_ICON_PATH } from "./materialSymbols.js";
import {
  favoriteHref,
  favoriteLabel,
  favoriteVisibleForUser,
  reorderFavorites,
  subscribeFavorites,
} from "./favorites.js";

const readMyMessageSummary = createEndpoint("myMessageSummary");
const readHallTimeGrids = createEndpoint("hallTimeGrids");
let stopMessageSubscription = null;
let messageIdentity = null;
let summaryGeneration = 0;

const currentPath = window.location.pathname.split("/").pop() || "index.html";

const mobileNavIcons = {
  menu: "M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z",
  close: "m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z",
  person: "M367-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q560-607 560-640t-23.5-56.5Q513-720 480-720t-56.5 23.5Q400-673 400-640t23.5 56.5Q447-560 480-560t56.5-23.5ZM480-640Zm0 400Z",
  star: "m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z",
  history: HISTORY_ICON_PATH,
  dashboard: "M520-600v-240h320v240H520ZM120-440v-400h320v400H120Zm400 320v-400h320v400H520Zm-400 0v-240h320v240H120Zm80-400h160v-240H200v240Zm400 320h160v-240H600v240Zm0-480h160v-80H600v80ZM200-200h160v-80H200v80Zm160-320Zm240-160Zm0 240ZM360-280Z",
  emoji_events: "M280-120v-80h160v-124q-49-11-87.5-41.5T296-442q-75-9-125.5-65.5T120-640v-40q0-33 23.5-56.5T200-760h80v-80h400v80h80q33 0 56.5 23.5T840-680v40q0 76-50.5 132.5T664-442q-18 46-56.5 76.5T520-324v124h160v80H280Zm0-408v-152h-80v40q0 38 22 68.5t58 43.5Zm285 93q35-35 35-85v-240H360v240q0 50 35 85t85 35q50 0 85-35Zm115-93q36-13 58-43.5t22-68.5v-40h-80v152Zm-200-52Z",
  expand_more: "M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z",
  sports_tennis: "m137-160-57-56 164-164q31-31 42.5-77.5T298-600q0-58 26-114t74-104q91-91 201-103t181 61q72 72 60 182T738-478q-48 48-104 74t-114 26q-97 0-142 11t-77 43L137-160Zm275-334q47 46 127 34t143-75q64-64 76.5-143.5T724-803q-48-48-125.5-36T456-763q-63 63-76.5 142.5T412-494ZM607-87q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113T833-87q-47 47-113 47T607-87Zm169.5-56.5Q800-167 800-200t-23.5-56.5Q753-280 720-280t-56.5 23.5Q640-233 640-200t23.5 56.5Q687-120 720-120t56.5-23.5ZM720-200Z",
  swords: "M762-96 645-212l-88 88-28-28q-23-23-23-57t23-57l169-169q23-23 57-23t57 23l28 28-88 88 116 117q12 12 12 28t-12 28l-50 50q-12 12-28 12t-28-12Zm118-628L426-270l5 4q23 23 23 57t-23 57l-28 28-88-88L198-96q-12 12-28 12t-28-12l-50-50q-12-12-12-28t12-28l116-117-88-88 28-28q23-23 57-23t57 23l4 5 454-454h160v160ZM334-583l24-23 23-24-23 24-24 23Zm-56 57L80-724v-160h160l198 198-57 56-174-174h-47v47l174 174-56 57Zm92 199 430-430v-47h-47L323-374l47 47Zm0 0-24-23-23-24 23 24 24 23Z",
  scoreboard: "M620-360q-17 0-28.5-11.5T580-400v-160q0-17 11.5-28.5T620-600h100q17 0 28.5 11.5T760-560v160q0 17-11.5 28.5T720-360H620Zm20-60h60v-120h-60v120Zm-440 60v-100q0-17 11.5-28.5T240-500h80v-40H200v-60h140q17 0 28.5 11.5T380-560v60q0 17-11.5 28.5T340-460h-80v40h120v60H200Zm250-160v-60h60v60h-60Zm0 140v-60h60v60h-60ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h120v-80h80v80h240v-80h80v80h120q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h290v-60h60v60h290v-480H510v60h-60v-60H160v480Zm0 0v-480 480Z",
  calendar_clock: "M360-400q-17 0-28.5-11.5T320-440q0-17 11.5-28.5T360-480q17 0 28.5 11.5T400-440q0 17-11.5 28.5T360-400Zm-160 0q-17 0-28.5-11.5T160-440q0-17 11.5-28.5T200-480q17 0 28.5 11.5T240-440q0 17-11.5 28.5T200-400Zm0 160q-17 0-28.5-11.5T160-280q0-17 11.5-28.5T200-320q17 0 28.5 11.5T240-280q0 17-11.5 28.5T200-240Zm280 160q-83 0-141.5-58.5T280-280q0-83 58.5-141.5T480-480q83 0 141.5 58.5T680-280q0 83-58.5 141.5T480-80Zm66-106 28-28-74-74v-112h-40v128l86 86ZM120-560v-200q0-33 23.5-56.5T200-840h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-760v280h-80v-80H120Zm80-200v120h560v-120H200Z",
  groups: "M0-240v-63q0-43 44-70t116-27q13 0 25 .5t23 2.5q-14 21-21 44t-7 48v65H0Zm240 0v-65q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v65H240Zm540 0v-65q0-26-6.5-49T754-397q11-2 22.5-2.5t23.5-.5q72 0 116 26.5t44 70.5v63H780Zm-455-80h311q-10-20-55.5-35T480-370q-55 0-100.5 15T325-320ZM160-440q-33 0-56.5-23.5T80-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T160-440Zm640 0q-33 0-56.5-23.5T720-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T800-440Zm-320-40q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm0-80q17 0 28.5-11.5T520-600q0-17-11.5-28.5T480-640q-17 0-28.5 11.5T440-600q0 17 11.5 28.5T480-560Zm1 240Zm-1-280Z",
  person_search: "M440-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-80q33 0 56.5-23.5T520-640q0-33-23.5-56.5T440-720q-33 0-56.5 23.5T360-640q0 33 23.5 56.5T440-560ZM884-20 756-148q-21 12-45 20t-51 8q-75 0-127.5-52.5T480-300q0-75 52.5-127.5T660-480q75 0 127.5 52.5T840-300q0 27-8 51t-20 45L940-76l-56 56ZM731-229q29-29 29-71t-29-71q-29-29-71-29t-71 29q-29 29-29 71t29 71q29 29 71 29t71-29Zm-611 69v-111q0-34 17-63t47-44q51-26 115-44t142-18q-12 18-20.5 38.5T407-359q-60 5-107 20.5T221-306q-10 5-15.5 14.5T200-271v31h207q5 22 13.5 42t20.5 38H120Zm320-480Zm-33 400Z",
  admin_panel_settings: "M722.5-297.5Q740-315 740-340t-17.5-42.5Q705-400 680-400t-42.5 17.5Q620-365 620-340t17.5 42.5Q655-280 680-280t42.5-17.5ZM680-160q31 0 57-14.5t42-38.5q-22-13-47-20t-52-7q-27 0-52 7t-47 20q16 24 42 38.5t57 14.5ZM480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v227q-19-8-39-14.5t-41-9.5v-147l-240-90-240 90v188q0 47 12.5 94t35 89.5Q310-290 342-254t71 60q11 32 29 61t41 52q-1 0-1.5.5t-1.5.5Zm200 0q-83 0-141.5-58.5T480-280q0-83 58.5-141.5T680-480q83 0 141.5 58.5T880-280q0 83-58.5 141.5T680-80ZM480-494Z",
  database: "M480-120q-151 0-255.5-46.5T120-280v-400q0-66 105.5-113T480-840q149 0 254.5 47T840-680v400q0 67-104.5 113.5T480-120Zm0-479q89 0 179-25.5T760-679q-11-29-100.5-55T480-760q-91 0-178.5 25.5T200-679q14 30 101.5 55T480-599Zm0 199q42 0 81-4t74.5-11.5q35.5-7.5 67-18.5t57.5-25v-120q-26 14-57.5 25t-67 18.5Q600-528 561-524t-81 4q-42 0-82-4t-75.5-11.5Q287-543 256-554t-56-25v120q25 14 56 25t66.5 18.5Q358-408 398-404t82 4Zm0 200q46 0 93.5-7t87.5-18.5q40-11.5 67-26t32-29.5v-98q-26 14-57.5 25t-67 18.5Q600-328 561-324t-81 4q-42 0-82-4t-75.5-11.5Q287-343 256-354t-56-25v99q5 15 31.5 29t66.5 25.5q40 11.5 88 18.5t94 7Z",
  sync: "M160-160v-80h110l-16-14q-52-46-73-105t-21-119q0-111 66.5-197.5T400-790v84q-72 26-116 88.5T240-478q0 45 17 87.5t53 78.5l10 10v-98h80v240H160Zm400-10v-84q72-26 116-88.5T720-482q0-45-17-87.5T650-648l-10-10v98h-80v-240h240v80H690l16 14q49 49 71.5 106.5T800-482q0 111-66.5 197.5T560-170Z",
  description: "M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z",
  dns: "M300-720q-25 0-42.5 17.5T240-660q0 25 17.5 42.5T300-600q25 0 42.5-17.5T360-660q0-25-17.5-42.5T300-720Zm0 400q-25 0-42.5 17.5T240-260q0 25 17.5 42.5T300-200q25 0 42.5-17.5T360-260q0-25-17.5-42.5T300-320ZM160-840h640q17 0 28.5 11.5T840-800v280q0 17-11.5 28.5T800-480H160q-17 0-28.5-11.5T120-520v-280q0-17 11.5-28.5T160-840Zm40 80v200h560v-200H200Zm-40 320h640q17 0 28.5 11.5T840-400v280q0 17-11.5 28.5T800-80H160q-17 0-28.5-11.5T120-120v-280q0-17 11.5-28.5T160-440Zm40 80v200h560v-200H200Zm0-400v200-200Zm0 400v200-200Z",
  monitoring: "M120-120v-80l80-80v160h-80Zm160 0v-240l80-80v320h-80Zm160 0v-320l80 81v239h-80Zm160 0v-239l80-80v319h-80Zm160 0v-400l80-80v480h-80ZM120-327v-113l280-280 160 160 280-280v113L560-447 400-607 120-327Z",
  edit: "M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56ZM620-620l-29-28 57 57-28-29Z",
  drag_handle: "M160-250v-80h640v80H160Zm0-190v-80h640v80H160Zm0-190v-80h640v80H160Z",
  login: "M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z",
  logout: "M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z",
};

export function mobileNavIcon(name, className = "mobile-nav-icon") {
  return `<svg class="${className}" data-icon="${name}" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="${mobileNavIcons[name]}"></path></svg>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function favoriteIconName(favorite) {
  if (favorite.type === "overlay") return favorite.overlay === "match-result" ? "sports_tennis" : "description";
  if (favorite.page === "Bewerbe" && favorite.params?.history) return "history";
  return {
    index: "dashboard", Matches1: "sports_tennis", players: "person_search", Bewerbe: "swords", scoreboard: "scoreboard",
    adminLogging: "description", personenNormalisieren: "database", mitgliederAbgleichen: "sync", servicebereich: "dns",
    hallzeiten: "calendar_clock", hallzeitenVerwalten: "calendar_clock", navigator: "monitoring", monitor: "monitoring",
  }[favorite.page] || "emoji_events";
}

function renderMobileFavorites(favorites = []) {
  if (!favorites.length) return "";
  return `
    <div class="mobile-nav-favorites mobile-nav-group" aria-label="Favoriten">
      <div class="mobile-nav-favorites-heading">
        <button class="mobile-nav-row mobile-nav-main-row mobile-nav-group-toggle mobile-nav-favorites-toggle" type="button" aria-expanded="false" aria-controls="mobileNavFavorites">
          ${mobileNavIcon("star")}
          <span>Favoriten</span>
          ${mobileNavIcon("expand_more", "mobile-nav-chevron")}
        </button>
        <button class="mobile-nav-favorites-edit" type="button" aria-label="Favoritenreihenfolge bearbeiten" aria-pressed="false">${mobileNavIcon("edit")}</button>
      </div>
      <div id="mobileNavFavorites" class="mobile-nav-submenu" role="group" aria-label="Favoriten" hidden>
        ${favorites.map((favorite) => {
          const label = favoriteLabel(favorite);
          const safeLabel = escapeHtml(label);
          const attributes = favorite.type === "page"
            ? `href="${favoriteHref(favorite)}"`
            : `href="#" data-favorite-overlay="${favorite.overlay}"`;
          return `<div class="mobile-nav-row mobile-nav-main-row mobile-nav-favorite" data-favorite-id="${favorite.targetId}">
            <button class="mobile-nav-drag-handle" type="button" tabindex="-1" aria-label="${safeLabel} verschieben">${mobileNavIcon("drag_handle")}</button>
            <a ${attributes} class="mobile-nav-favorite-link" aria-label="${safeLabel}" title="${safeLabel}">
              ${mobileNavIcon(favoriteIconName(favorite), "mobile-nav-icon mobile-nav-favorite-icon")}
              <span>${safeLabel}</span>
            </a>
          </div>`;
        }).join("")}
        <p class="sr-only mobile-nav-favorites-announcement" aria-live="polite"></p>
      </div>
    </div>
  `;
}

function activeClass(file) {
  return currentPath === file ? "active" : "";
}

function renderHeader() {
  const headerContainer = document.getElementById("header-container");
  if (!headerContainer) return;

  headerContainer.innerHTML = `
    <header>
      <nav id="mainNav" class="main-nav desktop-nav">
        <a href="index.html?dashboard=1" class="${activeClass("index.html")}">Dashboard</a>
        <a href="players.html" class="${activeClass("players.html")}" data-auth="required" hidden>Spieler</a>
        <a href="Matches1.html" class="${activeClass("Matches1.html")}">Matches</a>
        <a href="Bewerbe.html" class="${activeClass("Bewerbe.html")}">Bewerbe</a>
        <a href="scoreboard.html" class="${activeClass("scoreboard.html")}">Scoreboard</a>
        <div id="desktopHallTimes" class="desktop-hall-times" hidden><button type="button">Hallenzeiten</button><div id="desktopHallTimeLinks" class="desktop-hall-time-links"></div></div>
        <a href="personenNormalisieren.html" class="${activeClass("personenNormalisieren.html")}" data-role="admin" hidden>Datenpflege</a>
        <a href="mitgliederAbgleichen.html" class="${activeClass("mitgliederAbgleichen.html")}" data-role="admin" hidden>Mitgliederabgleich</a>
        <a href="adminLogging.html" class="${activeClass("adminLogging.html")}" data-role="admin" hidden>Logging</a>
        <a href="servicebereich.html" class="${activeClass("servicebereich.html")}" data-role="admin" hidden>Servicebereich</a>
        <a href="hallzeitenVerwalten.html" class="${activeClass("hallzeitenVerwalten.html")}" data-role="admin" hidden>Hallenzeiten verwalten</a>
        <a href="https://epiber.at/grafana/" data-role="admin" hidden>Grafana</a>
      </nav>

      <div class="header-center">
        <a href="/" class="logo" aria-label="Zur persönlichen Startseite">ASKÖ Piberbach</a>
        <button class="hamburger" id="hamburgerBtn" type="button" aria-label="Menü öffnen" aria-controls="mobileNavModal" aria-expanded="false">${mobileNavIcon("menu")}</button>
      </div>

      <nav class="auth-nav desktop-auth">
        <a href="#" id="openLogin" class="loggedOut" hidden style="display: none;">Anmelden</a>
        <a href="#" id="profileButton" class="loggedIn profile-link" hidden style="display: none;">Profil<span class="message-count-badge" hidden></span></a>
        <a href="#" id="signOutButton" class="loggedIn" hidden style="display: none;">Abmelden</a>
        <span class="authUnavailable" role="status" hidden></span>
      </nav>
    </header>
  `;
}

function renderMobileNav() {
  const mobileNavContainer = document.getElementById("mobile-nav-container");
  if (!mobileNavContainer) return;
  const favorites = [];

  mobileNavContainer.innerHTML = `
    <div id="mobileNavModal" class="mobile-nav-drawer hidden" aria-hidden="true">
      <aside class="mobile-nav-content" role="dialog" aria-modal="true" aria-label="Navigation">
        <div class="mobile-nav-header">
          <button class="mobile-nav-close" type="button" aria-label="Menü schließen">${mobileNavIcon("close")}</button>
          <strong>ePiber</strong>
        </div>
        <div class="mobile-nav-scroll">
          <nav class="mobile-auth-section" aria-label="Benutzerkonto">
            <a href="#" id="openLoginMobile" class="loggedOut mobile-nav-row mobile-login-action" hidden style="display: none;">
              ${mobileNavIcon("login")}
              <span>Anmelden</span>
            </a>
            <span class="authUnavailable" role="status" hidden></span>
            <a href="#" id="profileButtonMobile" class="loggedIn profile-link mobile-nav-row mobile-profile-row" hidden style="display: none;">
              ${mobileNavIcon("person")}
              <span>Profil</span>
              <span class="message-count-badge" hidden></span>
            </a>
          </nav>
          ${renderMobileFavorites(favorites)}
          <nav class="mobile-nav-main" aria-label="Seitennavigation">
            <a href="index.html?dashboard=1" class="mobile-nav-row mobile-nav-main-row ${activeClass("index.html")}">
              ${mobileNavIcon("dashboard")}
              <span>Dashboard</span>
            </a>

            <div class="mobile-nav-group">
              <button class="mobile-nav-row mobile-nav-main-row mobile-nav-group-toggle" type="button" aria-expanded="false" aria-controls="mobileNavCompetition">
                ${mobileNavIcon("emoji_events")}
                <span>Spielbetrieb</span>
                ${mobileNavIcon("expand_more", "mobile-nav-chevron")}
              </button>
              <div id="mobileNavCompetition" class="mobile-nav-submenu" role="group" aria-label="Spielbetrieb" hidden>
                <a href="Matches1.html" class="mobile-nav-row mobile-nav-main-row ${activeClass("Matches1.html")}">${mobileNavIcon("sports_tennis")}<span>Matches</span></a>
                <a href="Bewerbe.html" class="mobile-nav-row mobile-nav-main-row ${activeClass("Bewerbe.html")}">${mobileNavIcon("swords")}<span>Bewerbe</span></a>
                <a href="scoreboard.html" class="mobile-nav-row mobile-nav-main-row ${activeClass("scoreboard.html")}">${mobileNavIcon("scoreboard")}<span>Scoreboard</span></a>
                <div id="mobileHallTimes" class="mobile-nav-group mobile-nav-nested-group" hidden>
                  <button class="mobile-nav-row mobile-nav-main-row mobile-nav-group-toggle" type="button" aria-expanded="false" aria-controls="mobileHallTimeLinks">${mobileNavIcon("calendar_clock")}<span>Hallenzeiten</span>${mobileNavIcon("expand_more", "mobile-nav-chevron")}</button>
                  <div id="mobileHallTimeLinks" class="mobile-nav-submenu" role="group" aria-label="Hallenzeiten" hidden></div>
                </div>
              </div>
            </div>

            <div class="mobile-nav-group" data-auth="required" hidden>
              <button class="mobile-nav-row mobile-nav-main-row mobile-nav-group-toggle" type="button" aria-expanded="false" aria-controls="mobileNavClub">
                ${mobileNavIcon("groups")}
                <span>Verein</span>
                ${mobileNavIcon("expand_more", "mobile-nav-chevron")}
              </button>
              <div id="mobileNavClub" class="mobile-nav-submenu" role="group" aria-label="Verein" hidden>
                <a href="players.html" class="mobile-nav-row mobile-nav-main-row ${activeClass("players.html")}">${mobileNavIcon("person_search")}<span>Spieler</span></a>
              </div>
            </div>

            <div class="mobile-nav-group" data-role="admin" hidden>
              <button class="mobile-nav-row mobile-nav-main-row mobile-nav-group-toggle" type="button" aria-expanded="false" aria-controls="mobileNavAdministration">
                ${mobileNavIcon("admin_panel_settings")}
                <span>Administration</span>
                ${mobileNavIcon("expand_more", "mobile-nav-chevron")}
              </button>
              <div id="mobileNavAdministration" class="mobile-nav-submenu" role="group" aria-label="Administration" hidden>
                <a href="personenNormalisieren.html" class="mobile-nav-row mobile-nav-main-row ${activeClass("personenNormalisieren.html")}">${mobileNavIcon("database")}<span>Datenpflege</span></a>
                <a href="mitgliederAbgleichen.html" class="mobile-nav-row mobile-nav-main-row ${activeClass("mitgliederAbgleichen.html")}">${mobileNavIcon("sync")}<span>Mitgliederabgleich</span></a>
                <a href="adminLogging.html" class="mobile-nav-row mobile-nav-main-row ${activeClass("adminLogging.html")}">${mobileNavIcon("description")}<span>Logging</span></a>
                <a href="servicebereich.html" class="mobile-nav-row mobile-nav-main-row ${activeClass("servicebereich.html")}">${mobileNavIcon("dns")}<span>Servicebereich</span></a>
                <a href="hallzeitenVerwalten.html" class="mobile-nav-row mobile-nav-main-row ${activeClass("hallzeitenVerwalten.html")}">${mobileNavIcon("calendar_clock")}<span>Hallenzeiten verwalten</span></a>
                <a href="https://epiber.at/grafana/" class="mobile-nav-row mobile-nav-main-row">${mobileNavIcon("monitoring")}<span>Grafana</span></a>
              </div>
            </div>
          </nav>
          <a href="#" id="signOutButtonMobile" class="loggedIn mobile-nav-row mobile-logout-action" hidden style="display: none;">
            ${mobileNavIcon("logout")}
            <span>Abmelden</span>
          </a>
        </div>
      </aside>
    </div>
  `;
}

function updateMobileFavorites(favorites) {
  const scroll = document.querySelector(".mobile-nav-scroll");
  const main = scroll?.querySelector(".mobile-nav-main");
  if (!scroll || !main) return;
  const previous = scroll.querySelector(".mobile-nav-favorites");
  const expanded = previous?.querySelector(".mobile-nav-favorites-toggle")?.getAttribute("aria-expanded") === "true";
  const editing = previous?.classList.contains("is-editing") || false;
  const focusedId = document.activeElement?.closest?.(".mobile-nav-favorite")?.dataset.favoriteId || null;
  previous?.remove();
  const visible = favorites.filter((favorite) => favoriteVisibleForUser(favorite));
  if (!visible.length) return;
  main.insertAdjacentHTML("beforebegin", renderMobileFavorites(visible));
  const current = scroll.querySelector(".mobile-nav-favorites");
  const toggle = current.querySelector(".mobile-nav-favorites-toggle");
  const submenu = current.querySelector(".mobile-nav-submenu");
  current.classList.toggle("is-editing", editing);
  toggle.setAttribute("aria-expanded", String(expanded || editing));
  submenu.hidden = !(expanded || editing);
  const editButton = current.querySelector(".mobile-nav-favorites-edit");
  editButton.setAttribute("aria-pressed", String(editing));
  editButton.setAttribute("aria-label", editing ? "Bearbeitung der Favoriten beenden" : "Favoritenreihenfolge bearbeiten");
  updateFavoriteDragLabels(current);
  if (focusedId) current.querySelector(`[data-favorite-id="${focusedId}"] .mobile-nav-drag-handle`)?.focus();
}

function updateFavoriteDragLabels(container) {
  const rows = [...container.querySelectorAll(".mobile-nav-favorite")];
  rows.forEach((row, index) => {
    const label = row.querySelector(".mobile-nav-favorite-link span")?.textContent || "Favorit";
    const handle = row.querySelector(".mobile-nav-drag-handle");
    handle.tabIndex = container.classList.contains("is-editing") ? 0 : -1;
    handle.setAttribute("aria-label", `${label}, Position ${index + 1} von ${rows.length}, mit Pfeiltasten verschieben`);
  });
}

function announceFavoritePosition(container, row) {
  updateFavoriteDragLabels(container);
  const rows = [...container.querySelectorAll(".mobile-nav-favorite")];
  const position = rows.indexOf(row) + 1;
  const label = row.querySelector(".mobile-nav-favorite-link span")?.textContent || "Favorit";
  const announcement = container.querySelector(".mobile-nav-favorites-announcement");
  if (announcement) announcement.textContent = `${label} ist jetzt an Position ${position} von ${rows.length}.`;
}

function createAppShiftLayer() {
  if (document.querySelector(".app-shift-layer")) return;
  const headerContainer = document.getElementById("header-container");
  if (!headerContainer || headerContainer.parentElement !== document.body) return;
  const layer = document.createElement("div");
  layer.className = "app-shift-layer";
  document.body.insertBefore(layer, headerContainer);
  [...document.body.children].forEach((element) => {
    if (
      element === layer
      || element.id === "mobile-nav-container"
      || element.tagName === "SCRIPT"
      || element.matches(".modal, .diagnostic-mode-notice, .toast-container")
    ) return;
    layer.appendChild(element);
  });
}

function setAuthControlVisibility(element, visible) {
  element.hidden = !visible;
  if (!visible) {
    element.style.display = "none";
    return;
  }
  element.style.display = element.classList.contains("mobile-nav-row")
    ? "flex"
    : element.closest(".mobile-auth-section") ? "block" : "inline";
}

function renderAuthState(user, authState = {}) {
  const authenticated = Boolean(user);
  const resolved = ["authenticated", "anonymous"].includes(authState.status);

  document.querySelectorAll(".loggedIn").forEach((element) => {
    setAuthControlVisibility(element, resolved && authenticated);
  });
  document.querySelectorAll(".loggedOut").forEach((element) => {
    setAuthControlVisibility(element, resolved && !authenticated);
  });
  document.querySelectorAll('[data-auth="required"]').forEach((element) => {
    element.hidden = !resolved || !authenticated;
  });
  document.querySelectorAll('[data-role="admin"]').forEach((element) => {
    element.hidden = !resolved || !hasRole("admin");
  });
  document.querySelectorAll(".authUnavailable").forEach((element) => {
    const visible = !resolved;
    element.hidden = !visible;
    element.style.display = visible ? "inline" : "none";
    element.textContent = authState.status === "unavailable" ? "Anmeldung nicht erreichbar" : "Anmeldung wird geprüft";
  });
}

let hallTimeMenuGeneration = 0;
let hallTimeMenuUser = null;
async function updateHallTimeNavigation(user) {
  const generation = ++hallTimeMenuGeneration;
  const desktop = document.getElementById("desktopHallTimes");
  const mobile = document.getElementById("mobileHallTimes");
  if (!user) {
    if (desktop) desktop.hidden = true;
    if (mobile) mobile.hidden = true;
    return;
  }
  try {
    const response = await readHallTimeGrids();
    if (generation !== hallTimeMenuGeneration) return;
    const grids = Array.isArray(response.data?.grids) ? response.data.grids : [];
    const mobileLinks = grids.map(({ id, name }) => `<a href="hallzeiten.html?id=${encodeURIComponent(id)}" class="mobile-nav-row mobile-nav-main-row">${mobileNavIcon("calendar_clock")}<span>${escapeHtml(name)}</span></a>`).join("");
    const desktopLinks = grids.map(({ id, name }) => `<a href="hallzeiten.html?id=${encodeURIComponent(id)}">${escapeHtml(name)}</a>`).join("");
    const mobileTarget = document.getElementById("mobileHallTimeLinks");
    const desktopTarget = document.getElementById("desktopHallTimeLinks");
    if (mobileTarget) mobileTarget.innerHTML = mobileLinks;
    if (desktopTarget) desktopTarget.innerHTML = desktopLinks;
    if (desktop) desktop.hidden = grids.length === 0;
    if (mobile) mobile.hidden = grids.length === 0;
  } catch {
    if (desktop) desktop.hidden = true;
    if (mobile) mobile.hidden = true;
  }
}

function setMessageCount(rawCount, revision = null) {
  const count = Math.max(0, Number(rawCount) || 0);
  const hamburgerButton = document.getElementById("hamburgerBtn");
  hamburgerButton?.classList.toggle("has-unread-messages", count > 0);
  hamburgerButton?.setAttribute("aria-label", count ? `Menü öffnen, ${count} ungelesene Meldungen` : "Menü öffnen");
  document.querySelectorAll(".profile-link").forEach((link) => {
    const badge = link.querySelector(".message-count-badge");
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }
    link.setAttribute("aria-label", count ? `Profil, ${count} ungelesene Meldungen` : "Profil");
  });
  window.dispatchEvent(new CustomEvent("epiber-message-summary", {
    detail: { unreadCount: count, revision },
  }));
}

async function refreshMessageSummary(identity = messageIdentity) {
  const generation = ++summaryGeneration;
  if (!identity) {
    setMessageCount(0);
    return;
  }
  try {
    const result = await readMyMessageSummary();
    if (generation !== summaryGeneration || identity !== messageIdentity || !result.data?.success) return;
    setMessageCount(result.data.unreadCount, result.data.revision);
  } catch {
    // Keep the last known count during a temporary connection failure.
  }
}

function updateMessageSubscription(user) {
  const identity = user?.id ? String(user.id) : null;
  if (identity === messageIdentity) return;
  stopMessageSubscription?.();
  stopMessageSubscription = null;
  messageIdentity = identity;
  summaryGeneration += 1;
  if (!identity) {
    setMessageCount(0);
    return;
  }
  stopMessageSubscription = subscribe(`messages:${identity}`, () => refreshMessageSummary(identity));
  refreshMessageSummary(identity);
}

function initMobileNavigation() {
  const hamburgerButton = document.getElementById("hamburgerBtn");
  const mobileNavModal = document.getElementById("mobileNavModal");
  const appLayer = document.querySelector(".app-shift-layer");
  const closeButton = mobileNavModal?.querySelector(".mobile-nav-close");
  if (!hamburgerButton || !mobileNavModal || !appLayer || !closeButton) return;

  const openNavigation = () => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    mobileNavModal.querySelectorAll(".mobile-nav-group-toggle").forEach((toggle) => {
      toggle.setAttribute("aria-expanded", "false");
      const submenu = document.getElementById(toggle.getAttribute("aria-controls"));
      if (submenu) submenu.hidden = true;
    });
    mobileNavModal.classList.remove("hidden");
    mobileNavModal.setAttribute("aria-hidden", "false");
    hamburgerButton.setAttribute("aria-expanded", "true");
    appLayer.inert = true;
    document.body.classList.add("mobile-nav-open");
    closeButton.focus({ preventScroll: true });
    window.scrollTo(scrollX, scrollY);
  };

  const closeNavigation = ({ restoreFocus = true } = {}) => {
    if (mobileNavModal.classList.contains("hidden")) return;
    mobileNavModal.classList.add("hidden");
    mobileNavModal.setAttribute("aria-hidden", "true");
    hamburgerButton.setAttribute("aria-expanded", "false");
    appLayer.inert = false;
    document.body.classList.remove("mobile-nav-open");
    if (restoreFocus) hamburgerButton.focus({ preventScroll: true });
  };

  hamburgerButton.addEventListener("click", openNavigation);
  closeButton.addEventListener("click", () => closeNavigation());

  mobileNavModal.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".mobile-nav-drag-handle")) {
      event.preventDefault();
      return;
    }
    const editButton = event.target.closest(".mobile-nav-favorites-edit");
    if (editButton) {
      const favorites = mobileNavModal.querySelector(".mobile-nav-favorites");
      const toggle = favorites?.querySelector(".mobile-nav-favorites-toggle");
      const submenu = favorites?.querySelector(".mobile-nav-submenu");
      const editing = favorites?.classList.toggle("is-editing") || false;
      editButton.setAttribute("aria-pressed", String(editing));
      editButton.setAttribute("aria-label", editing ? "Bearbeitung der Favoriten beenden" : "Favoritenreihenfolge bearbeiten");
      if (editing) {
        toggle?.setAttribute("aria-expanded", "true");
        if (submenu) submenu.hidden = false;
      }
      if (favorites) updateFavoriteDragLabels(favorites);
      return;
    }
    if (event.target === mobileNavModal) closeNavigation();
    const groupToggle = event.target.closest(".mobile-nav-group-toggle");
    if (groupToggle) {
      const submenu = document.getElementById(groupToggle.getAttribute("aria-controls"));
      const expanded = groupToggle.getAttribute("aria-expanded") === "true";
      groupToggle.setAttribute("aria-expanded", String(!expanded));
      if (submenu) submenu.hidden = expanded;
      return;
    }
    const overlayLink = event.target.closest("[data-favorite-overlay]");
    if (overlayLink) {
      event.preventDefault();
      closeNavigation();
      window.openFavoriteMatchAction?.(overlayLink.dataset.favoriteOverlay);
      return;
    }
    const link = event.target.closest(".mobile-nav-content a");
    if (link) closeNavigation({ restoreFocus: !link.closest(".mobile-nav-main, .mobile-nav-favorites") });
  });

  let draggedRow = null;
  let dragPointerId = null;
  let dragOriginalOrder = null;
  let dragClientY = null;
  let dragScrollFrame = null;
  const autoScrollFavorites = () => {
    if (!draggedRow || dragClientY === null) {
      dragScrollFrame = null;
      return;
    }
    const scroll = mobileNavModal.querySelector(".mobile-nav-scroll");
    const bounds = scroll.getBoundingClientRect();
    if (dragClientY < bounds.top + 56) scroll.scrollBy({ top: -12 });
    else if (dragClientY > bounds.bottom - 56) scroll.scrollBy({ top: 12 });
    dragScrollFrame = requestAnimationFrame(autoScrollFavorites);
  };
  mobileNavModal.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".mobile-nav-drag-handle");
    if (!handle || !handle.closest(".mobile-nav-favorites.is-editing")) return;
    event.preventDefault();
    draggedRow = handle.closest(".mobile-nav-favorite");
    dragPointerId = event.pointerId;
    dragClientY = event.clientY;
    dragOriginalOrder = [...draggedRow.parentElement.querySelectorAll(".mobile-nav-favorite")].map((row) => row.dataset.favoriteId);
    handle.setPointerCapture?.(event.pointerId);
    draggedRow?.classList.add("is-dragging");
    if (!dragScrollFrame) dragScrollFrame = requestAnimationFrame(autoScrollFavorites);
  });
  mobileNavModal.addEventListener("pointermove", (event) => {
    if (!draggedRow || event.pointerId !== dragPointerId) return;
    dragClientY = event.clientY;
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest(".mobile-nav-favorite");
    if (!row || row === draggedRow || row.parentElement !== draggedRow.parentElement) return;
    const bounds = row.getBoundingClientRect();
    row.parentElement.insertBefore(draggedRow, event.clientY < bounds.top + bounds.height / 2 ? row : row.nextSibling);
  });
  const finishFavoriteDrag = async (cancelled = false) => {
    if (!draggedRow) return;
    const container = draggedRow.closest(".mobile-nav-favorites");
    const parent = draggedRow.parentElement;
    draggedRow.classList.remove("is-dragging");
    if (cancelled && dragOriginalOrder) {
      const rows = new Map([...parent.querySelectorAll(".mobile-nav-favorite")].map((row) => [row.dataset.favoriteId, row]));
      for (const id of dragOriginalOrder) parent.appendChild(rows.get(id));
    }
    if (!cancelled) announceFavoritePosition(container, draggedRow);
    draggedRow = null;
    dragPointerId = null;
    dragOriginalOrder = null;
    dragClientY = null;
    if (dragScrollFrame) cancelAnimationFrame(dragScrollFrame);
    dragScrollFrame = null;
    if (cancelled) return;
    const ids = [...mobileNavModal.querySelectorAll(".mobile-nav-favorite")].map((row) => row.dataset.favoriteId);
    try { await reorderFavorites(ids); } catch (error) { window.showToast?.(error.message || "Reihenfolge konnte nicht gespeichert werden.", "error"); }
  };
  mobileNavModal.addEventListener("pointerup", () => finishFavoriteDrag(false));
  mobileNavModal.addEventListener("pointercancel", () => finishFavoriteDrag(true));
  mobileNavModal.addEventListener("keydown", async (event) => {
    const handle = event.target.closest(".mobile-nav-drag-handle");
    if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const row = handle.closest(".mobile-nav-favorite");
    const sibling = event.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    row.parentElement.insertBefore(row, event.key === "ArrowUp" ? sibling : sibling.nextSibling);
    const container = row.closest(".mobile-nav-favorites");
    announceFavoritePosition(container, row);
    const ids = [...row.parentElement.querySelectorAll(".mobile-nav-favorite")].map((entry) => entry.dataset.favoriteId);
    try { await reorderFavorites(ids); handle.focus(); } catch (error) { window.showToast?.(error.message || "Reihenfolge konnte nicht gespeichert werden.", "error"); }
  });

  document.addEventListener("keydown", (event) => {
    if (mobileNavModal.classList.contains("hidden")) return;
    if (event.key === "Escape") {
      closeNavigation();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...mobileNavModal.querySelectorAll('a:not([hidden]), button:not([hidden]):not(:disabled)')]
      .filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

async function initNavigation() {
  createAppShiftLayer();
  renderHeader();
  renderMobileNav();
  initMobileNavigation();

  subscribeAuth((user, authState) => {
    renderAuthState(user, authState);
    updateMessageSubscription(authState.status === "authenticated" ? user : null);
    hallTimeMenuUser = authState.status === "authenticated" ? user : null;
    updateHallTimeNavigation(hallTimeMenuUser);
  });
  subscribeFavorites(({ favorites }) => updateMobileFavorites(favorites));
  window.addEventListener("epiber-message-summary-refresh", () => refreshMessageSummary());
  subscribe("hall-times", () => updateHallTimeNavigation(hallTimeMenuUser));

  await ready;
}

initNavigation();
