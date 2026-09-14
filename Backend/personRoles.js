const { headerIndex } = require("./tableUtils.js");

const MEMBER_ROLES = new Set(["player", "player a", "player b"]);

function memberRole(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!MEMBER_ROLES.has(normalized)) return "";
  return normalized === "player a" ? "player A" : normalized === "player b" ? "player B" : "player";
}

function rolesFromRow(header, row) {
  const memberIndex = headerIndex(header, "mitglied");
  const adminIndex = headerIndex(header, "admin");
  const operatorIndex = headerIndex(header, "operator");
  const newValues = [memberIndex, adminIndex, operatorIndex].map((index) => index < 0 ? "" : String(row[index] || "").trim());
  const usesNewFields = newValues.some(Boolean);
  const roles = new Set();
  const explicitRoles = new Set();
  let member = "";
  if (usesNewFields) {
    member = memberRole(newValues[0]);
    if (member) roles.add("player");
    if (newValues[2] === "1") {
      roles.add("operator");
      explicitRoles.add("operator");
    }
    if (newValues[1] === "1") {
      roles.add("admin");
      explicitRoles.add("admin");
      roles.add("operator");
    }
  } else {
    const legacy = String(row[headerIndex(header, "role")] || "").trim().toLowerCase();
    if (MEMBER_ROLES.has(legacy)) {
      member = memberRole(legacy);
      roles.add("player");
    }
    else if (legacy === "admin") roles.add("admin"), explicitRoles.add("admin"), roles.add("operator");
    else if (legacy === "operator") roles.add("operator"), explicitRoles.add("operator");
    else roles.add("player");
  }
  const role = roles.has("admin") ? "admin" : roles.has("operator") ? "operator" : "player";
  return { usesNewFields, member, roles: [...roles], explicitRoles: [...explicitRoles], role };
}

function hasRole(principal, role) {
  return Array.isArray(principal?.roles) ? principal.roles.includes(role) : principal?.role === role;
}

function hasAnyRole(principal, roles) {
  return roles.some((role) => hasRole(principal, role));
}

module.exports = { hasAnyRole, hasRole, memberRole, rolesFromRow };
