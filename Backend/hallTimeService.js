const crypto = require("crypto");
const { AppError } = require("./errors.js");

const STATE_KEY = "hall-times:v1";
const EMPTY_STATE = Object.freeze({ grids: [] });
const HISTORY_LIMIT = 5000;
const VIENNA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
});
const VIENNA_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function parts(formatter, value) {
  return Object.fromEntries(formatter.formatToParts(value).filter(({ type }) => type !== "literal").map(({ type, value: part }) => [type, part]));
}

function localDate(now) {
  const value = parts(VIENNA_DATE, new Date(now));
  return `${value.year}-${value.month}-${value.day}`;
}

function dateOrdinal(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function viennaDateTimeMs(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  for (let index = 0; index < 3; index++) {
    const actual = parts(VIENNA_PARTS, new Date(guess));
    const represented = Date.UTC(Number(actual.year), Number(actual.month) - 1, Number(actual.day), Number(actual.hour), Number(actual.minute), Number(actual.second));
    guess += desired - represented;
  }
  return guess;
}

function clone(value) {
  return structuredClone(value);
}

function isAdmin(principal) {
  return principal?.role === "admin" || principal?.roles?.includes?.("admin");
}

function historyEntry({ now, action, actor, person = null, slotId = "", from = "red", to = "red", detail = "" }) {
  return {
    id: crypto.randomUUID(), at: now, action,
    actorId: String(actor?.id || "system"), actorName: String(actor?.name || "System"),
    personId: String(person?.id || ""), personName: String(person?.name || ""),
    slotId: String(slotId || ""), from, to, detail,
  };
}

function appendHistory(grid, entries) {
  grid.history = [...(grid.history || []), ...entries].slice(-HISTORY_LIMIT);
}

function slotExpired(slot, now) {
  return viennaDateTimeMs(slot.date, slot.end) <= now;
}

function normalizeExpired(state, now) {
  let changed = false;
  for (const grid of state.grids) {
    const expiredIds = new Set(grid.slots.filter((slot) => slotExpired(slot, now)).map(({ id }) => id));
    const removed = grid.entries.filter((entry) => entry.status === "waitlist" && expiredIds.has(entry.slotId));
    if (!removed.length) continue;
    const participants = new Map(grid.participants.map((person) => [person.id, person]));
    grid.entries = grid.entries.filter((entry) => !(entry.status === "waitlist" && expiredIds.has(entry.slotId)));
    appendHistory(grid, removed.map((entry) => historyEntry({
      now, action: "waitlist_expired", actor: null, person: participants.get(entry.personId), slotId: entry.slotId,
      from: "waitlist", to: "red",
    })));
    grid.updatedAt = now;
    changed = true;
  }
  return changed;
}

function projectedGrid(grid, revision, principal) {
  const waitlists = new Map();
  for (const slot of grid.slots) {
    const values = grid.entries.filter((entry) => entry.slotId === slot.id && entry.status === "waitlist")
      .sort((left, right) => left.queuedAt - right.queuedAt || left.personId.localeCompare(right.personId));
    values.forEach((entry, index) => waitlists.set(`${entry.slotId}:${entry.personId}`, index + 1));
  }
  return {
    id: grid.id, name: grid.name, description: grid.description, mode: grid.mode,
    capacity: grid.capacity, waitlistEnabled: grid.waitlistEnabled, fairUse: clone(grid.fairUse),
    active: grid.active, participants: clone(grid.participants), slots: clone(grid.slots),
    entries: grid.entries.map((entry) => ({
      slotId: entry.slotId, personId: entry.personId, status: entry.status,
      ...(entry.status === "waitlist" ? { waitlistPosition: waitlists.get(`${entry.slotId}:${entry.personId}`) } : {}),
    })),
    revision, canAdminister: isAdmin(principal), currentPersonId: principal?.id || "",
    createdAt: grid.createdAt, updatedAt: grid.updatedAt,
  };
}

class HallTimeService {
  constructor({ repository, messagingService = null, publish = () => {}, log = () => {}, now = Date.now } = {}) {
    this.repository = repository;
    this.messagingService = messagingService;
    this.publish = publish;
    this.log = log;
    this.now = now;
  }

  snapshot({ normalize = true } = {}) {
    if (normalize) this.cleanupExpired();
    const snapshot = this.repository.getState(STATE_KEY, EMPTY_STATE);
    if (!snapshot.value || !Array.isArray(snapshot.value.grids)) throw new AppError("STATE_CORRUPT", "Hallenzeiten-State ist ungueltig", 503);
    return snapshot;
  }

  cleanupExpired() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = this.repository.getState(STATE_KEY, EMPTY_STATE);
      if (!snapshot.value || !Array.isArray(snapshot.value.grids)) throw new AppError("STATE_CORRUPT", "Hallenzeiten-State ist ungueltig", 503);
      const value = clone(snapshot.value);
      const before = new Map(value.grids.map((grid) => [grid.id, grid.entries.filter(({ status }) => status === "waitlist").length]));
      if (!normalizeExpired(value, this.now())) return { changed: false, revision: snapshot.revision };
      try {
        const result = this.repository.setState(STATE_KEY, value, snapshot.revision);
        const changedGridIds = value.grids.filter((grid) => grid.entries.filter(({ status }) => status === "waitlist").length !== before.get(grid.id)).map(({ id }) => id);
        for (const gridId of changedGridIds) this.publish("hall-times", { gridId, revision: result.revision });
        this.log("info", "hall_time_expiration_completed", { gridCount: changedGridIds.length, revision: result.revision, result: "success" });
        return { changed: true, revision: result.revision, gridIds: changedGridIds };
      } catch (error) {
        if (error.code !== "REVISION_CONFLICT") throw error;
      }
    }
    throw new AppError("REVISION_CONFLICT", "Hallenzeiten wurden gleichzeitig geaendert", 409);
  }

  visibleGrids(principal) {
    const snapshot = this.snapshot();
    return {
      success: true,
      revision: snapshot.revision,
      grids: snapshot.value.grids
        .filter((grid) => grid.active && (isAdmin(principal) || grid.participants.some(({ id }) => id === principal.id)))
        .map(({ id, name, mode }) => ({ id, name, mode }))
        .sort((left, right) => left.name.localeCompare(right.name, "de")),
    };
  }

  canView(principal, gridId) {
    const grid = this.snapshot().value.grids.find(({ id }) => id === gridId);
    return Boolean(grid?.active && (isAdmin(principal) || grid.participants.some(({ id }) => id === principal.id)));
  }

  grid(principal, gridId) {
    const snapshot = this.snapshot();
    const grid = snapshot.value.grids.find(({ id }) => id === gridId);
    if (!grid || !grid.active) throw new AppError("HALL_TIME_GRID_NOT_FOUND", "Hallenzeiten-Raster wurde nicht gefunden", 404);
    if (!isAdmin(principal) && !grid.participants.some(({ id }) => id === principal.id)) throw new AppError("FORBIDDEN", "Berechtigung fuer diesen Hallenzeiten-Raster fehlt", 403);
    return { success: true, grid: projectedGrid(grid, snapshot.revision, principal) };
  }

  history(principal, gridId) {
    const snapshot = this.snapshot();
    const grid = snapshot.value.grids.find(({ id }) => id === gridId);
    if (!grid || !grid.active) throw new AppError("HALL_TIME_GRID_NOT_FOUND", "Hallenzeiten-Raster wurde nicht gefunden", 404);
    if (!isAdmin(principal) && !grid.participants.some(({ id }) => id === principal.id)) throw new AppError("FORBIDDEN", "Berechtigung fuer diesen Hallenzeiten-Raster fehlt", 403);
    const slots = new Map(grid.slots.map((slot) => [slot.id, slot]));
    return {
      success: true,
      entries: [...(grid.history || [])].reverse().map((entry) => ({ ...clone(entry), slot: slots.get(entry.slotId) || null })),
    };
  }

  adminGrids(principal) {
    if (!isAdmin(principal)) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    const snapshot = this.snapshot();
    return { success: true, revision: snapshot.revision, grids: snapshot.value.grids.map((grid) => projectedGrid(grid, snapshot.revision, principal)) };
  }

  saveGrid(principal, request, participantNames) {
    if (!isAdmin(principal)) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    const now = this.now();
    const endpoint = "adminSaveHallTimeGrid";
    const actorKey = `user:${principal.id}`;
    const payload = { ...request, participantNames: undefined };
    const operation = this.repository.applyStateOperation({
      stateKey: STATE_KEY, fallback: EMPTY_STATE, expectedRevision: request.expectedRevision,
      actorKey, operationId: request.operationId, endpoint, payload,
      update: (state) => {
        normalizeExpired(state, now);
        const existingIndex = request.gridId ? state.grids.findIndex(({ id }) => id === request.gridId) : -1;
        if (request.gridId && existingIndex < 0) throw new AppError("HALL_TIME_GRID_NOT_FOUND", "Hallenzeiten-Raster wurde nicht gefunden", 404);
        if (state.grids.some((grid, index) => index !== existingIndex && grid.active && request.active && grid.name.toLocaleLowerCase("de") === request.name.toLocaleLowerCase("de"))) {
          throw new AppError("HALL_TIME_NAME_CONFLICT", "Ein aktiver Raster mit diesem Namen ist bereits vorhanden", 409);
        }
        const existing = existingIndex >= 0 ? state.grids[existingIndex] : null;
        const oldSlots = new Map((existing?.slots || []).map((slot) => [slot.id, slot]));
        const slots = request.slots.map((slot) => ({ ...slot, id: slot.id || crypto.randomUUID() }))
          .sort((left, right) => `${left.date}T${left.start}`.localeCompare(`${right.date}T${right.start}`));
        const slotIds = new Set(slots.map(({ id }) => id));
        const participantIds = new Set(request.participantIds);
        let entries = clone(existing?.entries || []);
        for (const oldSlot of oldSlots.values()) {
          if (slotExpired(oldSlot, now) && !slotIds.has(oldSlot.id)) throw new AppError("HALL_TIME_PAST_SLOT_LOCKED", "Vergangene Termine duerfen nicht entfernt werden", 409);
        }
        entries = entries.filter((entry) => {
          const oldSlot = oldSlots.get(entry.slotId);
          if (oldSlot && slotExpired(oldSlot, now)) return true;
          return slotIds.has(entry.slotId) && participantIds.has(entry.personId);
        });
        for (const slot of slots) {
          const confirmed = entries.filter((entry) => entry.slotId === slot.id && entry.status === "confirmed").length;
          const waiting = entries.some((entry) => entry.slotId === slot.id && entry.status === "waitlist");
          if (confirmed > request.capacity) throw new AppError("HALL_TIME_CAPACITY_CONFLICT", "Die neue Kapazitaet liegt unter der bestehenden Belegung", 409);
          if (!request.waitlistEnabled && waiting) throw new AppError("HALL_TIME_WAITLIST_CONFLICT", "Vor dem Deaktivieren der Warteliste muessen wartende Eintraege entfernt werden", 409);
        }
        const grid = {
          id: existing?.id || crypto.randomUUID(), name: request.name, description: request.description,
          mode: request.mode, capacity: request.capacity, waitlistEnabled: request.waitlistEnabled,
          fairUse: clone(request.fairUse), active: request.active,
          participants: request.participantIds.map((id) => ({ id, name: participantNames.get(id) || id })),
          slots, entries, history: clone(existing?.history || []), createdAt: existing?.createdAt || now, updatedAt: now,
        };
        appendHistory(grid, [historyEntry({ now, action: existing ? "grid_updated" : "grid_created", actor: principal, detail: grid.name })]);
        if (existingIndex >= 0) state.grids[existingIndex] = grid; else state.grids.push(grid);
        return state;
      },
      resultForSnapshot: (snapshot) => {
        const grid = snapshot.value.grids.find(({ id }) => id === request.gridId) || snapshot.value.grids.at(-1);
        return { success: true, grid: projectedGrid(grid, snapshot.revision, principal), revision: snapshot.revision };
      },
    });
    if (!operation.repeated) this.publish("hall-times", { gridId: operation.result.grid.id, revision: operation.result.revision });
    return { ...operation.result, repeated: operation.repeated };
  }

  async setBooking(principal, request) {
    const now = this.now();
    const endpoint = "setHallTimeBooking";
    let promoted = null;
    const operation = this.repository.applyStateOperation({
      stateKey: STATE_KEY, fallback: EMPTY_STATE,
      actorKey: `user:${principal.id}`, operationId: request.operationId, endpoint,
      payload: request,
      update: (state) => {
        normalizeExpired(state, now);
        const grid = state.grids.find(({ id }) => id === request.gridId);
        if (!grid?.active) throw new AppError("HALL_TIME_GRID_NOT_FOUND", "Hallenzeiten-Raster wurde nicht gefunden", 404);
        const admin = isAdmin(principal);
        const personId = admin && request.personId ? request.personId : principal.id;
        if (!admin && request.personId && request.personId !== principal.id) throw new AppError("FORBIDDEN", "Nur die eigene Einteilung darf geaendert werden", 403);
        const person = grid.participants.find(({ id }) => id === personId);
        if (!person || (!admin && !grid.participants.some(({ id }) => id === principal.id))) throw new AppError("FORBIDDEN", "Spieler ist diesem Raster nicht zugeordnet", 403);
        const slot = grid.slots.find(({ id }) => id === request.slotId);
        if (!slot) throw new AppError("HALL_TIME_SLOT_NOT_FOUND", "Termin wurde nicht gefunden", 404);
        if (!admin && slotExpired(slot, now)) throw new AppError("HALL_TIME_PAST_LOCKED", "Vergangene Termine koennen nur durch Administratoren korrigiert werden", 409);
        const currentIndex = grid.entries.findIndex((entry) => entry.slotId === slot.id && entry.personId === personId);
        const current = currentIndex >= 0 ? grid.entries[currentIndex] : null;
        const events = [];
        if (!request.selected) {
          if (!current) return state;
          grid.entries.splice(currentIndex, 1);
          events.push(historyEntry({ now, action: "booking_removed", actor: principal, person, slotId: slot.id, from: current.status, to: "red" }));
          if (current.status === "confirmed") {
            const next = grid.entries.filter((entry) => entry.slotId === slot.id && entry.status === "waitlist")
              .sort((left, right) => left.queuedAt - right.queuedAt || left.personId.localeCompare(right.personId))[0];
            if (next) {
              next.status = "confirmed";
              const promotedPerson = grid.participants.find(({ id }) => id === next.personId);
              promoted = { person: promotedPerson, grid, slot };
              events.push(historyEntry({ now, action: "waitlist_promoted", actor: null, person: promotedPerson, slotId: slot.id, from: "waitlist", to: "confirmed" }));
            }
          }
        } else if (!current) {
          if (!admin && grid.mode === "fair_use") {
            const personal = grid.entries.filter((entry) => entry.personId === personId && ["confirmed", "waitlist"].includes(entry.status)).length;
            const average = grid.participants.length ? grid.entries.filter((entry) => ["confirmed", "waitlist"].includes(entry.status)).length / grid.participants.length : 0;
            const daysUntil = dateOrdinal(slot.date) - dateOrdinal(localDate(now));
            let limit = Infinity;
            if (daysUntil > grid.fairUse.extendedDays) limit = grid.fairUse.base;
            else if (daysUntil > grid.fairUse.openDays) limit = Math.max(grid.fairUse.base, Math.floor(average * (1 + grid.fairUse.percent / 100)));
            if (personal + 1 > limit) throw new AppError("HALL_TIME_FAIR_USE_LIMIT", `FairUse erlaubt derzeit hoechstens ${limit} Reservierungen`, 409, { limit });
          }
          const confirmed = grid.entries.filter((entry) => entry.slotId === slot.id && entry.status === "confirmed").length;
          const status = confirmed < grid.capacity ? "confirmed" : "waitlist";
          if (status === "waitlist" && !grid.waitlistEnabled) throw new AppError("HALL_TIME_SLOT_FULL", "Dieser Termin ist bereits voll belegt", 409);
          grid.entries.push({ slotId: slot.id, personId, status, queuedAt: now });
          events.push(historyEntry({ now, action: status === "confirmed" ? "booking_added" : "waitlist_added", actor: principal, person, slotId: slot.id, from: "red", to: status }));
        }
        appendHistory(grid, events);
        grid.updatedAt = now;
        return state;
      },
      resultForSnapshot: (snapshot) => {
        const grid = snapshot.value.grids.find(({ id }) => id === request.gridId);
        return { success: true, grid: projectedGrid(grid, snapshot.revision, principal), revision: snapshot.revision };
      },
    });
    if (!operation.repeated) {
      this.publish("hall-times", { gridId: request.gridId, revision: operation.result.revision });
      if (promoted?.person?.id && this.messagingService) {
        const dateLabel = promoted.slot.date.split("-").reverse().join(".");
        try {
          await this.messagingService.ensureMessage({
            identity: `hall-time-promotion:${request.operationId}:${promoted.person.id}`,
            recipientId: promoted.person.id, createdAt: now,
            subject: `Fixplatz in ${promoted.grid.name}`,
            body: `Du bist für den Termin am ${dateLabel} von der Warteliste auf einen Fixplatz nachgerückt.`,
            type: "hall_time_promotion", matchId: promoted.slot.id, actorId: principal.id,
          });
        } catch (error) {
          this.log("warn", "hall_time_promotion_message_failed", {
            gridId: promoted.grid.id, slotId: promoted.slot.id, recipientId: promoted.person.id,
            errorCode: error.code || "MESSAGING_WRITE_FAILED",
          });
        }
      }
    }
    return { ...operation.result, repeated: operation.repeated };
  }

  distribute(principal, request) {
    if (!isAdmin(principal)) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403);
    const now = this.now();
    const operation = this.repository.applyStateOperation({
      stateKey: STATE_KEY, fallback: EMPTY_STATE, expectedRevision: request.expectedRevision,
      actorKey: `user:${principal.id}`, operationId: request.operationId, endpoint: "adminDistributeHallTimeGrid", payload: request,
      update: (state) => {
        normalizeExpired(state, now);
        const grid = state.grids.find(({ id }) => id === request.gridId);
        if (!grid?.active) throw new AppError("HALL_TIME_GRID_NOT_FOUND", "Hallenzeiten-Raster wurde nicht gefunden", 404);
        if (grid.mode !== "equal") throw new AppError("HALL_TIME_MODE_INVALID", "Automatische Verteilung ist nur im Modus Gleichberechtigte Aufteilung verfuegbar", 409);
        if (!grid.participants.length) throw new AppError("HALL_TIME_NO_PARTICIPANTS", "Dem Raster sind keine Spieler zugeordnet", 409);
        const futureSlots = grid.slots.filter((slot) => !slotExpired(slot, now));
        const futureIds = new Set(futureSlots.map(({ id }) => id));
        grid.entries = grid.entries.filter((entry) => !futureIds.has(entry.slotId));
        const counts = new Map(grid.participants.map(({ id }) => [id, grid.entries.filter((entry) => entry.personId === id && entry.status === "confirmed").length]));
        let previous = new Set();
        const generatedEvents = [];
        futureSlots.forEach((slot, slotIndex) => {
          const selected = [...grid.participants].sort((left, right) => (
            counts.get(left.id) - counts.get(right.id)
            || Number(previous.has(left.id)) - Number(previous.has(right.id))
            || ((grid.participants.findIndex(({ id }) => id === left.id) - slotIndex) % grid.participants.length)
              - ((grid.participants.findIndex(({ id }) => id === right.id) - slotIndex) % grid.participants.length)
            || left.id.localeCompare(right.id)
          )).slice(0, Math.min(grid.capacity, grid.participants.length));
          previous = new Set(selected.map(({ id }) => id));
          for (const person of selected) {
            grid.entries.push({ slotId: slot.id, personId: person.id, status: "confirmed", queuedAt: now });
            counts.set(person.id, counts.get(person.id) + 1);
            generatedEvents.push(historyEntry({ now, action: "assigned_by_distribution", actor: principal, person, slotId: slot.id, from: "red", to: "confirmed" }));
          }
        });
        appendHistory(grid, [historyEntry({ now, action: "distribution_replaced", actor: principal, detail: `${futureSlots.length}` }), ...generatedEvents]);
        grid.updatedAt = now;
        return state;
      },
      resultForSnapshot: (snapshot) => {
        const grid = snapshot.value.grids.find(({ id }) => id === request.gridId);
        return { success: true, grid: projectedGrid(grid, snapshot.revision, principal), revision: snapshot.revision };
      },
    });
    if (!operation.repeated) this.publish("hall-times", { gridId: request.gridId, revision: operation.result.revision });
    return { ...operation.result, repeated: operation.repeated };
  }
}

module.exports = { HallTimeService, localDate, viennaDateTimeMs };
