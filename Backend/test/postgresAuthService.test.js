"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PostgresAuthService } = require("../postgresAuthService");
const { hasAnyRole, rolesFromRow } = require("../personRoles");

test("PostgreSQL-Mitgliedsklassen behalten ihre Anzeige und erhalten Legacy-Spielerrechte", () => {
  const auth = new PostgresAuthService({ repository: {}, rateLimitSecret: Buffer.alloc(32, 7) });
  for (const member of ["player", "player A", "player B"]) {
    for (const assignedRoles of [[], ["operator"], ["admin", "operator"]]) {
      const role = assignedRoles.includes("admin") ? "admin" : assignedRoles.includes("operator") ? "operator" : member;
      const person = { id: "3", role, member, assignedRoles };
      const result = auth.authResult({ session: { expiresAt: 123 }, person });
      const legacy = rolesFromRow(["mitglied", "admin", "operator"], [member, assignedRoles.includes("admin") ? "1" : "", assignedRoles.includes("operator") ? "1" : ""]);
      assert.equal(result.user.member, member);
      assert.equal(result.user.role, role);
      assert.deepEqual(result.user.roles, result.principal.roles);
      for (const permission of ["player", "operator", "admin"]) {
        assert.equal(hasAnyRole(result.principal, [permission]), hasAnyRole(legacy, [permission]), `${member}: ${permission}`);
      }
      assert.equal(hasAnyRole(result.principal, ["player", "player a", "player b", "admin"]), true);
      assert.equal(new Set(result.principal.roles).size, result.principal.roles.length);
    }
  }
});
