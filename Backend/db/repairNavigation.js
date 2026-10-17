"use strict";

const { OpsRepository } = require("./repositories/opsRepository");

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function planNavigation(rows, profile, order) {
  if (!/^[A-Za-z0-9_.:-]{1,50}$/.test(profile) || !Array.isArray(order) || !order.length || order.length > 500
    || order.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) || new Set(order).size !== order.length) fail("NAVIGATION_REPAIR_ORDER_INVALID");
  const selected = rows.filter((row) => row.profile_code === profile);
  if (selected.length !== order.length || selected.some((row) => !order.includes(row.contract_id))) fail("NAVIGATION_REPAIR_SOURCE_MISMATCH");
  const changes = [];
  for (const row of rows) {
    const change = { id: row.id, targetType: row.target_type, pageKey: row.page_key, sortOrder: row.sort_order };
    let changed = false;
    if (!row.enabled && row.problem_code === "NAVIGATION_TARGET_INVALID" && /^OL-Platz-[12]$/i.test(row.legacy_target || "")) {
      change.targetType = "court_assignment";
      change.pageKey = row.legacy_target.slice(-1);
      change.restoreAction = true;
      changed = true;
    } else if (!row.enabled && row.problem_code === "NAVIGATION_TARGET_INVALID" && /^OL-Platzaktivierung$/i.test(row.legacy_target || "")) {
      change.targetType = "court_activation";
      change.pageKey = null;
      change.restoreAction = true;
      changed = true;
    }
    if (row.profile_code === profile && row.sort_order !== order.indexOf(row.contract_id) + 1) {
      change.sortOrder = order.indexOf(row.contract_id) + 1;
      changed = true;
    }
    if (changed) changes.push(change);
  }
  return changes;
}

async function repairNavigation({ venue, profile, order, apply = false, log = () => {} }) {
  const startedAt = Date.now();
  const { database, context } = venue;
  const read = (target, lock = false) => target.query(`
    SELECT id, contract_id, profile_code, target_type, page_key, enabled, problem_code, legacy_target, sort_order
      FROM venue.navigation_presets WHERE tenant_id=$1::uuid ORDER BY id ${lock ? "FOR UPDATE" : ""}
  `, [context.tenantId]);
  try {
    if (!apply) {
      const changes = planNavigation((await read(database)).rows, profile, order);
      log("info", "navigation_repair_completed", { result: "success", applied: false, changedCount: changes.length, durationMs: Date.now() - startedAt });
      return { changedCount: changes.length, applied: false };
    }
    const ops = new OpsRepository({ database, context, sourceInstance: "devel", log, auditContracts: {
      "navigation.repair": { before: { profile: "id", entryCount: "count" }, after: { changedCount: "count" } },
    } });
    const result = await ops.executeAudited({
      audit: { actorType: "system", action: "navigation.repair", subjectType: "navigation_profile", subjectId: profile, before: { profile, entryCount: order?.length || 0 } },
      transactionOperation: "navigation.repair",
    }, async (transaction) => {
      const changes = planNavigation((await read(transaction, true)).rows, profile, order);
      for (const change of changes) {
        await transaction.query(`
          UPDATE venue.navigation_presets SET target_type=$3, page_key=$4, sort_order=$5,
            enabled=CASE WHEN $6 THEN true ELSE enabled END,
            problem_code=CASE WHEN $6 THEN NULL ELSE problem_code END,
            legacy_target=CASE WHEN $6 THEN NULL ELSE legacy_target END
          WHERE tenant_id=$1::uuid AND id=$2::uuid
        `, [context.tenantId, change.id, change.targetType, change.pageKey, change.sortOrder, !!change.restoreAction]);
      }
      return { changedCount: changes.length, applied: true, auditAfter: { changedCount: changes.length } };
    });
    log("info", "navigation_repair_completed", { result: "success", applied: true, changedCount: result.changedCount, durationMs: Date.now() - startedAt });
    return { changedCount: result.changedCount, applied: true };
  } catch (error) {
    log("error", "navigation_repair_completed", { result: error.code === "DB_COMMIT_OUTCOME_UNKNOWN" ? "unknown" : "failed", errorCode: error.code || "NAVIGATION_REPAIR_FAILED", durationMs: Date.now() - startedAt });
    throw error;
  }
}

module.exports = { planNavigation, repairNavigation };
