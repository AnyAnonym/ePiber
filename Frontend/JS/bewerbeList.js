import { createEndpoint, getOperationId, releaseOperationId, subscribe, subscribeInvalidations } from "./dataClient.js";
import { ready, subscribeAuth } from "./authClient.js";
import { callWithRetry, showLoadingOverlay, hideLoadingOverlay, showErrorOverlay } from "./loadingHelper.js";
import { signalMonitorReady, signalMonitorFailed } from "./monitorReady.js";
import { diagnostic } from "./diagnostics.js";

const readBewerbe = createEndpoint("bewerbe");
const readBewerbsart = createEndpoint("bewerbsart");
const readCompetitionHistory = createEndpoint("competitionHistory");
const readHistoryComments = createEndpoint("competitionHistoryComments");
const readHistoryInteraction = createEndpoint("competitionHistoryInteraction");
const readHistoryCommentForEdit = createEndpoint("competitionHistoryCommentForEdit");
const readHistoryReactions = createEndpoint("competitionHistoryReactions");
const readHistoryCommentReactions = createEndpoint("competitionHistoryCommentReactions");
const addHistoryComment = createEndpoint("addCompetitionHistoryComment");
const editHistoryComment = createEndpoint("editCompetitionHistoryComment");
const deleteHistoryComment = createEndpoint("deleteCompetitionHistoryComment");
const moderateHistoryComment = createEndpoint("moderateCompetitionHistoryComment");
const setHistoryReaction = createEndpoint("setCompetitionHistoryReaction");
const setHistoryCommentReaction = createEndpoint("setCompetitionHistoryCommentReaction");
const ADMIN_RANKING_HISTORY_TYPES = new Set([
  "ranking_challenge_deleted",
  "ranking_challenge_date_changed",
  "ranking_match_date_admin_changed",
]);
let competitionBoundaryTimer = null;
let bewerbeLoadPromise = null;
let bewerbeLoadedOnce = false;
let historyButtonsVisible = false;
let historyAuthIdentity = null;
let historyRequestGeneration = 0;
const historyState = {
  open: false,
  global: false,
  bewerbId: null,
  competitionName: "",
  entries: [],
  nextCursor: null,
  loading: false,
  returnFocus: null,
  reactionCatalog: [],
  revision: 0,
};
const interactionState = {
  eventId: null,
  comments: [],
  commentsNextCursor: null,
  commentsLoading: false,
  commentsGeneration: 0,
  commentsRefreshPending: false,
  commentsReturnFocus: null,
  editorCommentId: null,
  editorReturnFocus: null,
  editorGeneration: 0,
  reactionsReturnFocus: null,
  reactionsGeneration: 0,
  reactionTarget: null,
  emojiPicker: null,
  pendingPayloads: new Map(),
};
const UNCERTAIN_INTERACTION_ERRORS = new Set(["ACK_TIMEOUT", "CONNECTION_LOST", "REQUEST_TIMEOUT", "SHUTTING_DOWN", "TRANSPORT_FAILED", "WRITE_OUTCOME_UNKNOWN"]);

function historyElement(id) {
  return document.getElementById(id);
}

function setHistoryButtonsVisible(visible) {
  historyButtonsVisible = visible;
  document.querySelectorAll(".competition-history-button").forEach((button) => {
    button.hidden = !visible;
  });
}

function clearHistoryState() {
  historyRequestGeneration++;
  historyState.open = false;
  historyState.global = false;
  historyState.bewerbId = null;
  historyState.competitionName = "";
  historyState.entries = [];
  historyState.nextCursor = null;
  historyState.loading = false;
  historyState.reactionCatalog = [];
  historyState.revision = 0;
  for (const id of ["history-comments-modal", "history-comment-editor-modal", "history-reactions-modal"]) {
    const interactionModal = historyElement(id);
    if (interactionModal) {
      interactionModal.hidden = true;
      interactionModal.inert = false;
      interactionModal.removeAttribute("aria-hidden");
    }
  }
  setModalCovered("competition-history-modal", false);
  interactionState.eventId = null;
  interactionState.comments = [];
  interactionState.commentsNextCursor = null;
  interactionState.commentsGeneration++;
  interactionState.commentsLoading = false;
  interactionState.commentsRefreshPending = false;
  interactionState.reactionTarget = null;
  historyElement("competition-history-list")?.replaceChildren();
  if (historyElement("competition-history-title")) historyElement("competition-history-title").textContent = "Historie";
  if (historyElement("competition-history-competition-name")) historyElement("competition-history-competition-name").textContent = "";
  if (historyElement("competition-history-status")) historyElement("competition-history-status").textContent = "";
  if (historyElement("competition-history-more")) {
    historyElement("competition-history-more").textContent = "Weitere Einträge laden";
    historyElement("competition-history-more").hidden = true;
  }
}

function closeCompetitionHistory({ restoreFocus = true } = {}) {
  const modal = historyElement("competition-history-modal");
  if (!modal || modal.hidden) {
    clearHistoryState();
    return;
  }
  const returnFocus = historyState.returnFocus;
  modal.hidden = true;
  clearHistoryState();
  historyState.returnFocus = null;
  if (!document.querySelector('.modal:not(.hidden), .competition-history-modal:not([hidden])')) {
    document.body.classList.remove("modal-open");
  }
  if (restoreFocus && returnFocus?.isConnected && !returnFocus.hidden) returnFocus.focus();
}

function historyTimestamp(entry) {
  return entry?.occurredAt ?? entry?.timestamp ?? entry?.createdAt ?? entry?.date ?? "";
}

function historyTimeValue(entry) {
  const value = historyTimestamp(entry);
  const numeric = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatHistoryTimestamp(value) {
  if (value === "" || value === null || value === undefined) return "Zeitpunkt unbekannt";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function historyEntries(data) {
  const values = data?.entries ?? data?.history ?? data?.events ?? data?.items;
  return Array.isArray(values) ? values : [];
}

function appendHistoryText(container, text, className) {
  if (text === "" || text === null || text === undefined) return;
  const line = document.createElement("p");
  line.className = className;
  line.textContent = String(text);
  container.appendChild(line);
}

function createInlineIcon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const paths = kind === "comments"
    ? ["M4 4.5h16v11H9l-5 4v-15Z"]
    : ["M8.5 10h.01M15.5 10h.01M9 14c1.7 1.4 4.3 1.4 6 0", "M12 3a8 8 0 1 0 7.4 11", "M19 3v6M16 6h6"];
  for (const value of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", value);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
  return svg;
}

function historyEntry(eventId) {
  return historyState.entries.find((entry) => String(entry.id) === String(eventId));
}

function reactionDefinition(key) {
  return historyState.reactionCatalog.find((entry) => entry.key === key);
}

function formatInteractionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt unbekannt";
  return new Intl.DateTimeFormat("de-AT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function closeInteractionModal(id, returnFocusKey) {
  const modal = historyElement(id);
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  const returnFocus = interactionState[returnFocusKey];
  interactionState[returnFocusKey] = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}

function setModalCovered(id, covered) {
  const modal = historyElement(id);
  if (!modal) return;
  modal.inert = covered;
  if (covered) modal.setAttribute("aria-hidden", "true");
  else modal.removeAttribute("aria-hidden");
}

function retainWritePayload(key, payload) {
  const serialized = JSON.stringify(payload);
  const pending = interactionState.pendingPayloads.get(key);
  if (pending && pending !== serialized) {
    const error = new Error("Bitte zuerst die zuvor gesendete Änderung unverändert wiederholen.");
    error.code = "OPERATION_RETRY_PAYLOAD_REQUIRED";
    throw error;
  }
  interactionState.pendingPayloads.set(key, serialized);
}

function releaseWritePayload(key, error = null) {
  if (error?.code === "OPERATION_RETRY_PAYLOAD_REQUIRED") return;
  releaseOperationId(key, error);
  if (!error || !UNCERTAIN_INTERACTION_ERRORS.has(error.code)) interactionState.pendingPayloads.delete(key);
}

function closeReactionModal() {
  interactionState.reactionsGeneration++;
  interactionState.reactionTarget = null;
  closeInteractionModal("history-reactions-modal", "reactionsReturnFocus");
  historyElement("history-reactions-body")?.replaceChildren();
  if (historyElement("history-reactions-status")) historyElement("history-reactions-status").textContent = "";
  if (!historyElement("history-comments-modal")?.hidden) {
    setModalCovered("history-comments-modal", false);
    setModalCovered("competition-history-modal", true);
  } else {
    setModalCovered("competition-history-modal", false);
  }
}

function closeCommentEditor() {
  interactionState.editorGeneration++;
  closeInteractionModal("history-comment-editor-modal", "editorReturnFocus");
  interactionState.editorCommentId = null;
  const picker = historyElement("history-comment-emoji-picker");
  if (picker) picker.hidden = true;
  const toggle = historyElement("history-comment-emoji-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
  setModalCovered("history-comments-modal", false);
}

function closeCommentsModal() {
  closeCommentEditor();
  closeInteractionModal("history-comments-modal", "commentsReturnFocus");
  interactionState.eventId = null;
  interactionState.comments = [];
  interactionState.commentsNextCursor = null;
  interactionState.commentsGeneration++;
  interactionState.commentsLoading = false;
  interactionState.commentsRefreshPending = false;
  historyElement("history-comments-list")?.replaceChildren();
  setModalCovered("competition-history-modal", false);
}

function commentCharacterCount(value) {
  return [...new Intl.Segmenter("de", { granularity: "grapheme" }).segment(value)].length;
}

function updateCommentCounter() {
  const input = historyElement("history-comment-text");
  const counter = historyElement("history-comment-counter");
  if (!input || !counter) return;
  const count = commentCharacterCount(input.value.trim());
  counter.textContent = `${count} / 1000`;
  counter.classList.toggle("is-over-limit", count > 1000);
  historyElement("history-comment-editor-submit").disabled = count < 1 || count > 1000;
}

async function ensureFullEmojiPicker() {
  const host = historyElement("history-comment-emoji-picker");
  if (!host || interactionState.emojiPicker) return;
  const [{ Picker }, { default: i18n }] = await Promise.all([
    import("/api/emoji-picker/index.js"),
    import("/api/emoji-picker/i18n/de.js"),
  ]);
  const picker = new Picker({ locale: "de", i18n, dataSource: "/api/emoji-picker/data/de.json" });
  picker.classList.add("light");
  picker.addEventListener("emoji-click", (event) => {
    const input = historyElement("history-comment-text");
    if (!input) return;
    const emoji = String(event.detail?.unicode || "");
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(emoji, start, end, "end");
    input.focus();
    updateCommentCounter();
  });
  host.appendChild(picker);
  interactionState.emojiPicker = picker;
}

async function toggleFullEmojiPicker() {
  const host = historyElement("history-comment-emoji-picker");
  const toggle = historyElement("history-comment-emoji-toggle");
  if (!host || !toggle) return;
  const opening = host.hidden;
  if (opening) {
    try {
      await ensureFullEmojiPicker();
    } catch (error) {
      diagnostic.error("competition_history_comments_load_failed", error);
      historyElement("history-comment-editor-status").textContent = "Emoji-Auswahl konnte nicht geladen werden.";
      return;
    }
  }
  host.hidden = !opening;
  toggle.setAttribute("aria-expanded", String(opening));
}

async function refreshHistoryInteraction(eventId) {
  const entry = historyEntry(eventId);
  if (!entry) return;
  try {
    const response = await readHistoryInteraction({ eventId });
    if (!response.data?.success) throw new Error("Interaktionen konnten nicht geladen werden.");
    if (Number(response.data.revision) < historyState.revision) return Number(response.data.revision) || 0;
    entry.interaction = response.data.interaction;
    renderCompetitionHistory();
    return Number(response.data.revision) || 0;
  } catch (error) {
    diagnostic.error("competition_history_load_failed", error);
    throw error;
  }
}

function renderComments() {
  const list = historyElement("history-comments-list");
  const more = historyElement("history-comments-more");
  const status = historyElement("history-comments-status");
  if (!list || !more || !status) return;
  list.replaceChildren();
  for (const comment of interactionState.comments) {
    const item = document.createElement("li");
    item.className = `history-comment${comment.mine ? " is-mine" : ""}${comment.status === "under_review" ? " is-under-review" : ""}`;
    const heading = document.createElement("div");
    heading.className = "history-comment-heading";
    const author = document.createElement("span");
    author.className = "history-comment-author";
    author.textContent = comment.authorName;
    const time = document.createElement("time");
    time.dateTime = new Date(comment.createdAt).toISOString();
    time.textContent = formatInteractionTime(comment.createdAt);
    heading.append(author, time);
    if (comment.updatedAt) {
      const edited = document.createElement("span");
      edited.textContent = "bearbeitet";
      heading.appendChild(edited);
    }
    const body = document.createElement("p");
    body.className = `history-comment-body${comment.placeholder ? " history-comment-placeholder" : ""}`;
    body.textContent = comment.placeholder || comment.body;
    item.append(heading, body);
    appendCommentReactionActions(item, comment);
    const actions = document.createElement("div");
    actions.className = "history-comment-actions";
    if (comment.canEdit) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Bearbeiten";
      edit.addEventListener("click", () => openCommentEditor(comment, edit));
      actions.appendChild(edit);
    }
    if (comment.canModerate) {
      const moderate = document.createElement("button");
      moderate.type = "button";
      moderate.textContent = comment.status === "under_review" ? "Wieder freigeben" : "Vorläufig ausblenden";
      moderate.addEventListener("click", () => changeCommentModeration(comment, moderate));
      actions.appendChild(moderate);
    }
    if (comment.canDelete) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = comment.mine ? "Löschen" : "Endgültig löschen";
      remove.addEventListener("click", () => removeComment(comment, remove));
      actions.appendChild(remove);
    }
    if (actions.childElementCount) item.appendChild(actions);
    list.appendChild(item);
  }
  status.textContent = interactionState.comments.length ? "" : "Noch keine Kommentare vorhanden.";
  more.hidden = !interactionState.commentsNextCursor;
  more.disabled = interactionState.commentsLoading;
}

async function loadComments({ older = false } = {}) {
  if (!interactionState.eventId) return;
  if (interactionState.commentsLoading) {
    interactionState.commentsRefreshPending = true;
    return;
  }
  const eventId = interactionState.eventId;
  const generation = interactionState.commentsGeneration;
  interactionState.commentsLoading = true;
  historyElement("history-comments-status").textContent = older ? "Ältere Kommentare werden geladen..." : "Kommentare werden geladen...";
  try {
    const params = { eventId };
    if (older && interactionState.commentsNextCursor) params.cursor = interactionState.commentsNextCursor;
    const response = await readHistoryComments(params);
    if (generation !== interactionState.commentsGeneration || eventId !== interactionState.eventId) return;
    if (!response.data?.success) throw new Error("Kommentare konnten nicht geladen werden.");
    interactionState.comments = older ? [...response.data.comments, ...interactionState.comments] : response.data.comments;
    interactionState.commentsNextCursor = response.data.nextCursor || null;
    renderComments();
  } catch (error) {
    if (generation !== interactionState.commentsGeneration || eventId !== interactionState.eventId) return;
    diagnostic.error("competition_history_comments_load_failed", error);
    historyElement("history-comments-status").textContent = "Kommentare konnten nicht geladen werden. Bitte erneut versuchen.";
  } finally {
    if (generation === interactionState.commentsGeneration && eventId === interactionState.eventId) {
      interactionState.commentsLoading = false;
      const more = historyElement("history-comments-more");
      if (more) more.disabled = false;
      if (interactionState.commentsRefreshPending) {
        interactionState.commentsRefreshPending = false;
        loadComments().catch(() => {});
      }
    }
  }
}

function openComments(eventId, button) {
  interactionState.eventId = eventId;
  interactionState.comments = [];
  interactionState.commentsNextCursor = null;
  interactionState.commentsGeneration++;
  interactionState.commentsLoading = false;
  interactionState.commentsRefreshPending = false;
  interactionState.commentsReturnFocus = button;
  const modal = historyElement("history-comments-modal");
  setModalCovered("competition-history-modal", true);
  modal.hidden = false;
  historyElement("history-comments-close")?.focus();
  loadComments().catch(() => {});
}

async function openCommentEditor(comment, button) {
  const generation = ++interactionState.editorGeneration;
  const eventId = interactionState.eventId;
  interactionState.editorCommentId = comment?.id || null;
  interactionState.editorReturnFocus = button;
  const input = historyElement("history-comment-text");
  const status = historyElement("history-comment-editor-status");
  historyElement("history-comment-editor-title").textContent = comment ? "Kommentar bearbeiten" : "Kommentar schreiben";
  historyElement("history-comment-editor-submit").textContent = comment ? "Speichern" : "Senden";
  input.value = comment?.body || "";
  status.textContent = "";
  if (comment && !comment.body) {
    status.textContent = "Kommentar wird geladen...";
    try {
      const response = await readHistoryCommentForEdit({ commentId: comment.id });
      if (generation !== interactionState.editorGeneration || eventId !== interactionState.eventId || historyElement("history-comments-modal")?.hidden) return;
      input.value = response.data.comment.body;
      status.textContent = "";
    } catch (error) {
      diagnostic.error("competition_history_comments_load_failed", error);
      status.textContent = "Kommentar konnte nicht zum Bearbeiten geladen werden.";
      return;
    }
  }
  if (generation !== interactionState.editorGeneration || eventId !== interactionState.eventId || historyElement("history-comments-modal")?.hidden) return;
  setModalCovered("history-comments-modal", true);
  historyElement("history-comment-editor-modal").hidden = false;
  updateCommentCounter();
  input.focus();
}

async function submitComment() {
  const input = historyElement("history-comment-text");
  const submit = historyElement("history-comment-editor-submit");
  const status = historyElement("history-comment-editor-status");
  const body = input.value.trim();
  const editing = interactionState.editorCommentId;
  const key = editing ? `history-comment-edit:${editing}` : `history-comment-add:${interactionState.eventId}`;
  submit.disabled = true;
  status.textContent = editing ? "Änderung wird gespeichert..." : "Kommentar wird gesendet...";
  try {
    retainWritePayload(key, { body });
    const endpoint = editing ? editHistoryComment : addHistoryComment;
    const params = editing
      ? { operationId: getOperationId(key), commentId: editing, body }
      : { operationId: getOperationId(key), eventId: interactionState.eventId, body };
    const response = await endpoint(params);
    if (!response.data?.success) throw new Error("Kommentar konnte nicht gespeichert werden.");
    releaseWritePayload(key);
    closeCommentEditor();
    await Promise.all([loadComments(), refreshHistoryInteraction(response.data.eventId)]);
  } catch (error) {
    releaseWritePayload(key, error);
    diagnostic.error("competition_history_comment_write_failed", error);
    status.textContent = error.code === "OPERATION_RETRY_PAYLOAD_REQUIRED"
      ? error.message
      : "Kommentar konnte nicht gespeichert werden. Bitte erneut versuchen.";
  } finally {
    updateCommentCounter();
  }
}

async function removeComment(comment, button) {
  if (!window.confirm("Kommentar endgültig löschen?")) return;
  const key = `history-comment-delete:${comment.id}`;
  button.disabled = true;
  try {
    retainWritePayload(key, { commentId: comment.id });
    const response = await deleteHistoryComment({ operationId: getOperationId(key), commentId: comment.id });
    releaseWritePayload(key);
    await Promise.all([loadComments(), refreshHistoryInteraction(response.data.eventId)]);
  } catch (error) {
    releaseWritePayload(key, error);
    diagnostic.error("competition_history_comment_write_failed", error);
    historyElement("history-comments-status").textContent = "Kommentar konnte nicht gelöscht werden.";
  } finally {
    button.disabled = false;
  }
}

async function changeCommentModeration(comment, button) {
  const status = comment.status === "under_review" ? "visible" : "under_review";
  const key = `history-comment-moderate:${comment.id}:${status}`;
  button.disabled = true;
  try {
    retainWritePayload(key, { commentId: comment.id, status });
    await moderateHistoryComment({ operationId: getOperationId(key), commentId: comment.id, status });
    releaseWritePayload(key);
    await loadComments();
  } catch (error) {
    releaseWritePayload(key, error);
    diagnostic.error("competition_history_comment_write_failed", error);
    historyElement("history-comments-status").textContent = "Moderationsstatus konnte nicht geändert werden.";
  } finally {
    button.disabled = false;
  }
}

async function chooseReaction(eventId, reactionKey, button) {
  const key = `history-reaction:${eventId}`;
  button.disabled = true;
  try {
    retainWritePayload(key, { eventId, reactionKey });
    const response = await setHistoryReaction({ operationId: getOperationId(key), eventId, reactionKey });
    releaseWritePayload(key);
    const entry = historyEntry(eventId);
    if (entry) entry.interaction = response.data.interaction;
    closeReactionModal();
    renderCompetitionHistory();
  } catch (error) {
    releaseWritePayload(key, error);
    diagnostic.error("competition_history_reaction_write_failed", error);
    historyElement("history-reactions-status").textContent = error.code === "OPERATION_RETRY_PAYLOAD_REQUIRED"
      ? error.message
      : "Reaktion konnte nicht gespeichert werden.";
  } finally {
    button.disabled = false;
  }
}

async function chooseCommentReaction(comment, reactionKey, button) {
  const key = `history-comment-reaction:${comment.id}`;
  button.disabled = true;
  try {
    retainWritePayload(key, { commentId: comment.id, reactionKey });
    const response = await setHistoryCommentReaction({ operationId: getOperationId(key), commentId: comment.id, reactionKey });
    releaseWritePayload(key);
    const current = interactionState.comments.find(({ id }) => id === comment.id);
    if (current) current.interaction = response.data.interaction;
    closeReactionModal();
    renderComments();
  } catch (error) {
    releaseWritePayload(key, error);
    diagnostic.error("competition_history_comment_reaction_write_failed", error);
    historyElement("history-reactions-status").textContent = error.code === "OPERATION_RETRY_PAYLOAD_REQUIRED"
      ? error.message
      : "Reaktion konnte nicht gespeichert werden.";
  } finally {
    button.disabled = false;
  }
}

function openCommentReactionPicker(comment, button) {
  interactionState.reactionsGeneration++;
  interactionState.reactionTarget = { kind: "comment", id: comment.id };
  interactionState.reactionsReturnFocus = button;
  const modal = historyElement("history-reactions-modal");
  setModalCovered("history-comments-modal", true);
  const body = historyElement("history-reactions-body");
  historyElement("history-reactions-title").textContent = "Reaktion auswählen";
  historyElement("history-reactions-status").textContent = "";
  body.replaceChildren();
  const choices = document.createElement("div");
  choices.className = "history-reaction-picker";
  for (const reaction of historyState.reactionCatalog.filter(({ active }) => active)) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = `history-reaction-choice${reaction.key === comment.interaction?.myReaction ? " is-mine" : ""}`;
    choice.textContent = reaction.emoji;
    choice.setAttribute("aria-label", `${reaction.label}${reaction.key === comment.interaction?.myReaction ? ", ausgewählt" : ""}`);
    choice.addEventListener("click", () => chooseCommentReaction(comment, reaction.key, choice));
    choices.appendChild(choice);
  }
  body.appendChild(choices);
  modal.hidden = false;
  historyElement("history-reactions-close")?.focus();
}

async function openCommentReactionDetails(comment, button) {
  const generation = ++interactionState.reactionsGeneration;
  interactionState.reactionTarget = { kind: "comment", id: comment.id };
  interactionState.reactionsReturnFocus = button;
  const modal = historyElement("history-reactions-modal");
  setModalCovered("history-comments-modal", true);
  const body = historyElement("history-reactions-body");
  const status = historyElement("history-reactions-status");
  historyElement("history-reactions-title").textContent = "Reaktionen";
  body.replaceChildren();
  status.textContent = "Reaktionen werden geladen...";
  modal.hidden = false;
  historyElement("history-reactions-close")?.focus();
  try {
    const response = await readHistoryCommentReactions({ commentId: comment.id });
    if (generation !== interactionState.reactionsGeneration || interactionState.reactionTarget?.id !== comment.id || modal.hidden) return;
    const list = document.createElement("ul");
    list.className = "history-reactions-list";
    for (const reaction of response.data.reactions) {
      const definition = reactionDefinition(reaction.key);
      if (!definition) continue;
      const item = document.createElement("li");
      item.className = "history-reaction-person";
      const emoji = document.createElement("span");
      emoji.className = "history-reaction-person-emoji";
      emoji.textContent = definition.emoji;
      const name = document.createElement("span");
      name.className = "history-reaction-person-name";
      name.textContent = reaction.userName;
      item.append(emoji, name);
      if (reaction.mine) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "history-secondary-action";
        remove.textContent = "Entfernen";
        remove.addEventListener("click", () => chooseCommentReaction(comment, null, remove));
        item.appendChild(remove);
      }
      list.appendChild(item);
    }
    body.appendChild(list);
    status.textContent = response.data.reactions.length ? "" : "Keine Reaktionen vorhanden.";
  } catch (error) {
    if (generation !== interactionState.reactionsGeneration || interactionState.reactionTarget?.id !== comment.id || modal.hidden) return;
    diagnostic.error("competition_history_comment_reactions_load_failed", error);
    status.textContent = "Reaktionen konnten nicht geladen werden.";
  }
}

function appendCommentReactionActions(item, comment) {
  if (!comment.canReact) return;
  const interaction = comment.interaction || { reactionTotal: 0, reactions: [], myReaction: null };
  const row = document.createElement("div");
  row.className = "history-comment-reactions";
  const reactions = document.createElement("span");
  reactions.className = "history-reaction-summary";
  for (const aggregate of interaction.reactions) {
    const definition = reactionDefinition(aggregate.key);
    if (!definition) continue;
    const reaction = document.createElement("button");
    reaction.type = "button";
    reaction.className = `history-reaction-button${interaction.myReaction === aggregate.key ? " is-mine" : ""}`;
    reaction.textContent = definition.emoji;
    reaction.setAttribute("aria-label", `${definition.label}: Reagierende anzeigen`);
    reaction.addEventListener("click", () => openCommentReactionDetails(comment, reaction));
    reactions.appendChild(reaction);
  }
  const count = document.createElement("span");
  count.className = "history-action-count";
  count.textContent = String(interaction.reactionTotal);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "history-reaction-add";
  add.setAttribute("aria-label", interaction.myReaction ? "Reaktion wechseln" : "Reaktion hinzufügen");
  add.appendChild(createInlineIcon("add-reaction"));
  add.addEventListener("click", () => openCommentReactionPicker(comment, add));
  reactions.append(count, add);
  row.appendChild(reactions);
  item.appendChild(row);
}

function openReactionPicker(eventId, button) {
  interactionState.reactionsGeneration++;
  interactionState.reactionTarget = { kind: "event", id: eventId };
  interactionState.eventId = eventId;
  interactionState.reactionsReturnFocus = button;
  const modal = historyElement("history-reactions-modal");
  setModalCovered("competition-history-modal", true);
  const body = historyElement("history-reactions-body");
  historyElement("history-reactions-title").textContent = "Reaktion auswählen";
  historyElement("history-reactions-status").textContent = "";
  body.replaceChildren();
  const choices = document.createElement("div");
  choices.className = "history-reaction-picker";
  const myReaction = historyEntry(eventId)?.interaction?.myReaction;
  for (const reaction of historyState.reactionCatalog.filter(({ active }) => active)) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = `history-reaction-choice${reaction.key === myReaction ? " is-mine" : ""}`;
    choice.textContent = reaction.emoji;
    choice.setAttribute("aria-label", `${reaction.label}${reaction.key === myReaction ? ", ausgewählt" : ""}`);
    choice.addEventListener("click", () => chooseReaction(eventId, reaction.key, choice));
    choices.appendChild(choice);
  }
  body.appendChild(choices);
  modal.hidden = false;
  historyElement("history-reactions-close")?.focus();
}

async function openReactionDetails(eventId, button) {
  const generation = ++interactionState.reactionsGeneration;
  interactionState.reactionTarget = { kind: "event", id: eventId };
  interactionState.eventId = eventId;
  interactionState.reactionsReturnFocus = button;
  const modal = historyElement("history-reactions-modal");
  setModalCovered("competition-history-modal", true);
  const body = historyElement("history-reactions-body");
  const status = historyElement("history-reactions-status");
  historyElement("history-reactions-title").textContent = "Reaktionen";
  body.replaceChildren();
  status.textContent = "Reaktionen werden geladen...";
  modal.hidden = false;
  historyElement("history-reactions-close")?.focus();
  try {
    const response = await readHistoryReactions({ eventId });
    if (generation !== interactionState.reactionsGeneration || eventId !== interactionState.eventId || modal.hidden) return;
    const list = document.createElement("ul");
    list.className = "history-reactions-list";
    for (const reaction of response.data.reactions) {
      const definition = reactionDefinition(reaction.key);
      if (!definition) continue;
      const item = document.createElement("li");
      item.className = "history-reaction-person";
      const emoji = document.createElement("span");
      emoji.className = "history-reaction-person-emoji";
      emoji.textContent = definition.emoji;
      const name = document.createElement("span");
      name.className = "history-reaction-person-name";
      name.textContent = reaction.userName;
      item.append(emoji, name);
      if (reaction.mine) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "history-secondary-action";
        remove.textContent = "Entfernen";
        remove.addEventListener("click", () => chooseReaction(eventId, null, remove));
        item.appendChild(remove);
      }
      list.appendChild(item);
    }
    body.appendChild(list);
    status.textContent = response.data.reactions.length ? "" : "Keine Reaktionen vorhanden.";
  } catch (error) {
    if (generation !== interactionState.reactionsGeneration || eventId !== interactionState.eventId || modal.hidden) return;
    diagnostic.error("competition_history_reactions_load_failed", error);
    status.textContent = "Reaktionen konnten nicht geladen werden.";
  }
}

function appendInteractionActions(item, entry) {
  if (!entry.id) return;
  const interaction = entry.interaction || { commentCount: 0, reactionTotal: 0, reactions: [], myReaction: null };
  const row = document.createElement("div");
  row.className = "history-entry-actions";
  const comments = document.createElement("span");
  comments.className = "history-action-group";
  const commentButton = document.createElement("button");
  commentButton.type = "button";
  commentButton.className = "history-action-button";
  commentButton.setAttribute("aria-label", `Kommentare öffnen, ${interaction.commentCount} Kommentare`);
  commentButton.appendChild(createInlineIcon("comments"));
  commentButton.addEventListener("click", () => openComments(entry.id, commentButton));
  const commentCount = document.createElement("span");
  commentCount.className = "history-action-count";
  commentCount.textContent = String(interaction.commentCount);
  comments.append(commentButton, commentCount);
  const reactions = document.createElement("span");
  reactions.className = "history-reaction-summary";
  for (const aggregate of interaction.reactions) {
    const definition = reactionDefinition(aggregate.key);
    if (!definition) continue;
    const reaction = document.createElement("button");
    reaction.type = "button";
    reaction.className = `history-reaction-button${interaction.myReaction === aggregate.key ? " is-mine" : ""}`;
    reaction.textContent = definition.emoji;
    reaction.setAttribute("aria-label", `${definition.label}: Reagierende anzeigen`);
    reaction.addEventListener("click", () => openReactionDetails(entry.id, reaction));
    reactions.appendChild(reaction);
  }
  const reactionCount = document.createElement("span");
  reactionCount.className = "history-action-count";
  reactionCount.textContent = String(interaction.reactionTotal);
  reactions.appendChild(reactionCount);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "history-reaction-add";
  add.setAttribute("aria-label", interaction.myReaction ? "Reaktion wechseln" : "Reaktion hinzufügen");
  add.appendChild(createInlineIcon("add-reaction"));
  add.addEventListener("click", () => openReactionPicker(entry.id, add));
  reactions.appendChild(add);
  row.append(comments, reactions);
  item.appendChild(row);
}

function renderCompetitionHistory() {
  const list = historyElement("competition-history-list");
  const status = historyElement("competition-history-status");
  const more = historyElement("competition-history-more");
  if (!list || !status || !more) return;

  list.replaceChildren();
  const sortedEntries = [...historyState.entries].sort((left, right) => historyTimeValue(right) - historyTimeValue(left));
  for (const entry of sortedEntries) {
    const item = document.createElement("li");
    item.className = "competition-history-entry";
    const time = document.createElement("time");
    const rawTimestamp = historyTimestamp(entry);
    const parsedTimestamp = new Date(rawTimestamp);
    if (!Number.isNaN(parsedTimestamp.getTime())) time.dateTime = parsedTimestamp.toISOString();
    time.textContent = formatHistoryTimestamp(rawTimestamp);
    item.appendChild(time);

    const roundName = String(entry?.roundName || "").trim();
    if (historyState.global) {
      const competitionName = entry?.competitionName ?? entry?.competition?.name ?? entry?.bewerbName;
      const competition = document.createElement("p");
      competition.className = "competition-history-entry-competition";
      competition.textContent = String(competitionName || "Bewerb unbekannt");
      if (roundName) {
        const round = document.createElement("span");
        round.className = "competition-history-entry-round";
        round.textContent = ` - ${roundName}`;
        competition.appendChild(round);
      }
      item.appendChild(competition);
    } else {
      appendHistoryText(item, roundName, "competition-history-entry-round");
    }
    const title = entry?.summary ?? entry?.label ?? entry?.action ?? entry?.type ?? entry?.event;
    appendHistoryText(item, title || "Änderung", "competition-history-entry-title");
    if (ADMIN_RANKING_HISTORY_TYPES.has(entry?.type)) {
      appendHistoryText(item, entry?.detail, "competition-history-entry-detail");
    }
    appendHistoryText(item, entry?.result ? `Ergebnis: ${entry.result}` : "", "competition-history-entry-result");
    const actor = entry?.actorName ?? entry?.actor;
    appendHistoryText(item, actor ? `Eingetragen durch: ${actor}` : "", "competition-history-entry-meta");
    appendInteractionActions(item, entry);
    list.appendChild(item);
  }

  status.textContent = historyState.entries.length ? "" : "Keine Historieneinträge vorhanden.";
  more.textContent = "Weitere Einträge laden";
  more.disabled = historyState.loading;
  more.hidden = !historyState.nextCursor;
}

async function loadCompetitionHistory({ append = false } = {}) {
  if (!historyState.open || historyState.loading || !historyButtonsVisible) return;
  const generation = ++historyRequestGeneration;
  const status = historyElement("competition-history-status");
  const more = historyElement("competition-history-more");
  historyState.loading = true;
  if (status) status.textContent = append ? "Weitere Einträge werden geladen..." : "Historie wird geladen...";
  if (more) more.disabled = true;

  try {
    const params = historyState.global ? {} : { bewerbId: historyState.bewerbId };
    if (append && historyState.nextCursor) params.cursor = historyState.nextCursor;
    const response = await readCompetitionHistory(params);
    if (generation !== historyRequestGeneration || !historyState.open || !historyButtonsVisible) return;
    if (!response.data?.success) throw new Error(response.data?.error?.message || "Historie konnte nicht geladen werden.");
    const entries = historyEntries(response.data);
    const authoritativeName = String(response.data.competition?.name || "").trim();
    if (Array.isArray(response.data.reactionCatalog)) historyState.reactionCatalog = response.data.reactionCatalog;
    historyState.revision = Math.max(historyState.revision, Number(response.data.revision) || 0);
    if (!historyState.global && authoritativeName) {
      historyState.competitionName = authoritativeName;
      historyElement("competition-history-competition-name").textContent = authoritativeName;
    }
    historyState.entries = append ? [...historyState.entries, ...entries] : entries;
    historyState.nextCursor = response.data.nextCursor || null;
    renderCompetitionHistory();
  } catch (error) {
    if (generation !== historyRequestGeneration) return;
    diagnostic.error("competition_history_load_failed", error);
    if (status) status.textContent = "Historie konnte nicht geladen werden. Bitte erneut versuchen.";
    if (more) {
      more.hidden = false;
      more.textContent = append ? "Weitere Einträge erneut laden" : "Erneut versuchen";
    }
  } finally {
    if (generation === historyRequestGeneration) {
      historyState.loading = false;
      if (more) more.disabled = false;
    }
  }
}

function openCompetitionHistory(competition, button) {
  if (!historyButtonsVisible) return;
  clearHistoryState();
  historyState.open = true;
  historyState.global = !competition;
  historyState.bewerbId = competition ? String(competition.id) : null;
  historyState.competitionName = competition ? String(competition.bezeichnung || "Bewerb") : "Alle Bewerbe";
  historyState.returnFocus = button;
  historyElement("competition-history-title").textContent = "Historie";
  historyElement("competition-history-competition-name").textContent = historyState.competitionName;
  const modal = historyElement("competition-history-modal");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  historyElement("competition-history-close")?.focus();
  loadCompetitionHistory().catch(() => {});
}

function initializeCompetitionHistory() {
  const modal = historyElement("competition-history-modal");
  const globalButton = historyElement("all-competition-history-button");
  globalButton?.appendChild(createHistoryIcon());
  globalButton?.addEventListener("click", () => openCompetitionHistory(null, globalButton));
  historyElement("competition-history-close")?.addEventListener("click", () => closeCompetitionHistory());
  historyElement("competition-history-more")?.addEventListener("click", () => loadCompetitionHistory({
    append: Boolean(historyState.entries.length && historyState.nextCursor),
  }));
  historyElement("history-comments-close")?.addEventListener("click", closeCommentsModal);
  historyElement("history-comments-more")?.addEventListener("click", () => loadComments({ older: true }));
  historyElement("history-comment-add")?.addEventListener("click", (event) => openCommentEditor(null, event.currentTarget));
  historyElement("history-comment-editor-close")?.addEventListener("click", closeCommentEditor);
  historyElement("history-comment-editor-cancel")?.addEventListener("click", closeCommentEditor);
  historyElement("history-comment-editor-submit")?.addEventListener("click", submitComment);
  historyElement("history-comment-text")?.addEventListener("input", updateCommentCounter);
  historyElement("history-comment-emoji-toggle")?.addEventListener("click", toggleFullEmojiPicker);
  historyElement("history-reactions-close")?.addEventListener("click", closeReactionModal);
  for (const [id, close] of [["history-comments-modal", closeCommentsModal], ["history-comment-editor-modal", closeCommentEditor], ["history-reactions-modal", closeReactionModal]]) {
    historyElement(id)?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) close();
    });
  }
  modal?.addEventListener("click", (event) => {
    if (event.target === modal) closeCompetitionHistory();
  });
  document.addEventListener("keydown", (event) => {
    const openModal = [
      historyElement("history-comment-editor-modal"),
      historyElement("history-reactions-modal"),
      historyElement("history-comments-modal"),
      modal,
    ].find((entry) => entry && !entry.hidden);
    if (!openModal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (openModal.id === "history-comment-editor-modal") closeCommentEditor();
      else if (openModal.id === "history-reactions-modal") closeReactionModal();
      else if (openModal.id === "history-comments-modal") closeCommentsModal();
      else closeCompetitionHistory();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...openModal.querySelectorAll("button:not([hidden]):not(:disabled), textarea:not([hidden]):not(:disabled), input:not([hidden]):not(:disabled), select:not([hidden]):not(:disabled), emoji-picker")]
      .filter((element) => element.getClientRects().length);
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (index <= 0 ? focusable.length - 1 : index - 1)
      : (index < 0 || index === focusable.length - 1 ? 0 : index + 1);
    event.preventDefault();
    focusable[nextIndex].focus();
  });

  subscribeAuth((user, state) => {
    const identity = state.status === "authenticated" && user ? String(user.id || user.login || "authenticated") : null;
    if (historyAuthIdentity !== null && historyAuthIdentity !== identity) closeCompetitionHistory({ restoreFocus: false });
    historyAuthIdentity = identity;
    setHistoryButtonsVisible(Boolean(identity));
  });
  ready.catch(() => setHistoryButtonsVisible(false));
  subscribe("competition-history", (data) => {
    const eventId = String(data?.eventId || "");
    const revision = Number(data?.revision) || 0;
    if (revision <= historyState.revision) return;
    if (!historyState.open) return;
    const eventIds = eventId ? [eventId] : [...new Set(historyState.entries.map(({ id }) => String(id || "")).filter(Boolean))];
    Promise.all(eventIds.map((id) => refreshHistoryInteraction(id))).then(() => {
      historyState.revision = Math.max(historyState.revision, revision);
    }).catch(() => {});
    if ((!eventId || interactionState.eventId === eventId) && !historyElement("history-comments-modal")?.hidden) loadComments().catch(() => {});
    if ((!eventId || interactionState.eventId === eventId) && !historyElement("history-reactions-modal")?.hidden) closeReactionModal();
  });
}

function scheduleCompetitionBoundary(competitions) {
  if (competitionBoundaryTimer) clearTimeout(competitionBoundaryTimer);
  competitionBoundaryTimer = null;
  const now = Date.now();
  const candidates = [];
  for (const competition of competitions) {
    for (const [field, endOfDay] of [["entrystart", false], ["entrydeadline", true], ["bewerbsbeginn", false], ["bewerbsende", true]]) {
      const value = parseSheetDate(competition[field], endOfDay)?.getTime();
      if (Number.isFinite(value) && value > now) candidates.push(value);
    }
  }
  const next = candidates.sort((left, right) => left - right)[0];
  if (!next) return;
  competitionBoundaryTimer = setTimeout(() => {
    competitionBoundaryTimer = null;
    loadBewerbe().catch(() => {});
  }, Math.min(2147483647, Math.max(1, next - now + 50)));
}

function parseSheetDate(raw, endOfDay = false) {
  if (!raw) return null;
  const rawStr = String(raw).trim();
  if (!rawStr) return null;

  // YYYYMMDD-HHMM
  const match8t = rawStr.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (match8t) {
    const [, yyyy, mm, dd, hh, mi] = match8t;
    return new Date(+yyyy, +mm - 1, +dd, +hh, +mi);
  }

  // YYYYMMDD
  const match8 = rawStr.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match8) {
    const [, yyyy, mm, dd] = match8;
    return new Date(+yyyy, +mm - 1, +dd, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  }

  // YYMMDD-HHMM
  const match6t = rawStr.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (match6t) {
    const [, yy, mm, dd, hh, mi] = match6t;
    const yyyy = parseInt(yy, 10) >= 50 ? 1900 + +yy : 2000 + +yy;
    return new Date(yyyy, +mm - 1, +dd, +hh, +mi);
  }

  // YYMMDD
  const match6 = rawStr.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (match6) {
    const [, yy, mm, dd] = match6;
    const yyyy = parseInt(yy, 10) >= 50 ? 1900 + +yy : 2000 + +yy;
    return new Date(yyyy, +mm - 1, +dd, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  }

  return null;
}

function formatSheetDate(raw) {
  if (!raw) return "";
  const date = parseSheetDate(raw);
  if (!date) return String(raw).trim();

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function createHistoryIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.dataset.icon = "megaphone";
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const pathData of [
    "M3 10v4a2 2 0 0 0 2 2h2L20 20V4L7 8H5a2 2 0 0 0-2 2Z",
    "m7 16 2 5h4l-2.4-3.8",
  ]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);
  }
  return svg;
}

// ── Bewerb Cards ────────────────────────────────────────────────────────

function createCard(b) {
  const card = document.createElement("div");
  const bewerbsartId = String(b.bewerbsartId).trim();
  const isRangliste = bewerbsartId === "2";
  const isRoundRobin = b.roundRobin === "1";

  card.className = "bewerb-card";

  let target = isRangliste ? `rangliste.html?id=${encodeURIComponent(String(b.id))}` : null;

  const start = formatSheetDate(b.bewerbsbeginn);
  const end = b.bewerbsende ? formatSheetDate(b.bewerbsende) : "Offen";
  const entryStart = formatSheetDate(b.entrystart);
  const entryDeadline = formatSheetDate(b.entrydeadline);
  const hasEntryList = b.entryListAvailable === "1";

  const headingRow = document.createElement("div");
  headingRow.className = "bewerb-heading";
  const heading = document.createElement("h3");
  heading.textContent = String(b.bezeichnung || "");
  const historyButton = document.createElement("button");
  historyButton.type = "button";
  historyButton.className = "competition-history-button";
  historyButton.setAttribute("aria-label", `Historie von ${String(b.bezeichnung || "Bewerb")} öffnen`);
  historyButton.title = "Bewerbshistorie öffnen";
  historyButton.appendChild(createHistoryIcon());
  historyButton.hidden = !historyButtonsVisible;
  historyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openCompetitionHistory(b, historyButton);
  });
  headingRow.append(heading, historyButton);
  card.appendChild(headingRow);

  const dates = document.createElement("div");
  dates.className = `bewerb-dates${hasEntryList ? " with-entrylist" : ""}`;

  const appendDate = (label, value) => {
    const row = document.createElement("span");
    row.textContent = `${label}: ${value}`;
    dates.appendChild(row);
  };

  appendDate("Bewerbs Beginn", start || "---");
  if (hasEntryList) appendDate("Eintragungsliste Beginn", entryStart || "---");
  appendDate("Bewerbs Ende", end || "Offen");
  if (hasEntryList) appendDate("Eintragungsliste Ende", entryDeadline || "Offen");
  card.appendChild(dates);

  // Alle Bewerbe außer Rangliste: Klick-Logik
  if (!isRangliste) {
    const now = new Date();
    const deadline = parseSheetDate(b.entrydeadline, true);
    const isPastDeadline = deadline ? deadline < now : false;
    const entryStartDate = parseSheetDate(b.entrystart);
    const isBeforeEntryStart = entryStartDate ? entryStartDate > now : false;
    const bewerbStart = parseSheetDate(b.bewerbsbeginn);
    const hasStarted = bewerbStart ? bewerbStart <= now : false;

    // Zielseite bestimmen + Klickbarkeit
    const isEntryOpen = !isBeforeEntryStart && !isPastDeadline && hasEntryList;

    if (hasStarted) {
      // Bewerb läuft oder beendet → zur Bewerbsseite (Ergebnisse ansehen)
      if (isRoundRobin) {
        target = `RoundRobin.html?id=${encodeURIComponent(String(b.id))}`;
      } else {
        target = `bewerbsRaster.html?id=${encodeURIComponent(String(b.id))}`;
      }
    } else if (isEntryOpen) {
      // Bewerb hat noch nicht begonnen, aber EntryList ist offen
      target = `entryList.html?id=${encodeURIComponent(String(b.id))}`;
    }

  }

  if (target) {
    card.classList.add("clickable");
    const link = document.createElement("a");
    link.className = "bewerb-card-link";
    link.href = target;
    link.setAttribute("aria-label", `${String(b.bezeichnung || "Bewerb")} öffnen`);
    card.appendChild(link);
  }

  return card;
}

function createGrid(id) {
  const grid = document.createElement("div");
  grid.className = "bewerb-grid";
  grid.id = id;
  return grid;
}

function createSection(title, gridId) {
  const section = document.createElement("div");
  section.className = "bewerb-section";

  const heading = document.createElement("h3");
  heading.className = "bewerb-section-title";
  heading.textContent = title;

  const grid = createGrid(gridId);

  section.appendChild(heading);
  section.appendChild(grid);

  return section;
}

function classifyBewerb(b, today) {
  const startRaw = String(b.bewerbsbeginn || "").trim();
  const endRaw = String(b.bewerbsende || "").trim();

  const startDate = parseSheetDate(startRaw);
  const endDate = parseSheetDate(endRaw, true);

  const started = startDate ? startDate <= today : false;
  const ended = endDate ? endDate < today : false;

  if (!startDate && !endDate) return "active";
  if (ended) return "finished";
  if (started && !ended) return "active";
  if (!started && !ended) return "upcoming";

  return "upcoming";
}

async function loadBewerbe() {
  const preserveContent = bewerbeLoadedOnce;
  if (bewerbeLoadPromise) return bewerbeLoadPromise;

  bewerbeLoadPromise = (async () => {
  const container = document.getElementById("bewerbe-container");
  if (!container) {
    const error = new Error("Bewerbe-Container fehlt.");
    error.code = "COMPETITIONS_CONTAINER_MISSING";
    throw error;
  }

  if (!preserveContent) {
    container.replaceChildren();
    showLoadingOverlay("Lade Bewerbe...");
  }

  try {
    const [bewerbRes, bewerbsartRes] = await Promise.all([
      callWithRetry(readBewerbe),
      callWithRetry(readBewerbsart),
    ]);

    if (!bewerbRes.data?.success || !bewerbsartRes.data?.success) {
      const failedData = !bewerbRes.data?.success ? bewerbRes.data : bewerbsartRes.data;
      throw new Error(failedData?.error?.message || "Bewerbe konnten nicht geladen werden.");
    }

    const bewerbValues = bewerbRes.data?.values || [];
    const bewerbsartValues = bewerbsartRes.data?.values || [];

    if (bewerbValues.length < 2) {
      if (preserveContent) return true;
      const message = document.createElement("p");
      message.textContent = "Keine Bewerbe gefunden.";
      container.appendChild(message);
      hideLoadingOverlay();
      bewerbeLoadedOnce = true;
      return;
    }

    const baMap = new Map();
    if (bewerbsartValues.length > 1) {
      const baHeader = bewerbsartValues[0].map((h) => String(h || "").trim().toLowerCase());
      const baIdIdx = baHeader.indexOf("id");
      const baEntryIdx = baHeader.indexOf("entrylistavailable");
      const baBezIdx = baHeader.indexOf("bezeichnung");
      const baRRIdx = baHeader.indexOf("roundrobin");
      bewerbsartValues.slice(1).forEach((r) => {
        const id = String(r[baIdIdx] || "").trim();
        if (id) {
          baMap.set(id, {
            bezeichnung: String(r[baBezIdx] || "").trim(),
            entryListAvailable: baEntryIdx !== -1 ? String(r[baEntryIdx] || "0").trim() : "0",
            roundRobin: baRRIdx !== -1 ? String(r[baRRIdx] || "0").trim() : "0",
          });
        }
      });
    }

    const bHeader = bewerbValues[0].map((h) => String(h || "").trim().toLowerCase());
    const bIdIdx = bHeader.indexOf("id");
    const bBewerbsartIdx = bHeader.indexOf("bewerbsartid");
    const bBezIdx = bHeader.indexOf("bezeichnung");
    const bEntryStartIdx = bHeader.indexOf("entrystart");
    const bEntryDeadlineIdx = bHeader.indexOf("entrydeadline");
    const bStartIdx = bHeader.indexOf("bewerbsbeginn");
    const bEndIdx = bHeader.indexOf("bewerbsende");
    const bSortIdx = bHeader.indexOf("sortorder");

    const bewerbe = bewerbValues.slice(1).map((row) => {
      const bewerbsartId = String(row[bBewerbsartIdx] || "").trim();
      const baInfo = baMap.get(bewerbsartId) || {};
      const sortOrderRaw = bSortIdx >= 0 ? String(row[bSortIdx] || "").trim() : "";
      const sortOrder = sortOrderRaw !== "" ? parseInt(sortOrderRaw, 10) : Infinity;
      return {
        id: row[bIdIdx] || "",
        bewerbsartId,
        bezeichnung: row[bBezIdx] || "",
        entrystart: bEntryStartIdx !== -1 ? row[bEntryStartIdx] || "" : "",
        entrydeadline: bEntryDeadlineIdx !== -1 ? row[bEntryDeadlineIdx] || "" : "",
        bewerbsbeginn: row[bStartIdx] || "",
        bewerbsende: row[bEndIdx] || "",
        entryListAvailable: baInfo.entryListAvailable || "0",
        roundRobin: baInfo.roundRobin || "0",
        sortOrder,
      };
    });

    const filtered = bewerbe.filter((b) => String(b.id).trim() !== "1");
    scheduleCompetitionBoundary(filtered);

    const today = new Date();

    const active = [];
    const upcoming = [];
    const finished = [];

    filtered.forEach((b) => {
      const cat = classifyBewerb(b, today);
      if (cat === "active") active.push(b);
      else if (cat === "upcoming") upcoming.push(b);
      else if (cat === "finished") finished.push(b);
    });

    // Sortierung pro Kategorie
    function sortByOrder(a, b, datumField) {
      // 1. SortOrder: kleinste zuerst, Infinity (kein Wert) nach unten
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      // 2. Bei gleichem SortOrder (oder beide ohne): nach Datum
      const da = parseSheetDate(a[datumField]);
      const db = parseSheetDate(b[datumField]);
      const ta = da ? da.getTime() : Infinity;
      const tb = db ? db.getTime() : Infinity;
      return ta - tb;
    }

    active.sort((a, b) => sortByOrder(a, b, "bewerbsende"));
    upcoming.sort((a, b) => sortByOrder(a, b, "bewerbsbeginn"));
    finished.sort((a, b) => sortByOrder(a, b, "bewerbsende"));

    container.replaceChildren();

    if (active.length > 0) {
      const section = createSection("Aktive Bewerbe", "grid-active");
      container.appendChild(section);
      const grid = section.querySelector(".bewerb-grid");
      active.forEach((b) => {
        grid.appendChild(createCard(b));
      });
    }

    if (upcoming.length > 0) {
      const section = createSection("Bevorstehende Bewerbe", "grid-upcoming");
      container.appendChild(section);
      const grid = section.querySelector(".bewerb-grid");
      upcoming.forEach((b) => {
        grid.appendChild(createCard(b));
      });
    }

    if (finished.length > 0) {
      const section = createSection("Beendete Bewerbe", "grid-finished");
      container.appendChild(section);
      const grid = section.querySelector(".bewerb-grid");
      finished.forEach((b) => {
        grid.appendChild(createCard(b));
      });
    }

    if (active.length === 0 && upcoming.length === 0 && finished.length === 0) {
      const message = document.createElement("p");
      message.textContent = "Keine Bewerbe gefunden.";
      container.appendChild(message);
    }
    bewerbeLoadedOnce = true;
    if (!preserveContent) hideLoadingOverlay();
  } catch (err) {
    diagnostic.error("competitions_load_failed", err);
    if (!preserveContent) {
      showErrorOverlay("Fehler beim Laden der Bewerbe", () => {
        loadBewerbe().catch(() => {});
      });
    }
    throw err;
  } finally {
    bewerbeLoadPromise = null;
  }
  })();

  return bewerbeLoadPromise;
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeCompetitionHistory();
  try {
    await loadBewerbe();
    subscribeInvalidations(["bewerbe", "bewerbsart"], () => loadBewerbe());
    signalMonitorReady();
  } catch (error) {
    signalMonitorFailed(error.code || "COMPETITIONS_LOAD_FAILED");
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadBewerbe().catch(() => {});
});
