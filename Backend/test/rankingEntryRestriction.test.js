const test = require("node:test");
const assert = require("node:assert/strict");
const { rankingEntryRestriction } = require("../rankingEntryRestriction");
const { PostgresPlayService } = require("../postgresPlayService");

test("Einstiegsgrenze bleibt bewerbsbezogen, wechselt nach weiterer Niederlage und endet exakt", () => {
  const header = ["Ignore", "BewerbID", "Spieler1ID", "EinstiegAbRang", "EinstiegFreiAb"];
  const rows = [header,
    ["", "2", "3 [wo]", "18", "2027-10-20T10:00:00Z"],
    ["", "2", "3", "28", "2027-10-28T10:00:00Z"],
    ["1", "2", "3", "38", "2027-11-20T10:00:00Z"],
    ["", "4", "3", "99", "2027-12-20T10:00:00Z"],
  ];
  const now = Date.parse("2027-10-28T10:00:00Z");
  assert.deepEqual(rankingEntryRestriction(rows, "2", "3", now - 1), { minimumRank: 28, expiresAt: now, active: true });
  assert.equal(rankingEntryRestriction(rows, "2", "3", now).active, false);
  assert.equal(rankingEntryRestriction(rows, "2", "4", now), null);
  assert.equal(rankingEntryRestriction([header, rows[1]], "2", "3", now - 1).minimumRank, 18);
  assert.equal(rankingEntryRestriction([["ID"]], "2", "3", now), null);
});

test("Fehlender Zielrang fuehrt auch bei einer Rangluecke zur letzten Position", async () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ id: `r${index + 1}`, person_id: String(index + 1), rank: index + 1, status: "active" })).filter(row => row.rank !== 18);
  const service = new PostgresPlayService({});
  const changes = await service.rankingTargets({ query: async () => ({ rows }) },
    { competition_type_id: "2", competition_id: "test", entry_target_rank: 8 },
    [{ side_no: 1, person_id: "99", internal_person_id: "new" }, { side_no: 2, person_id: "8" }], 2);
  assert.equal(changes.at(-1).afterRank, 31);
});
