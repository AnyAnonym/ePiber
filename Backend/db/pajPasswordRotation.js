"use strict";

const crypto = require("node:crypto");
const { deriveScryptCredential } = require("./passwordCredential");

const AUDIT_ACTION = "paj.password.rotate_all";
const ROTATION_LOCK = 738_410_227;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rotationError(code, message) { return Object.assign(new Error(message), { code }); }

async function rotateAllPajPasswords({ repositories, clientHash, operationId = crypto.randomUUID(), failAfterCredentialUpdate = false }) {
  if (!repositories?.ops?.executeAudited) throw rotationError("PAJ_PASSWORD_ROTATION_REPOSITORY_INVALID", "Operationsrepository fehlt");
  if (!UUID_PATTERN.test(operationId)) throw rotationError("PAJ_PASSWORD_ROTATION_ID_INVALID", "Rotations-ID ist ungueltig");
  const normalizedHash = String(clientHash || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedHash)) throw rotationError("PAJ_PASSWORD_HASH_INVALID", "Testpasswort-Hash ist ungueltig");

  const executed = await repositories.ops.executeAudited({
    audit: {
      operationId,
      actorType: "system",
      action: AUDIT_ACTION,
      subjectType: "tenant",
      subjectId: "devel-epiber",
      before: { scope: "all_accounts" },
    },
    transactionOperation: "identity.password.rotate_all",
    isolation: "serializable",
    retries: 2,
  }, async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock($1)", [ROTATION_LOCK]);
    const accounts = await transaction.query(`
      SELECT account.id::text AS id
        FROM identity.user_accounts account
       WHERE account.tenant_id=$1::uuid AND account.login IS NOT NULL
       ORDER BY account.id
       FOR UPDATE
    `, [repositories.ops.context.tenantId]);
    if (!accounts.rowCount) throw rotationError("PAJ_PASSWORD_ROTATION_NO_ACCOUNTS", "Keine PAJ-Loginkonten vorhanden");

    const current = await transaction.query(`
      SELECT count(*)::integer AS count
        FROM identity.credentials credential
        JOIN identity.user_accounts account ON account.id=credential.account_id
       WHERE account.tenant_id=$1::uuid AND account.login IS NOT NULL
         AND credential.credential_type='password' AND credential.active
    `, [repositories.ops.context.tenantId]);
    if (Number(current.rows[0].count) !== accounts.rowCount) {
      throw rotationError("PAJ_PASSWORD_ROTATION_CREDENTIAL_STATE_INVALID", "Aktiver Credentialbestand ist nicht eindeutig");
    }

    const namespace = `paj-password-rotation-v1\0${operationId}`;
    const accountIds = accounts.rows.map(({ id }) => id);
    const credentials = accountIds.map((id) => deriveScryptCredential(normalizedHash, namespace, id));
    await transaction.query(`
      UPDATE identity.credentials credential
         SET active=false, revoked_at=clock_timestamp(), secret_hash=NULL, revoked_reason='paj_bulk_rotation'
        FROM identity.user_accounts account
       WHERE credential.account_id=account.id AND account.tenant_id=$1::uuid
         AND account.login IS NOT NULL AND credential.credential_type='password' AND credential.active
    `, [repositories.ops.context.tenantId]);
    await transaction.query(`
      INSERT INTO identity.credentials(account_id,credential_type,credential_schema,secret_hash)
      SELECT source.account_id::uuid,'password','scrypt_v1',source.secret_hash
        FROM unnest($1::text[],$2::text[]) AS source(account_id,secret_hash)
    `, [accountIds, credentials]);
    if (failAfterCredentialUpdate) throw rotationError("PAJ_PASSWORD_ROTATION_TEST_ABORT", "Synthetischer Rotationsabbruch");

    await transaction.query(`
      UPDATE identity.user_accounts
         SET auth_revision=auth_revision+1, revision=revision+1, updated_at=clock_timestamp()
       WHERE tenant_id=$1::uuid AND login IS NOT NULL
    `, [repositories.ops.context.tenantId]);
    const sessions = await transaction.query(`
      UPDATE identity.sessions session SET revoked_at=clock_timestamp()
       FROM identity.user_accounts account
       WHERE session.account_id=account.id AND account.tenant_id=$1::uuid AND session.revoked_at IS NULL
       RETURNING session.id
    `, [repositories.ops.context.tenantId]);
    const authorizations = await transaction.query(`
      UPDATE identity.password_authorizations password_auth SET revoked_at=clock_timestamp()
       FROM identity.user_accounts account
       WHERE password_auth.account_id=account.id AND account.tenant_id=$1::uuid
         AND password_auth.consumed_at IS NULL AND password_auth.revoked_at IS NULL
       RETURNING password_auth.id
    `, [repositories.ops.context.tenantId]);
    const limits = await transaction.query("DELETE FROM identity.login_rate_limits RETURNING key_hash");
    const verified = await transaction.query(`
      SELECT count(*)::integer AS count
        FROM identity.credentials credential
        JOIN identity.user_accounts account ON account.id=credential.account_id
       WHERE account.tenant_id=$1::uuid AND account.login IS NOT NULL
         AND credential.active AND credential.credential_schema='scrypt_v1'
         AND credential.secret_hash LIKE 'scrypt$v1$16384$8$1$%'
    `, [repositories.ops.context.tenantId]);
    if (Number(verified.rows[0].count) !== accounts.rowCount) {
      throw rotationError("PAJ_PASSWORD_ROTATION_VERIFY_FAILED", "Rotierter Credentialbestand ist unvollstaendig");
    }
    const result = {
      accountCount: accounts.rowCount,
      credentialCount: Number(verified.rows[0].count),
      sessionsRevoked: sessions.rowCount,
      authorizationsRevoked: authorizations.rowCount,
      loginLimitsCleared: limits.rowCount,
    };
    return { ...result, auditAfter: result };
  });
  const { auditAfter, ...result } = executed;
  return result;
}

module.exports = { AUDIT_ACTION, rotateAllPajPasswords };
