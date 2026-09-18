import { diagnostic } from "./diagnostics.js";

// ── Konfiguration (hier anpassen) ──
const RETRY_MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 750;
const TRANSIENT_CODES = new Set([
  "CONNECTION_LOST",
  "DATA_NOT_READY",
  "HTTP_TIMEOUT",
  "INTERNAL_ERROR",
  "PERSON_DATA_UNAVAILABLE",
  "REQUEST_TIMEOUT",
  "SHUTTING_DOWN",
]);

// ── Retry-Logik für asynchrone Backend-Aufrufe ──

export async function callWithRetry(fn, args = {}, opts = {}) {
  const maxAttempts = opts.maxAttempts || RETRY_MAX_ATTEMPTS;
  const baseDelay = opts.baseDelay || RETRY_BASE_DELAY_MS;

  const retryable = (error) => TRANSIENT_CODES.has(error?.code) || Number(error?.status) >= 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fn(args);
      if (res.data?.success !== false) return res;
      const error = new Error(res.data?.error?.message || "Backend-Anfrage fehlgeschlagen");
      error.code = res.data?.error?.code || "REQUEST_FAILED";
      throw error;
    } catch (err) {
      if (attempt < maxAttempts && retryable(err)) {
        const wait = Math.floor(baseDelay * (2 ** (attempt - 1)) * (0.8 + Math.random() * 0.4));
        diagnostic.warn("frontend_retry_scheduled", {
          attempt,
          maxAttempts,
          retryInMs: wait,
          error: err,
        });
        await delay(wait);
      } else {
        throw err;
      }
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Lade-Overlay ──

const loadingOverlays = new WeakMap();

function loadingScope(scope) {
  return scope instanceof Element ? scope : document.body;
}

function initialLoadingOverlay(target) {
  return target.querySelector?.(".loading-overlay[data-initial-loading-overlay]") || null;
}

export function showLoadingOverlay(_text = "Lade Daten ...", scope = document.body) {
  const target = loadingScope(scope);
  const activeOverlay = loadingOverlays.get(target);
  if (activeOverlay) return activeOverlay;

  const initialOverlay = initialLoadingOverlay(target);
  if (initialOverlay) {
    target.setAttribute("aria-busy", "true");
    loadingOverlays.set(target, initialOverlay);
    return initialOverlay;
  }

  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-atomic", "true");
  if (target !== document.body) {
    target.classList.add("loading-overlay-scope");
    overlay.classList.add("loading-overlay-scoped");
  }

  const content = document.createElement("div");
  content.className = "loading-overlay-content";

  const spinner = document.createElement("div");
  spinner.className = "loading-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const textElement = document.createElement("div");
  textElement.className = "loading-text";
  textElement.textContent = "Lade Daten ...";

  content.append(spinner, textElement);
  overlay.appendChild(content);
  target.appendChild(overlay);
  target.setAttribute("aria-busy", "true");
  loadingOverlays.set(target, overlay);
  return overlay;
}

export function hideLoadingOverlay(scope = document.body) {
  const target = loadingScope(scope);
  const activeOverlay = loadingOverlays.get(target) || initialLoadingOverlay(target);
  if (!activeOverlay) return;
  loadingOverlays.delete(target);
  activeOverlay.remove();
  target.removeAttribute("aria-busy");
  if (target !== document.body) target.classList.remove("loading-overlay-scope");
}

export function showErrorOverlay(message = "Fehler beim Laden der Daten", reloadFn = null) {
  hideLoadingOverlay();
  const overlay = document.createElement("div");
  overlay.className = "loading-overlay error";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-live", "assertive");

  const content = document.createElement("div");
  content.className = "loading-overlay-content";

  const icon = document.createElement("div");
  icon.className = "loading-error-icon";
  icon.textContent = "!";

  const textElement = document.createElement("div");
  textElement.className = "loading-text";
  textElement.textContent = message;

  content.append(icon, textElement);
  const actionButton = document.createElement("button");
  actionButton.className = "loading-retry-btn";
  actionButton.textContent = reloadFn ? "Erneut laden" : "Schließen";
  actionButton.addEventListener("click", () => {
    overlay.remove();
    reloadFn?.();
  });
  content.appendChild(actionButton);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
  document.body.removeAttribute("aria-busy");
  actionButton.focus();
}

export function errorMessage(error, fallback = "Fehler beim Laden der Daten") {
  const message = String(error?.message || fallback);
  if (!error?.supportId || message.includes(error.supportId)) return message;
  return `${message} (Referenz: ${error.supportId})`;
}
