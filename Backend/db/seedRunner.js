"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const TECHNICAL_SEED = path.join(__dirname, "seeds", "technical-minimal.sql");

function seedChecksum(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

async function applyTechnicalSeed({ connectionConfig, asOf, output = console.log }) {
  const parsedAsOf = new Date(asOf);
  if (!asOf || Number.isNaN(parsedAsOf.getTime()) || parsedAsOf.toISOString() !== asOf) {
    throw Object.assign(new Error("Seed as_of muss ein kanonischer ISO-Zeitpunkt sein"), { code: "SEED_AS_OF_INVALID" });
  }
  const sql = fs.readFileSync(TECHNICAL_SEED, "utf8");
  const checksum = seedChecksum(sql);
  const client = new Client(connectionConfig);
  await client.connect();
  output(JSON.stringify({ event: "db_seed_started", seed: "technical-minimal", asOf }));
  try {
    const state = await client.query(`
      SELECT (SELECT count(*) FROM core.tenants) AS tenant_count,
             (SELECT count(*) FROM ops.seed_runs WHERE result = 'success') AS successful_seed_count
    `);
    if (Number(state.rows[0].tenant_count) !== 0 || Number(state.rows[0].successful_seed_count) !== 0) {
      throw Object.assign(new Error("Technischer Seed verlangt eine leere Zielbasis"), { code: "SEED_DATABASE_NOT_EMPTY" });
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(`
        INSERT INTO ops.seed_runs
          (tenant_id, seed_name, seed_version, as_of, checksum, started_at, completed_at, result)
        VALUES
          ('0199c800-0000-7000-8000-000000000001', 'technical-minimal', '1', $1, $2,
           clock_timestamp(), clock_timestamp(), 'success')
      `, [asOf, checksum]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    output(JSON.stringify({ event: "db_seed_completed", seed: "technical-minimal", result: "success", checksum }));
    return { seed: "technical-minimal", checksum };
  } catch (error) {
    output(JSON.stringify({ event: "db_seed_completed", seed: "technical-minimal", result: "failed", errorCode: error.code || "DB_SEED_FAILED" }));
    throw error;
  } finally {
    await client.end();
  }
}

module.exports = { applyTechnicalSeed, seedChecksum, TECHNICAL_SEED };
