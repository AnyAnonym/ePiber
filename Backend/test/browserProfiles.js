const { chromium, devices, firefox, webkit } = require("playwright");

const profiles = Object.freeze({
  "chrome-windows": {
    label: "Chrome (Windows Desktop)",
    browserType: chromium,
    contextOptions: { viewport: { width: 1366, height: 768 } },
  },
  "chrome-android": {
    label: "Chrome (Android)",
    browserType: chromium,
    contextOptions: devices["Pixel 7"],
  },
  "safari-iphone": {
    label: "Safari (iPhone)",
    browserType: webkit,
    contextOptions: devices["iPhone 13"],
  },
  "safari-ipad": {
    label: "Safari (iPad)",
    browserType: webkit,
    contextOptions: devices["iPad Pro 11"],
  },
  "safari-macos": {
    label: "Safari (macOS)",
    browserType: webkit,
    contextOptions: { viewport: { width: 1440, height: 900 } },
  },
  "firefox-windows": {
    label: "Firefox (Windows)",
    browserType: firefox,
    contextOptions: { viewport: { width: 1366, height: 768 } },
  },
  "edge-windows": {
    label: "Edge (Windows)",
    browserType: chromium,
    contextOptions: { viewport: { width: 1366, height: 768 } },
  },
});

function selectedProfile() {
  const name = process.env.PLAYWRIGHT_PROFILE;
  if (!name) return null;
  const profile = profiles[name];
  if (!profile) throw new Error(`Unbekanntes PLAYWRIGHT_PROFILE: ${name}`);
  return profile;
}

function hasSelectedProfile() {
  return selectedProfile() !== null;
}

async function launchSelectedBrowser(fallbackExecutablePath) {
  const profile = selectedProfile();
  if (profile) return profile.browserType.launch({ headless: true });
  return chromium.launch({ executablePath: fallbackExecutablePath, headless: true });
}

function newProfilePage(browser, overrides = {}) {
  const profile = selectedProfile();
  return browser.newPage(profile ? { ...profile.contextOptions, ...overrides } : overrides);
}

module.exports = {
  hasSelectedProfile,
  launchSelectedBrowser,
  newProfilePage,
  profiles,
};
