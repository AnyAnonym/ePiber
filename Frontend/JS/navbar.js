const currentPath = window.location.pathname.split("/").pop() || "index.html";

const pages = [
  { file: "index.html", label: "Dashboard" },
  { file: "players.html", label: "Spieler" },
  { file: "Matches1.html", label: "Matches" },
  { file: "Bewerbe.html", label: "Bewerbe" },
  { file: "scoreboard.html", label: "Scoreboard" },
];

function renderHeader() {
  const headerContainer = document.getElementById("header-container");
  if (!headerContainer) return;

  headerContainer.innerHTML = `
  <header>
    <a href="index.html" class="header-logo">ASKÖ Piberbach</a>

    <nav id="mainNav" class="main-nav desktop-nav">
      <a href="index.html" class="${currentPath === 'index.html' ? 'active' : ''}">Dashboard</a>
      <a href="players.html" class="${currentPath === 'players.html' ? 'active' : ''}" data-auth="required">Spieler</a>
      <a href="Matches1.html" class="${currentPath === 'Matches1.html' ? 'active' : ''}">Matches</a>
        <a href="Bewerbe.html" class="${currentPath === 'Bewerbe.html' ? 'active' : ''}">Bewerbe</a>
        <a href="scoreboard.html" class="${currentPath === 'scoreboard.html' ? 'active' : ''}">Scoreboard</a>
    </nav>

    <div class="header-center">
      <span class="logo">ASKÖ Piberbach</span>
      <button class="hamburger" id="hamburgerBtn">☰</button>
    </div>

    <nav class="auth-nav desktop-auth">
      <a href="#" id="openLogin" class="loggedOut">Anmelden</a>
      <a href="#" id="profileButton" class="loggedIn">Profil</a>
      <a href="#" id="signOutButton" class="loggedIn">Abmelden</a>
    </nav>
  </header>
  `;
}

function renderMobileNav() {
  const mobileNavContainer = document.getElementById("mobile-nav-container");
  if (!mobileNavContainer) return;

  mobileNavContainer.innerHTML = `
  <div id="mobileNavModal" class="modal hidden">
    <div class="modal-content mobile-nav-content">
      <span class="close">&times;</span>
      <nav class="mobile-auth-section">
        <a href="#" id="openLoginMobile" class="loggedOut">Anmelden</a>
        <a href="#" id="profileButtonMobile" class="loggedIn">Profil</a>
        <a href="#" id="signOutButtonMobile" class="loggedIn">Abmelden</a>
      </nav>
      <nav class="mobile-nav-links">
        <a href="index.html" class="${currentPath === 'index.html' ? 'active' : ''}">Dashboard</a>
        <a href="players.html" class="${currentPath === 'players.html' ? 'active' : ''}" data-auth="required">Spieler</a>
        <a href="Matches1.html" class="${currentPath === 'Matches1.html' ? 'active' : ''}">Matches</a>
        <a href="Bewerbe.html" class="${currentPath === 'Bewerbe.html' ? 'active' : ''}">Bewerbe</a>
        <a href="scoreboard.html" class="${currentPath === 'scoreboard.html' ? 'active' : ''}">Scoreboard</a>
      </nav>
    </div>
  </div>
  `;
}

function initNavigation() {
  renderHeader();
  renderMobileNav();

  const hamburgerBtn = document.getElementById("hamburgerBtn");
  const mobileNavModal = document.getElementById("mobileNavModal");

  if (hamburgerBtn && mobileNavModal) {
    hamburgerBtn.addEventListener("click", () => {
      window.scrollTo(0, 0);
      mobileNavModal.classList.remove("hidden");
    });

    mobileNavModal.querySelector(".close").addEventListener("click", () => {
      mobileNavModal.classList.add("hidden");
    });

    mobileNavModal.addEventListener("click", (e) => {
      if (e.target === mobileNavModal) {
        mobileNavModal.classList.add("hidden");
      }
    });

    mobileNavModal.querySelectorAll(".mobile-nav-links a").forEach((link) => {
      link.addEventListener("click", (e) => {
        if (!e.target.id || !e.target.id.includes("Modal")) {
          mobileNavModal.classList.add("hidden");
        }
      });
    });

    const openLoginMobile = document.getElementById("openLoginMobile");
    if (openLoginMobile) {
      openLoginMobile.addEventListener("click", (e) => {
        e.preventDefault();
        mobileNavModal.classList.add("hidden");
        if (typeof window.openLoginModal === "function") {
          window.openLoginModal();
        }
      });
    }

    const profileButtonMobile = document.getElementById("profileButtonMobile");
    if (profileButtonMobile) {
      profileButtonMobile.addEventListener("click", (e) => {
        e.preventDefault();
        mobileNavModal.classList.add("hidden");
        const profileBtn = document.getElementById("profileButton");
        if (profileBtn) profileBtn.click();
      });
    }

    const signOutButtonMobile = document.getElementById("signOutButtonMobile");
    if (signOutButtonMobile) {
      signOutButtonMobile.addEventListener("click", (e) => {
        e.preventDefault();
        mobileNavModal.classList.add("hidden");
        const signOutBtn = document.getElementById("signOutButton");
        if (signOutBtn) signOutBtn.click();
      });
    }
  }
}

initNavigation();
