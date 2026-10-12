"use strict";

const { AppError } = require("./errors.js");
const { DEFAULT_SETTINGS, FrontendLoggingService, validateSettings } = require("./frontendLoggingService.js");
const { idValue, integerValue, requireObject, stringValue } = require("./validators.js");

const LEVELS = new Set(["debug", "info", "warn", "error"]);

function exact(value, keys) {
  const object = requireObject(value, "target");
  for (const key of Object.keys(object)) if (!keys.has(key)) throw new AppError("VALIDATION_ERROR", `target.${key} ist nicht erlaubt`);
  return object;
}

function levelValue(value) {
  const level = stringValue(value, "level", { max: 16 }).toLowerCase();
  if (!LEVELS.has(level)) throw new AppError("VALIDATION_ERROR", "level ist ungueltig");
  return level;
}

class CacheRepository {
  constructor(snapshot) { this.snapshot = snapshot; }
  getState(key, fallback) {
    if (key === "frontend-logging:settings") {
      const { revision, ...value } = this.snapshot.settings;
      return { value, revision, updatedAt: null };
    }
    if (key === "frontend-logging:targets") return { ...this.snapshot.targets, updatedAt: null };
    return { value: fallback, revision: 0, updatedAt: null };
  }
}

class PostgresFrontendLoggingService extends FrontendLoggingService {
  static async create({ identityRepository, log, appVersion, now = Date.now }) {
    const [snapshot, people] = await Promise.all([identityRepository.frontendLoggingSnapshot(), identityRepository.people()]);
    return new PostgresFrontendLoggingService({ identityRepository, snapshot, people, log, appVersion, now });
  }

  constructor({ identityRepository, snapshot, people, log, appVersion, now }) {
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const repository = new CacheRepository(snapshot);
    super({
      repository,
      authService: { parsePeople: () => [...peopleById.values()], findById: (id) => peopleById.get(String(id)) || null },
      log,
      appVersion,
      now,
    });
    this.identityRepository = identityRepository;
    this.cacheRepository = repository;
  }

  targetsSnapshot() {
    const snapshot = this.cacheRepository.snapshot.targets;
    const now = this.now();
    return {
      value: Object.fromEntries(Object.entries(snapshot.value).filter(([, target]) => target.expiresAt > now)),
      revision: snapshot.revision,
      updatedAt: null,
    };
  }

  async refresh() {
    this.cacheRepository.snapshot = await this.identityRepository.frontendLoggingSnapshot();
  }

  mapError(error, message) {
    if (error.code === "REVISION_CONFLICT") return new AppError("REVISION_CONFLICT", message, 409);
    if (error.code === "PERSON_NOT_FOUND") return new AppError("PERSON_NOT_FOUND", "Aktive Person wurde nicht gefunden", 404);
    return error;
  }

  async updateSettings(value) {
    const current = this.settingsSnapshot();
    const { expectedRevision, settings } = validateSettings(value, current);
    try {
      const stored = await this.identityRepository.updateFrontendLoggingSettings(settings, expectedRevision);
      this.cacheRepository.snapshot.settings = { ...stored.value, revision: stored.revision };
      return stored;
    } catch (error) {
      throw this.mapError(error, "Logging-Einstellungen wurden zwischenzeitlich geaendert");
    }
  }

  async setTarget(value, principal) {
    const body = exact(value, new Set(["expectedRevision", "personId", "level", "durationMinutes"]));
    const expectedRevision = integerValue(body.expectedRevision, "expectedRevision", { min: 0 });
    const personId = idValue(body.personId, "personId");
    const level = levelValue(body.level);
    const durationMinutes = integerValue(body.durationMinutes, "durationMinutes", { min: 15, max: DEFAULT_SETTINGS.maxTargetDurationMinutes });
    try {
      const result = await this.identityRepository.setFrontendLoggingTarget({ personId, level, durationMinutes, expectedRevision, createdBy: principal.id });
      this.cacheRepository.snapshot.targets.value[personId] = result.target;
      this.cacheRepository.snapshot.targets.revision = result.revision;
      return result;
    } catch (error) {
      throw this.mapError(error, "Logging-Ziele wurden zwischenzeitlich geaendert");
    }
  }

  async removeTarget(value) {
    const body = exact(value, new Set(["expectedRevision", "personId"]));
    const expectedRevision = integerValue(body.expectedRevision, "expectedRevision", { min: 0 });
    const personId = idValue(body.personId, "personId");
    try {
      const result = await this.identityRepository.removeFrontendLoggingTarget({ personId, expectedRevision });
      if (result.removed) delete this.cacheRepository.snapshot.targets.value[personId];
      this.cacheRepository.snapshot.targets.revision = result.revision;
      return result;
    } catch (error) {
      throw this.mapError(error, "Logging-Ziele wurden zwischenzeitlich geaendert");
    }
  }
}

module.exports = { PostgresFrontendLoggingService };
