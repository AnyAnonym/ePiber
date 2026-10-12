"use strict";

const crypto = require("crypto");
const { AppError } = require("./errors.js");
const { distributionPreview, localDate, projectedGrid, slotExpired, viennaDateTimeMs } = require("./hallTimeService.js");
const { requestHash } = require("./postgresCompetitionService.js");

function isAdmin(principal) { return principal?.role === "admin" || principal?.roles?.includes?.("admin"); }
function publicGrid(grid, principal) { const { internalId: _internalId, ...value } = grid; return projectedGrid(value, value.revision, principal); }
const VIENNA_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });
function dateKey(value) { const parts = Object.fromEntries(VIENNA_DATE.formatToParts(new Date(value)).filter(({ type }) => type !== "literal").map(({ type, value: part }) => [type, part])); return `${parts.year}-${parts.month}-${parts.day}`; }
function dayOrdinal(value) { const [year, month, day] = value.split("-").map(Number); return Math.floor(Date.UTC(year, month - 1, day) / 86400000); }

class PostgresHallTimeService {
  constructor({ venue, ops, messagingService = null, publish = () => {}, log = () => {}, now = Date.now }) {
    this.venue = venue; this.ops = ops; this.messagingService = messagingService; this.publish = publish; this.log = log; this.now = now;
    this.metricsCache = { historyLimit: 10000, grids: [] };
  }

  async grids(gridId = null) {
    const grids = await this.venue.hallTimeGridsDetailed(gridId);
    if (gridId === null) this.metricsCache = { historyLimit: 10000, grids: grids.map((grid) => ({ id: grid.id, name: grid.name, mode: grid.mode, active: grid.active, participants: grid.participants.length, futureSlots: grid.slots.filter((slot) => !slotExpired(slot, this.now())).length, capacity: grid.capacity * grid.slots.length, confirmed: grid.entries.filter(({ status }) => status === "confirmed").length, waitlist: grid.entries.filter(({ status }) => status === "waitlist").length })) };
    return grids;
  }
  async find(gridId) { return (await this.grids(gridId))[0] || null; }
  requireAdmin(principal) { if (!isAdmin(principal)) throw new AppError("FORBIDDEN", "Administratorrechte erforderlich", 403); }
  canAccess(principal, grid) { return isAdmin(principal) || grid.participants.some(({ id }) => id === String(principal.id)); }
  mapError(error) {
    if (error instanceof AppError) return error;
    if (error.code === "IDEMPOTENCY_CONFLICT") return new AppError("IDEMPOTENCY_CONFLICT", "Operation-ID wurde mit anderen Daten verwendet", 409);
    if (error.code === "23505") return new AppError("HALL_TIME_CONFLICT", "Hallenzeiten wurden gleichzeitig geändert", 409);
    return error;
  }

  async operation(principal, request, command, responseContract, callback) {
    try {
      const result = await this.venue.database.withTransaction(command, async (transaction) => {
        const operation = await this.ops.beginIdempotencyOn(transaction, {
          operationId: request.operationId, actorPersonId: principal.id, command, requestHash: requestHash(request),
        });
        if (operation.repeated) {
          if (operation.status === "success") return { ...operation.response, repeated: true };
          throw new AppError(operation.status === "unknown" ? "WRITE_OUTCOME_UNKNOWN" : "OPERATION_IN_PROGRESS", "Ausgang der Hallenzeitenoperation ist unklar", operation.status === "unknown" ? 503 : 409);
        }
        const response = await callback(transaction);
        await this.ops.queueInvalidation(transaction, { operationId: request.operationId, projection: "venue", eventId: request.gridId || response.gridId });
        await this.ops.completeIdempotency(transaction, { operationId: request.operationId, command, status: "success", response: responseContract(response) });
        return response;
      }, { isolation: "serializable", retries: 2 });
      this.publish("hall-times", { gridId: request.gridId || result.gridId, revision: result.revision });
      return result;
    } catch (error) { throw this.mapError(error); }
  }

  async actorId(transaction, principal) {
    const value = await transaction.query("SELECT id FROM identity.people WHERE tenant_id=$1::uuid AND contract_id=$2", [this.venue.context.tenantId, String(principal.id)]);
    if (!value.rowCount) throw new AppError("PLAYER_NOT_FOUND", "Person wurde nicht gefunden", 404);
    return value.rows[0].id;
  }

  async lockGrid(transaction, gridId, expectedRevision = null) {
    const result = await transaction.query(`
      SELECT grid.id,grid.revision,grid.contract_id FROM venue.hall_time_grids grid JOIN core.sections section ON section.id=grid.section_id
       WHERE section.tenant_id=$1::uuid AND grid.contract_id=$2 FOR UPDATE
    `, [this.venue.context.tenantId, String(gridId)]);
    if (!result.rowCount) throw new AppError("HALL_TIME_GRID_NOT_FOUND", "Hallenzeiten-Raster wurde nicht gefunden", 404);
    if (expectedRevision !== null && Number(result.rows[0].revision) !== expectedRevision) throw new AppError("REVISION_CONFLICT", "Hallenzeiten wurden gleichzeitig geändert", 409);
    return result.rows[0];
  }

  async historyWrite(transaction, { gridInternalId, operationId, action, actorId, detail = null, summary = null, items = [] }) {
    const history = await transaction.query(`
      INSERT INTO venue.hall_time_history(grid_id,operation_id,action_code,actor_person_id,occurred_at,item_count,detail,
        unavailable_count,avoid_count,assigned_count,removed_count,promoted_count,unchanged_count)
      VALUES ($1::uuid,$2::uuid,$3,$4::uuid,clock_timestamp(),$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
    `, [gridInternalId, operationId, action, actorId, items.length, detail,
      summary?.unavailableCount ?? null, summary?.avoidCount ?? null, summary?.assignedCount ?? null,
      summary?.removedCount ?? null, summary?.promotedCount ?? null, summary?.unchangedCount ?? null]);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      await transaction.query(`
        INSERT INTO venue.hall_time_history_items(history_id,item_no,slot_id,person_id,before_status,after_status,slot_starts_at_snapshot,person_contract_id_snapshot,person_name_snapshot)
        SELECT $1::uuid,$2,slot.id,person.id,$5,$6,slot.starts_at,person.contract_id,concat_ws(' ',person.first_name,person.last_name)
          FROM (SELECT 1) seed LEFT JOIN venue.hall_time_slots slot ON slot.id=$3::uuid
          LEFT JOIN identity.people person ON person.tenant_id=$7::uuid AND person.contract_id=$4
      `, [history.rows[0].id, index + 1, item.slotId || null, item.personId || null, item.beforeStatus || null, item.afterStatus || null, this.venue.context.tenantId]);
    }
  }

  async publicGroups(principal) {
    const values = await this.grids();
    return { success: true, revision: Math.max(0, ...values.map(({ revision }) => revision)), groups: values.filter((grid) => grid.active && grid.publicJoinable).map((grid) => ({ id: grid.id, name: grid.name, joined: grid.participants.some(({ id }) => id === String(principal.id)) })) };
  }
  async visibleGrids(principal) {
    const values = await this.grids();
    return { success: true, revision: Math.max(0, ...values.map(({ revision }) => revision)), grids: values.filter((grid) => grid.active && this.canAccess(principal, grid)).map(({ id, name, mode }) => ({ id, name, mode })) };
  }
  async canView(principal, gridId) { const grid = await this.find(gridId); return Boolean(grid?.active && this.canAccess(principal, grid)); }
  async grid(principal, gridId) {
    const grid = await this.find(gridId);
    if (!grid?.active) throw new AppError("HALL_TIME_GRID_NOT_FOUND", "Hallenzeiten-Raster wurde nicht gefunden", 404);
    if (!this.canAccess(principal, grid)) throw new AppError("FORBIDDEN", "Berechtigung fuer diesen Hallenzeiten-Raster fehlt", 403);
    return { success: true, grid: publicGrid(grid, principal) };
  }
  async adminGrids(principal) { this.requireAdmin(principal); const grids = await this.grids(); return { success: true, revision: Math.max(0, ...grids.map(({ revision }) => revision)), grids: grids.map((grid) => publicGrid(grid, principal)) }; }

  async setPublicMembership(principal, request) {
    return this.operation(principal, request, "hall_time.membership.set", (value) => ({ success: true, gridId: value.gridId, selected: value.selected, revision: value.revision }), async (transaction) => {
      const grid = await this.lockGrid(transaction, request.gridId, request.expectedRevision), actor = await this.actorId(transaction, principal);
      const config = await transaction.query("SELECT active,public_join_enabled FROM venue.hall_time_grids WHERE id=$1::uuid", [grid.id]);
      if (!config.rows[0].active || !config.rows[0].public_join_enabled) throw new AppError("HALL_TIME_GROUP_NOT_PUBLIC", "Diese Hallenzeiten-Gruppe ist nicht öffentlich beitretbar", 409);
      if (!request.selected) {
        const current = await transaction.query(`SELECT 1 FROM venue.hall_time_allocations allocation JOIN venue.hall_time_slots slot ON slot.id=allocation.slot_id WHERE slot.grid_id=$1::uuid AND allocation.person_id=$2::uuid AND slot.ends_at>clock_timestamp() LIMIT 1`, [grid.id, actor]);
        if (current.rowCount) throw new AppError("HALL_TIME_GROUP_ACTIVE_ENTRIES", "Vor dem Austritt müssen alle eigenen aktuellen Einträge entfernt werden", 409);
      }
      if (request.selected) await transaction.query(`INSERT INTO venue.hall_time_grid_participants(grid_id,person_id,joined_at,left_at) VALUES ($1::uuid,$2::uuid,clock_timestamp(),NULL) ON CONFLICT (grid_id,person_id) DO UPDATE SET joined_at=clock_timestamp(),left_at=NULL`, [grid.id, actor]);
      else await transaction.query("UPDATE venue.hall_time_grid_participants SET left_at=clock_timestamp() WHERE grid_id=$1::uuid AND person_id=$2::uuid AND left_at IS NULL", [grid.id, actor]);
      const revision = Number(grid.revision) + 1;
      await transaction.query("UPDATE venue.hall_time_grids SET revision=$2,projection_revision=$2,updated_at=clock_timestamp() WHERE id=$1::uuid", [grid.id, revision]);
      await this.historyWrite(transaction, { gridInternalId: grid.id, operationId: request.operationId, action: request.selected ? "group_joined" : "group_left", actorId: actor });
      return { success: true, gridId: request.gridId, selected: request.selected, revision };
    });
  }

  async saveGrid(principal, request) {
    this.requireAdmin(principal);
    const gridId = request.gridId || request.operationId;
    const result = await this.operation(principal, { ...request, gridId }, "hall_time.grid.save", (value) => ({ success: true, gridId: value.gridId, revision: value.revision }), async (transaction) => {
      const actor = await this.actorId(transaction, principal);
      let internalId, revision;
      if (request.gridId) {
        const current = await this.lockGrid(transaction, request.gridId, request.expectedRevision); internalId = current.id; revision = Number(current.revision) + 1;
        const conflict = await transaction.query(`SELECT 1 FROM venue.hall_time_grids other JOIN core.sections section ON section.id=other.section_id WHERE section.tenant_id=$1::uuid AND other.id<>$2::uuid AND other.active AND $3::boolean AND lower(other.name)=lower($4)`, [this.venue.context.tenantId, internalId, request.active, request.name]);
        if (conflict.rowCount) throw new AppError("HALL_TIME_NAME_CONFLICT", "Ein aktiver Raster mit diesem Namen ist bereits vorhanden", 409);
        const allocationConflict = await transaction.query(`SELECT
          EXISTS(SELECT 1 FROM venue.hall_time_allocations allocation JOIN venue.hall_time_slots slot ON slot.id=allocation.slot_id WHERE slot.grid_id=$1::uuid AND allocation.status='confirmed' GROUP BY allocation.slot_id HAVING count(*)>$2) AS capacity_conflict,
          EXISTS(SELECT 1 FROM venue.hall_time_allocations allocation JOIN venue.hall_time_slots slot ON slot.id=allocation.slot_id WHERE slot.grid_id=$1::uuid AND allocation.status='waiting') AS has_waiting`, [internalId, request.capacity]);
        if (allocationConflict.rows[0].capacity_conflict) throw new AppError("HALL_TIME_CAPACITY_CONFLICT", "Die neue Kapazität liegt unter der bestehenden Belegung", 409);
        if (!request.waitlistEnabled && allocationConflict.rows[0].has_waiting) throw new AppError("HALL_TIME_WAITLIST_CONFLICT", "Vor dem Deaktivieren der Warteliste müssen wartende Einträge entfernt werden", 409);
        await transaction.query(`UPDATE venue.hall_time_grids SET name=$2,description=$3,mode=$4,active=$5,public_join_enabled=$6,capacity=$7,
          waiting_list_enabled=$8,waiting_limit_per_person=$9,fair_use_enabled=$10,fair_use_base=$11,fair_use_extended_days=$12,
          fair_use_percent=$13,fair_use_open_days=$14,revision=$15,projection_revision=$15,updated_at=clock_timestamp() WHERE id=$1::uuid`,
        [internalId, request.name, request.description, request.mode === "fair_use" ? "reservation" : "allocation", request.active, request.publicJoinable, request.capacity,
          request.waitlistEnabled, request.waitlistEnabled ? request.maxWaitlistEntries : null, request.mode === "fair_use", request.fairUse.base,
          request.fairUse.extendedDays, request.fairUse.percent, request.fairUse.openDays, revision]);
      } else {
        if (request.expectedRevision !== 0) throw new AppError("REVISION_CONFLICT", "Neuer Raster erwartet Revision 0", 409);
        const conflict = await transaction.query(`SELECT 1 FROM venue.hall_time_grids other JOIN core.sections section ON section.id=other.section_id WHERE section.tenant_id=$1::uuid AND other.active AND $2::boolean AND lower(other.name)=lower($3)`, [this.venue.context.tenantId, request.active, request.name]);
        if (conflict.rowCount) throw new AppError("HALL_TIME_NAME_CONFLICT", "Ein aktiver Raster mit diesem Namen ist bereits vorhanden", 409);
        const inserted = await transaction.query(`INSERT INTO venue.hall_time_grids(section_id,contract_id,name,description,mode,active,public_join_enabled,capacity,
          waiting_list_enabled,waiting_limit_per_person,fair_use_enabled,fair_use_base,fair_use_extended_days,fair_use_percent,fair_use_open_days)
          SELECT section.id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15 FROM core.sections section
           WHERE section.tenant_id=$1::uuid AND section.section_code='tennis' RETURNING id,revision`,
        [this.venue.context.tenantId, gridId, request.name, request.description, request.mode === "fair_use" ? "reservation" : "allocation", request.active,
          request.publicJoinable, request.capacity, request.waitlistEnabled, request.waitlistEnabled ? request.maxWaitlistEntries : null,
          request.mode === "fair_use", request.fairUse.base, request.fairUse.extendedDays, request.fairUse.percent, request.fairUse.openDays]);
        if (!inserted.rowCount) throw new AppError("SECTION_NOT_FOUND", "Tennissektion fehlt", 503);
        internalId = inserted.rows[0].id; revision = Number(inserted.rows[0].revision);
      }
      await transaction.query("UPDATE venue.hall_time_grid_participants SET left_at=clock_timestamp() WHERE grid_id=$1::uuid AND left_at IS NULL AND person_id NOT IN (SELECT id FROM identity.people WHERE tenant_id=$2::uuid AND contract_id=ANY($3::text[]))", [internalId, this.venue.context.tenantId, request.participantIds]);
      for (const personId of request.participantIds) {
        const member = await transaction.query(`INSERT INTO venue.hall_time_grid_participants(grid_id,person_id,joined_at,left_at)
          SELECT $1::uuid,id,clock_timestamp(),NULL FROM identity.people WHERE tenant_id=$2::uuid AND contract_id=$3 AND active
          ON CONFLICT (grid_id,person_id) DO UPDATE SET left_at=NULL RETURNING person_id`, [internalId, this.venue.context.tenantId, personId]);
        if (!member.rowCount) throw new AppError("PLAYER_NOT_FOUND", "Mindestens ein Spieler wurde nicht gefunden", 404);
      }
      const retained = [];
      for (const slot of request.slots) {
        const startsAt = new Date(viennaDateTimeMs(slot.date, slot.start)), endsAt = new Date(viennaDateTimeMs(slot.date, slot.end));
        if (slot.id) {
          const updated = await transaction.query(`UPDATE venue.hall_time_slots SET starts_at=$3,ends_at=$4,capacity=$5,slot_revision=slot_revision+1,active=true WHERE id=$1::uuid AND grid_id=$2::uuid RETURNING id`, [slot.id, internalId, startsAt, endsAt, request.capacity]);
          if (!updated.rowCount) throw new AppError("HALL_TIME_SLOT_NOT_FOUND", "Termin wurde nicht gefunden", 404);
          retained.push(slot.id);
        } else {
          const inserted = await transaction.query("INSERT INTO venue.hall_time_slots(grid_id,starts_at,ends_at,capacity) VALUES ($1::uuid,$2,$3,$4) RETURNING id::text AS id", [internalId, startsAt, endsAt, request.capacity]); retained.push(inserted.rows[0].id);
        }
      }
      await transaction.query("UPDATE venue.hall_time_slots SET active=false,slot_revision=slot_revision+1 WHERE grid_id=$1::uuid AND active AND NOT (id=ANY($2::uuid[])) AND starts_at>clock_timestamp()", [internalId, retained]);
      await transaction.query(`DELETE FROM venue.hall_time_allocations allocation USING venue.hall_time_slots slot WHERE allocation.slot_id=slot.id AND slot.grid_id=$1::uuid AND NOT slot.active`, [internalId]);
      await transaction.query(`DELETE FROM venue.hall_time_constraints constraint_value USING venue.hall_time_slots slot WHERE constraint_value.slot_id=slot.id AND slot.grid_id=$1::uuid AND NOT slot.active`, [internalId]);
      await transaction.query(`DELETE FROM venue.hall_time_allocations allocation USING venue.hall_time_slots slot WHERE allocation.slot_id=slot.id AND slot.grid_id=$1::uuid AND slot.ends_at>clock_timestamp() AND allocation.person_id NOT IN (SELECT person_id FROM venue.hall_time_grid_participants WHERE grid_id=$1::uuid AND left_at IS NULL)`, [internalId]);
      await this.historyWrite(transaction, { gridInternalId: internalId, operationId: request.operationId, action: request.gridId ? "grid_updated" : "grid_created", actorId: actor, detail: request.name });
      return { success: true, gridId, revision };
    });
    const grid = await this.find(gridId); return { ...result, grid: publicGrid(grid, principal) };
  }

  async setBooking(principal, request) {
    let notification = null;
    const result = await this.operation(principal, request, "hall_time.booking.set", (value) => ({ success: true, gridId: value.gridId, revision: value.revision }), async (transaction) => {
      const grid = await this.lockGrid(transaction, request.gridId), actor = await this.actorId(transaction, principal);
      const personContractId = request.personId || String(principal.id);
      if (personContractId !== String(principal.id) && !isAdmin(principal)) throw new AppError("FORBIDDEN", "Nur Administratoren dürfen andere Spieler ändern", 403);
      const context = await transaction.query(`SELECT slot.id AS slot_id,slot.starts_at,slot.ends_at,slot.capacity,person.id AS person_id,
        EXISTS(SELECT 1 FROM venue.hall_time_grid_participants member WHERE member.grid_id=slot.grid_id AND member.person_id=person.id AND member.left_at IS NULL) AS member,
        value.waiting_list_enabled,value.waiting_limit_per_person,value.mode,value.fair_use_base,value.fair_use_extended_days,value.fair_use_percent,value.fair_use_open_days,value.active
        FROM venue.hall_time_slots slot JOIN venue.hall_time_grids value ON value.id=slot.grid_id
        JOIN identity.people person ON person.tenant_id=$3::uuid AND person.contract_id=$4
        WHERE slot.id=$2::uuid AND slot.grid_id=$1::uuid AND slot.active FOR UPDATE OF slot`, [grid.id, request.slotId, this.venue.context.tenantId, personContractId]);
      if (!context.rowCount) throw new AppError("HALL_TIME_SLOT_NOT_FOUND", "Termin wurde nicht gefunden", 404);
      const slot = context.rows[0];
      if (!slot.active || !slot.member) throw new AppError("FORBIDDEN", "Spieler ist diesem Raster nicht zugeordnet", 403);
      if (!isAdmin(principal) && new Date(slot.ends_at).getTime() <= this.now()) throw new AppError("HALL_TIME_PAST_LOCKED", "Vergangene Termine können nur durch Administratoren korrigiert werden", 409);
      const current = await transaction.query("SELECT id,status FROM venue.hall_time_allocations WHERE slot_id=$1::uuid AND person_id=$2::uuid FOR UPDATE", [slot.slot_id, slot.person_id]);
      const items = [];
      if (!request.selected && current.rowCount) {
        await transaction.query("DELETE FROM venue.hall_time_allocations WHERE id=$1::uuid", [current.rows[0].id]);
        items.push({ slotId: request.slotId, personId: personContractId, beforeStatus: current.rows[0].status });
        if (current.rows[0].status === "confirmed") {
          const promoted = await transaction.query(`UPDATE venue.hall_time_allocations SET status='confirmed',assigned_at=clock_timestamp()
            WHERE id=(SELECT id FROM venue.hall_time_allocations WHERE slot_id=$1::uuid AND status='waiting' ORDER BY queued_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING person_id`, [slot.slot_id]);
          if (promoted.rowCount) {
            const promotedPerson = await transaction.query("SELECT contract_id FROM identity.people WHERE id=$1::uuid", [promoted.rows[0].person_id]);
            notification = { personId: promotedPerson.rows[0].contract_id, slotId: request.slotId };
          }
        }
      } else if (request.selected && !current.rowCount) {
        if (!isAdmin(principal) && slot.mode === "reservation") {
          const counts = await transaction.query(`SELECT person.id,count(allocation.id)::int AS count
            FROM venue.hall_time_grid_participants member JOIN identity.people person ON person.id=member.person_id
            LEFT JOIN venue.hall_time_allocations allocation ON allocation.person_id=person.id
              AND allocation.slot_id IN (SELECT id FROM venue.hall_time_slots WHERE grid_id=$1::uuid)
            WHERE member.grid_id=$1::uuid AND member.left_at IS NULL GROUP BY person.id`, [grid.id]);
          const own = counts.rows.find(({ id }) => String(id) === String(slot.person_id))?.count || 0;
          const reserving = counts.rows.map(({ count }) => count).filter((count) => count > 0);
          const average = reserving.length ? reserving.reduce((sum, count) => sum + count, 0) / reserving.length : 0;
          const daysUntil = dayOrdinal(dateKey(slot.starts_at)) - dayOrdinal(localDate(this.now()));
          let limit = Infinity;
          if (daysUntil > slot.fair_use_extended_days) limit = slot.fair_use_base;
          else if (daysUntil > slot.fair_use_open_days) limit = Math.max(slot.fair_use_base, Math.floor(average * (1 + slot.fair_use_percent / 100)));
          if (own + 1 > limit) throw new AppError("HALL_TIME_FAIR_USE_LIMIT", `FairUse erlaubt derzeit hoechstens ${limit} Reservierungen`, 409, { limit });
        }
        const occupied = await transaction.query("SELECT count(*)::int AS count FROM venue.hall_time_allocations WHERE slot_id=$1::uuid AND status='confirmed'", [slot.slot_id]);
        const status = occupied.rows[0].count < slot.capacity ? "confirmed" : "waiting";
        if (status === "waiting" && !slot.waiting_list_enabled) throw new AppError("HALL_TIME_SLOT_FULL", "Dieser Termin ist bereits voll belegt", 409);
        if (status === "waiting") {
          const waiting = await transaction.query(`SELECT count(*)::int AS count FROM venue.hall_time_allocations allocation JOIN venue.hall_time_slots other ON other.id=allocation.slot_id WHERE other.grid_id=$1::uuid AND allocation.person_id=$2::uuid AND allocation.status='waiting'`, [grid.id, slot.person_id]);
          if (waiting.rows[0].count >= Number(slot.waiting_limit_per_person || 0)) throw new AppError("HALL_TIME_WAITLIST_LIMIT", "Maximale Zahl an Wartelisteneinträgen erreicht", 409);
        }
        await transaction.query(`INSERT INTO venue.hall_time_allocations(slot_id,person_id,status,queued_at,assigned_at,created_by_person_id)
          VALUES ($1::uuid,$2::uuid,$3,clock_timestamp(),CASE WHEN $3='confirmed' THEN clock_timestamp() ELSE NULL END,$4::uuid)`, [slot.slot_id, slot.person_id, status, actor]);
        items.push({ slotId: request.slotId, personId: personContractId, afterStatus: status });
      }
      const revision = Number(grid.revision) + (items.length ? 1 : 0);
      if (items.length) {
        await transaction.query("UPDATE venue.hall_time_grids SET revision=$2,projection_revision=$2,updated_at=clock_timestamp() WHERE id=$1::uuid", [grid.id, revision]);
        await this.historyWrite(transaction, { gridInternalId: grid.id, operationId: request.operationId, action: request.selected ? (items[0].afterStatus === "waiting" ? "waitlist_added" : "booking_added") : "booking_removed", actorId: actor, items });
        if (personContractId !== String(principal.id)) await this.messagingService?.createDomainEvent({
          contractId: `event-${request.operationId}`, eventType: "hall_time.booking.changed", operationId: request.operationId,
          templateParameters: { gridId: request.gridId, slotId: request.slotId, personId: personContractId, status: request.selected ? items[0].afterStatus : "removed" },
          participants: [{ personId: personContractId, role: "affected_player" }], recipients: [personContractId], readPersonIds: [],
          sourceType: "hall_time", sourceId: request.gridId, actorPersonId: String(principal.id), actorName: principal.name || null,
          summary: request.selected ? "Hallenzeit wurde durch einen Administrator eingetragen." : "Hallenzeit wurde durch einen Administrator entfernt.",
        }, transaction);
        if (notification?.personId) await this.messagingService?.createDomainEvent({
          contractId: `promote-${request.operationId}`, eventType: "hall_time.waitlist.promoted", operationId: request.operationId,
          templateParameters: { gridId: request.gridId, slotId: request.slotId, personId: notification.personId },
          participants: [{ personId: notification.personId, role: "promoted_player" }], recipients: [notification.personId], readPersonIds: [],
          sourceType: "hall_time", sourceId: request.gridId, actorPersonId: String(principal.id), actorName: principal.name || null, summary: "Wartelisteneintrag wurde auf einen Fixplatz nachgereiht.",
        }, transaction);
      } else {
        await this.historyWrite(transaction, { gridInternalId: grid.id, operationId: request.operationId, action: "booking_unchanged", actorId: actor });
      }
      return { success: true, gridId: request.gridId, revision };
    });
    const grid = await this.find(request.gridId);
    if (notification) this.log("info", "hall_time_waitlist_promoted", { gridId: request.gridId, slotId: notification.slotId, result: "success" });
    return { ...result, grid: publicGrid(grid, principal) };
  }

  async saveConstraints(principal, request) {
    this.requireAdmin(principal);
    const result = await this.operation(principal, request, "hall_time.constraints.save", (value) => ({ success: true, gridId: value.gridId, revision: value.revision }), async (transaction) => {
      const grid = await this.lockGrid(transaction, request.gridId, request.expectedRevision), actor = await this.actorId(transaction, principal);
      const mode = await transaction.query("SELECT mode FROM venue.hall_time_grids WHERE id=$1::uuid", [grid.id]);
      if (mode.rows[0].mode !== "allocation") throw new AppError("HALL_TIME_MODE_INVALID", "Verhinderungen sind nur im Modus Gleichberechtigte Aufteilung verfügbar", 409);
      await transaction.query("DELETE FROM venue.hall_time_constraints WHERE grid_id=$1::uuid", [grid.id]);
      for (const constraint of request.constraints) {
        const inserted = await transaction.query(`INSERT INTO venue.hall_time_constraints(grid_id,person_id,slot_id,constraint_type,created_at)
          SELECT $1::uuid,person.id,slot.id,$4,clock_timestamp() FROM identity.people person JOIN venue.hall_time_slots slot ON slot.id=$3::uuid AND slot.grid_id=$1::uuid
          JOIN venue.hall_time_grid_participants member ON member.grid_id=$1::uuid AND member.person_id=person.id AND member.left_at IS NULL
          WHERE person.tenant_id=$5::uuid AND person.contract_id=$2 AND slot.active AND slot.ends_at>clock_timestamp() RETURNING id`, [grid.id, constraint.personId, constraint.slotId, constraint.kind, this.venue.context.tenantId]);
        if (!inserted.rowCount) throw new AppError("HALL_TIME_SLOT_NOT_EDITABLE", "Einschränkung verweist auf ungültige Daten", 409);
      }
      const revision = Number(grid.revision) + 1; await transaction.query("UPDATE venue.hall_time_grids SET revision=$2,projection_revision=$2,updated_at=clock_timestamp() WHERE id=$1::uuid", [grid.id, revision]);
      await this.historyWrite(transaction, { gridInternalId: grid.id, operationId: request.operationId, action: "distribution_constraints_updated", actorId: actor, summary: { unavailableCount: request.constraints.filter(({ kind }) => kind === "unavailable").length, avoidCount: request.constraints.filter(({ kind }) => kind === "avoid").length } });
      return { success: true, gridId: request.gridId, revision };
    });
    return { ...result, grid: publicGrid(await this.find(request.gridId), principal) };
  }

  async previewDistribution(principal, request) {
    this.requireAdmin(principal); const grid = await this.find(request.gridId);
    if (!grid?.active) throw new AppError("HALL_TIME_GRID_NOT_FOUND", "Hallenzeiten-Raster wurde nicht gefunden", 404);
    if (grid.revision !== request.expectedRevision) throw new AppError("REVISION_CONFLICT", "Hallenzeiten wurden gleichzeitig geändert", 409);
    if (grid.mode !== "equal") throw new AppError("HALL_TIME_MODE_INVALID", "Automatische Verteilung ist nur im Modus Gleichberechtigte Aufteilung verfügbar", 409);
    return { success: true, preview: distributionPreview(grid, this.now(), grid.revision) };
  }

  async applyDistribution(principal, request, requireHash = null) {
    this.requireAdmin(principal);
    const command = requireHash ? "hall_time.distribution.apply" : "hall_time.distribution.run";
    const result = await this.operation(principal, request, command, (value) => ({ success: true, gridId: value.gridId, revision: value.revision }), async (transaction) => {
      const locked = await this.lockGrid(transaction, request.gridId, request.expectedRevision), actor = await this.actorId(transaction, principal);
      const grid = await this.find(request.gridId); const preview = distributionPreview(grid, this.now(), grid.revision);
      if (grid.mode !== "equal") throw new AppError("HALL_TIME_MODE_INVALID", "Automatische Verteilung ist nur im Modus Gleichberechtigte Aufteilung verfügbar", 409);
      if (requireHash && preview.previewHash !== requireHash) throw new AppError("HALL_TIME_PREVIEW_STALE", "Die Vorschau ist nicht mehr aktuell", 409);
      if (preview.openPlaceCount > 0) throw new AppError("HALL_TIME_DISTRIBUTION_INCOMPLETE", "Eine unvollständige Verteilung kann nicht übernommen werden", 409);
      await transaction.query(`DELETE FROM venue.hall_time_allocations allocation USING venue.hall_time_slots slot WHERE allocation.slot_id=slot.id AND slot.grid_id=$1::uuid AND slot.ends_at>clock_timestamp()`, [locked.id]);
      for (const entry of preview.entries) await transaction.query(`INSERT INTO venue.hall_time_allocations(slot_id,person_id,status,queued_at,assigned_at,created_by_person_id)
        SELECT $1::uuid,person.id,'confirmed',clock_timestamp(),clock_timestamp(),$3::uuid FROM identity.people person WHERE person.tenant_id=$4::uuid AND person.contract_id=$2`, [entry.slotId, entry.personId, actor, this.venue.context.tenantId]);
      const revision = Number(locked.revision) + 1; await transaction.query("UPDATE venue.hall_time_grids SET revision=$2,projection_revision=$2,updated_at=clock_timestamp() WHERE id=$1::uuid", [locked.id, revision]);
      await this.historyWrite(transaction, { gridInternalId: locked.id, operationId: request.operationId, action: "distribution_replaced", actorId: actor, summary: { assignedCount: preview.assignedCount, openPlaceCount: preview.openPlaceCount } });
      return { success: true, gridId: request.gridId, revision };
    });
    return { ...result, grid: publicGrid(await this.find(request.gridId), principal) };
  }
  distribute(principal, request) { return this.applyDistribution(principal, request); }
  applyDistributionPreview(principal, request) { return this.applyDistribution(principal, request, request.previewHash); }

  async clearAllStatuses(principal, request) {
    this.requireAdmin(principal); let deletedEntryCount = 0;
    const result = await this.operation(principal, request, "hall_time.status.clear", (value) => ({ success: true, gridId: value.gridId, revision: value.revision, deletedEntryCount: value.deletedEntryCount }), async (transaction) => {
      const grid = await this.lockGrid(transaction, request.gridId, request.expectedRevision), actor = await this.actorId(transaction, principal);
      const existing = await transaction.query(`SELECT allocation.slot_id::text AS "slotId",person.contract_id AS "personId",allocation.status FROM venue.hall_time_allocations allocation JOIN venue.hall_time_slots slot ON slot.id=allocation.slot_id JOIN identity.people person ON person.id=allocation.person_id WHERE slot.grid_id=$1::uuid`, [grid.id]);
      const deleted = await transaction.query(`DELETE FROM venue.hall_time_allocations allocation USING venue.hall_time_slots slot WHERE allocation.slot_id=slot.id AND slot.grid_id=$1::uuid RETURNING allocation.id`, [grid.id]); deletedEntryCount = deleted.rowCount;
      const revision = Number(grid.revision) + 1; await transaction.query("UPDATE venue.hall_time_grids SET revision=$2,projection_revision=$2,updated_at=clock_timestamp() WHERE id=$1::uuid", [grid.id, revision]);
      await this.historyWrite(transaction, { gridInternalId: grid.id, operationId: request.operationId, action: "all_statuses_cleared", actorId: actor, summary: { removedCount: deletedEntryCount }, items: existing.rows.map((entry) => ({ ...entry, beforeStatus: entry.status })) });
      return { success: true, gridId: request.gridId, revision, deletedEntryCount };
    });
    return { ...result, grid: publicGrid(await this.find(request.gridId), principal) };
  }

  async history(principal, gridId) {
    const grid = await this.find(gridId); if (!grid?.active) throw new AppError("HALL_TIME_GRID_NOT_FOUND", "Hallenzeiten-Raster wurde nicht gefunden", 404);
    if (!this.canAccess(principal, grid)) throw new AppError("FORBIDDEN", "Berechtigung fehlt", 403);
    const result = await this.venue.database.query(`SELECT history.id::text AS id,extract(epoch FROM history.occurred_at)*1000 AS at,history.action_code AS action,
      COALESCE(actor.contract_id,'system') AS "actorId",COALESCE(concat_ws(' ',actor.first_name,actor.last_name),'System') AS "actorName",history.detail,
      jsonb_strip_nulls(jsonb_build_object('unavailableCount',history.unavailable_count,'avoidCount',history.avoid_count,'assignedCount',history.assigned_count,'removedCount',history.removed_count,'promotedCount',history.promoted_count,'unchangedCount',history.unchanged_count)) AS summary,
      item.slot_id::text AS "slotId",item.person_contract_id_snapshot AS "personId",COALESCE(item.person_name_snapshot,'') AS "personName",
      CASE item.before_status WHEN 'waiting' THEN 'waitlist' ELSE COALESCE(item.before_status,'red') END AS "from",
      CASE item.after_status WHEN 'waiting' THEN 'waitlist' ELSE COALESCE(item.after_status,'red') END AS "to",
      CASE WHEN item.slot_id IS NULL THEN NULL ELSE jsonb_build_object('id',item.slot_id::text,'date',to_char(COALESCE(slot.starts_at,item.slot_starts_at_snapshot) AT TIME ZONE 'Europe/Vienna','YYYY-MM-DD'),'start',to_char(COALESCE(slot.starts_at,item.slot_starts_at_snapshot) AT TIME ZONE 'Europe/Vienna','HH24:MI'),'end',to_char(slot.ends_at AT TIME ZONE 'Europe/Vienna','HH24:MI')) END AS slot
      FROM venue.hall_time_history history LEFT JOIN identity.people actor ON actor.id=history.actor_person_id
      LEFT JOIN LATERAL (SELECT * FROM venue.hall_time_history_items candidate WHERE candidate.history_id=history.id ORDER BY candidate.item_no LIMIT 1) item ON true
      LEFT JOIN venue.hall_time_slots slot ON slot.id=item.slot_id
      WHERE history.grid_id=$1::uuid ORDER BY history.occurred_at DESC,history.id DESC LIMIT 10000`, [grid.internalId]);
    return { success: true, entries: result.rows.map((row) => ({ ...row, at: Number(row.at) })) };
  }

  async cleanupExpired() {
    const result = await this.venue.database.withTransaction("hall_time.waitlist.expire", async (transaction) => {
      const expired = await transaction.query(`SELECT allocation.id,grid.id AS grid_id,grid.contract_id AS grid_contract_id,slot.id::text AS slot_id,person.contract_id AS person_id
        FROM venue.hall_time_allocations allocation JOIN venue.hall_time_slots slot ON slot.id=allocation.slot_id
        JOIN venue.hall_time_grids grid ON grid.id=slot.grid_id JOIN core.sections section ON section.id=grid.section_id
        JOIN identity.people person ON person.id=allocation.person_id
        WHERE section.tenant_id=$1::uuid AND allocation.status='waiting' AND slot.ends_at<=clock_timestamp()
        ORDER BY slot.ends_at,allocation.id LIMIT 1000 FOR UPDATE OF allocation SKIP LOCKED`, [this.venue.context.tenantId]);
      if (!expired.rowCount) return [];
      await transaction.query("DELETE FROM venue.hall_time_allocations WHERE id=ANY($1::uuid[])", [expired.rows.map(({ id }) => id)]);
      const groups = new Map(); for (const row of expired.rows) { if (!groups.has(row.grid_id)) groups.set(row.grid_id, []); groups.get(row.grid_id).push(row); }
      for (const [gridInternalId, rows] of groups) {
        const operationId = crypto.randomUUID();
        await this.historyWrite(transaction, { gridInternalId, operationId, action: "waitlist_expired", actorId: null, items: rows.map((row) => ({ slotId: row.slot_id, personId: row.person_id, beforeStatus: "waiting" })) });
        await transaction.query("UPDATE venue.hall_time_grids SET revision=revision+1,projection_revision=projection_revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid", [gridInternalId]);
      }
      return [...groups.values()].map((rows) => rows[0].grid_contract_id);
    });
    for (const gridId of result) this.publish("hall-times", { gridId });
    return { changed: result.length > 0, gridIds: result };
  }
  async reportingSnapshot(fromMs, toMs) {
    const result = await this.venue.database.query(`SELECT history.id::text AS id,extract(epoch FROM history.occurred_at)*1000 AS time,grid.contract_id AS "gridId",grid.name AS "gridName",history.action_code AS action,
      COALESCE(actor.contract_id,'system') AS "actorId",COALESCE(concat_ws(' ',actor.first_name,actor.last_name),'System') AS "actorName",COALESCE(history.detail,'') AS detail,
      COALESCE(item.person_contract_id_snapshot,'') AS "personId",COALESCE(item.person_name_snapshot,'') AS "personName",item.slot_id::text AS "slotId",
      CASE item.before_status WHEN 'waiting' THEN 'waitlist' ELSE COALESCE(item.before_status,'red') END AS "from",
      CASE item.after_status WHEN 'waiting' THEN 'waitlist' ELSE COALESCE(item.after_status,'red') END AS "to",
      CASE WHEN item.slot_id IS NULL THEN '' ELSE to_char(COALESCE(slot.starts_at,item.slot_starts_at_snapshot) AT TIME ZONE 'Europe/Vienna','YYYY-MM-DD HH24:MI')||'–'||to_char(slot.ends_at AT TIME ZONE 'Europe/Vienna','HH24:MI') END AS "slotTime"
      FROM venue.hall_time_history history JOIN venue.hall_time_grids grid ON grid.id=history.grid_id JOIN core.sections section ON section.id=grid.section_id LEFT JOIN identity.people actor ON actor.id=history.actor_person_id
      LEFT JOIN LATERAL (SELECT * FROM venue.hall_time_history_items candidate WHERE candidate.history_id=history.id ORDER BY candidate.item_no LIMIT 1) item ON true LEFT JOIN venue.hall_time_slots slot ON slot.id=item.slot_id
      WHERE section.tenant_id=$1::uuid AND history.occurred_at>=to_timestamp($2/1000.0) AND history.occurred_at<to_timestamp($3/1000.0) ORDER BY history.occurred_at,history.id`, [this.venue.context.tenantId, fromMs, toMs]);
    const grids = await this.grids(); return { grids: grids.map(({ id, name }) => ({ id, name })), entries: result.rows.map((row) => ({ ...row, time: Number(row.time) })) };
  }
  metricsStatus() { return structuredClone(this.metricsCache); }
}

module.exports = { PostgresHallTimeService };
