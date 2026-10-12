"use strict";

const KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,126}$/;
const SECTION_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;

class CoreRepository {
  constructor({ database, context }) {
    this.database = database;
    this.context = context;
  }

  async tenant() {
    const result = await this.database.query(`
      SELECT id::text AS id, tenant_code AS "tenantCode", display_name AS "displayName",
             time_zone AS "timeZone", locale, created_at AS "createdAt"
        FROM core.tenants
       WHERE id=$1::uuid
    `, [this.context.tenantId]);
    return result.rows[0] || null;
  }

  async section(sectionCode = "tennis") {
    if (!SECTION_PATTERN.test(sectionCode)) throw Object.assign(new Error("SECTION_CODE_INVALID"), { code: "SECTION_CODE_INVALID" });
    const result = await this.database.query(`
      SELECT id::text AS id, section_code AS "sectionCode", display_name AS "displayName",
             active, revision::text, updated_at AS "updatedAt"
        FROM core.sections
       WHERE tenant_id=$1::uuid AND section_code=$2
    `, [this.context.tenantId, sectionCode]);
    return result.rows[0] || null;
  }

  async configuration(configurationKey) {
    if (!KEY_PATTERN.test(configurationKey)) throw Object.assign(new Error("CONFIGURATION_KEY_INVALID"), { code: "CONFIGURATION_KEY_INVALID" });
    const result = await this.database.query(`
      SELECT configuration_key AS key, value, revision::text, updated_at AS "updatedAt"
        FROM core.configuration_entries
       WHERE tenant_id=$1::uuid AND configuration_key=$2
    `, [this.context.tenantId, configurationKey]);
    return result.rows[0] || null;
  }

  async projectionRevision(projectionKey) {
    if (!KEY_PATTERN.test(projectionKey)) throw Object.assign(new Error("PROJECTION_KEY_INVALID"), { code: "PROJECTION_KEY_INVALID" });
    const result = await this.database.query(`
      SELECT revision::text AS revision, updated_at AS "updatedAt"
        FROM core.projection_revisions
       WHERE tenant_id=$1::uuid AND projection_key=$2
    `, [this.context.tenantId, projectionKey]);
    return result.rows[0] || null;
  }
}

module.exports = { CoreRepository };
