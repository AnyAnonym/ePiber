"use strict";

const { PostgresProjectionService } = require("../postgresProjectionService");

async function projectCompetitions(competitions, {
  people = [{ id: "1", firstName: "Ada", lastName: "Test", active: true, role: "player", member: "player", assignedRoles: [] }],
  rankings = [],
} = {}) {
  return new PostgresProjectionService({
    identity: { people: async () => people },
    venue: { navigationPresets: async () => [] },
    play: {
      competitions: async () => competitions.map((competition) => ({
        competitionTypeId: "3", defaultMatchFormatId: null, genderCodes: [], minimumAge: null, maximumAge: null, sortOrder: null,
        ...competition,
      })),
      competitionTypes: async () => [
        { id: "2", name: "Rangliste", entryListAvailable: false, roundRobin: false },
        { id: "3", name: "KO", entryListAvailable: true, roundRobin: false },
        { id: "7", name: "Gruppenphase", entryListAvailable: true, roundRobin: true },
      ],
      matchFormats: async () => [],
      entries: async () => [],
      matches: async () => [],
      rankings: async () => rankings,
    },
  }).load();
}

module.exports = { projectCompetitions };
