import { getUser, ready, subscribeAuth } from "./authClient.js";
import { createEndpoint, getOperationId, releaseOperationId } from "./dataClient.js";
import { diagnostic } from "./diagnostics.js";

const readStartPage = createEndpoint("myStartPage");
const writeStartPage = createEndpoint("setMyStartPage");
const listeners = new Set();
const channel = "BroadcastChannel" in window ? new BroadcastChannel("epiber-start-page") : null;
const DEFAULT_TARGET = Object.freeze({ type: "page", page: "index" });

let state = { identity: null, target: DEFAULT_TARGET, revision: 0, loading: false, ready: false };
let loadGeneration = 0;
let mutationQueue = Promise.resolve();

function cloneTarget(target) {
  return { ...target, params: target?.params ? { ...target.params } : undefined };
}

function notify() {
  const snapshot = startPageSnapshot();
  for (const listener of listeners) listener(snapshot);
}

export function startTargetKey(target) {
  if (target?.type === "overlay") return `overlay:${target.overlay}`;
  if (target?.type !== "page") return "";
  const params = target.params || {};
  return `page:${target.page}:${Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&")}`;
}

export function startTargetHref(target) {
  if (target?.type === "overlay") {
    const params = new URLSearchParams({ favoriteOverlay: target.overlay });
    return `index.html?${params}`;
  }
  if (target?.type !== "page") return "index.html";
  if (target.page === "index") return "index.html";
  if (target.page === "favorites") return "favorites.html";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(target.params || {})) params.set(key, String(value));
  return `${target.page}.html${params.size ? `?${params}` : ""}`;
}

export function startPageSnapshot() {
  return { ...state, target: cloneTarget(state.target) };
}

export function subscribeStartPage(listener) {
  listeners.add(listener);
  listener(startPageSnapshot());
  return () => listeners.delete(listener);
}

export async function loadStartPage({ force = false } = {}) {
  const identity = String(getUser()?.id || "");
  if (!identity) {
    loadGeneration += 1;
    state = { identity: null, target: DEFAULT_TARGET, revision: 0, loading: false, ready: true };
    notify();
    return startPageSnapshot();
  }
  if (!force && state.identity === identity && state.ready) return startPageSnapshot();
  const generation = ++loadGeneration;
  state = { identity, target: DEFAULT_TARGET, revision: 0, loading: true, ready: false };
  notify();
  try {
    const response = await readStartPage();
    if (generation !== loadGeneration || String(getUser()?.id || "") !== identity) return startPageSnapshot();
    const data = response.data;
    state = {
      identity,
      target: data?.target || DEFAULT_TARGET,
      revision: Number.isInteger(data?.revision) ? data.revision : 0,
      loading: false,
      ready: true,
    };
    notify();
    return startPageSnapshot();
  } catch (error) {
    if (generation !== loadGeneration) return startPageSnapshot();
    state = { identity, target: DEFAULT_TARGET, revision: 0, loading: false, ready: false };
    diagnostic.error("start_page_load_failed", error);
    notify();
    throw error;
  }
}

export function setStartPage(target) {
  const identity = String(getUser()?.id || "");
  if (!identity) return Promise.reject(new Error("Bitte zuerst anmelden."));
  const execute = async () => {
    if (state.identity !== identity || !state.ready) await loadStartPage();
    const previous = startPageSnapshot();
    const operationKey = `start-page:${identity}:${previous.revision}:${JSON.stringify(target)}`;
    try {
      const response = await writeStartPage({
        operationId: getOperationId(operationKey),
        expectedRevision: previous.revision,
        target,
      });
      const data = response.data;
      releaseOperationId(operationKey);
      if (String(getUser()?.id || "") !== identity) return startPageSnapshot();
      state = {
        identity,
        target: data?.target || target,
        revision: Number.isInteger(data?.revision) ? data.revision : previous.revision + 1,
        loading: false,
        ready: true,
      };
      notify();
      channel?.postMessage({ identity, revision: state.revision });
      return startPageSnapshot();
    } catch (error) {
      releaseOperationId(operationKey, error);
      diagnostic.error("start_page_save_failed", error);
      if (error?.code === "REVISION_CONFLICT") loadStartPage({ force: true }).catch(() => {});
      throw error;
    }
  };
  const operation = mutationQueue.catch(() => {}).then(execute);
  mutationQueue = operation.catch(() => {});
  return operation;
}

export async function navigateToPersonalStart({ replace = false } = {}) {
  await ready;
  if (!getUser()) return;
  let snapshot;
  try {
    snapshot = await loadStartPage();
  } catch {
    snapshot = { target: DEFAULT_TARGET };
  }
  const href = startTargetHref(snapshot.target);
  const current = `${window.location.pathname.split("/").pop() || "index.html"}${window.location.search}`;
  if (current === href) return;
  if (replace) window.location.replace(href);
  else window.location.assign(href);
}

subscribeAuth((user, authState) => {
  if (authState.status === "authenticated") loadStartPage().catch(() => {});
  else if (authState.status === "anonymous") {
    state = { identity: null, target: DEFAULT_TARGET, revision: 0, loading: false, ready: true };
    notify();
  }
});

channel?.addEventListener("message", (event) => {
  if (event.data?.identity === state.identity && event.data?.revision !== state.revision) {
    loadStartPage({ force: true }).catch(() => {});
  }
});
