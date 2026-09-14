const test = require("node:test");
const assert = require("node:assert/strict");
const { headerOf } = require("../tableUtils.js");
const { hasRole, rolesFromRow } = require("../personRoles.js");

test("new people fields support member plus admin and operator with admin inheritance", () => {
  const header = headerOf([["ID", "Role", "Mitglied", "Admin", "Operator"]]);
  const memberAdmin = rolesFromRow(header, ["p1", "player", "player A", "1", ""]);
  assert.deepEqual(memberAdmin, { usesNewFields: true, member: "player A", roles: ["player", "admin", "operator"], explicitRoles: ["admin"], role: "admin" });
  assert.equal(hasRole(memberAdmin, "player"), true);
  assert.equal(hasRole(memberAdmin, "operator"), true);

  const legacyAdmin = rolesFromRow(header, ["p2", "admin", "", "", ""]);
  assert.deepEqual(legacyAdmin, { usesNewFields: false, member: "", roles: ["admin", "operator"], explicitRoles: ["admin"], role: "admin" });
});

test("any populated new field disables the legacy Role fallback", () => {
  const header = headerOf([["ID", "Role", "Mitglied", "Admin", "Operator"]]);
  const roles = rolesFromRow(header, ["p1", "admin", "player B", "", ""]);
  assert.deepEqual(roles, { usesNewFields: true, member: "player B", roles: ["player"], explicitRoles: [], role: "player" });
});
