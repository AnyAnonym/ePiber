"use strict";

const { MessagingService } = require("./messagingService");

// Reuse the established wording without invoking SQLite, delivery adapters or
// cache-based person lookup. PostgreSQL persists the resulting snapshots.
class MessageFormatter extends MessagingService {
  constructor() { super({ repository: null, log: () => {} }); }
  person() { return { channels: [] }; }
  async ensureEvent(event, participants) { return { ...event, participants }; }
}

async function formatDomainMessage(values, context) {
  const formatter = new MessageFormatter();
  const common = {
    ...context, operationId: values.operationId, matchId: values.matchId,
    competitionId: values.competitionId, actorId: values.actorPersonId,
    actorName: values.actorName, createdAt: values.createdAt?.getTime() || Date.now(),
  };
  let formatted;
  switch (values.eventType) {
    case "match.challenge.created":
      formatted = await formatter.ensureChallengeEvent({ ...common,
        challengerId: context.teams[0][0], challengerName: context.participantNames[context.teams[0][0]],
        opponentId: context.teams[1][0], recipientId: context.teams[1][0], opponentName: context.participantNames[context.teams[1][0]],
        challengerRank: context.participantRanks?.[context.teams[0][0]] ?? null,
        opponentRank: context.participantRanks?.[context.teams[1][0]] ?? null,
      }); break;
    case "match.appointment.set":
      formatted = await formatter.ensureMatchAppointmentEvent(common); break;
    case "match.appointment.cleared":
      formatted = await formatter.ensureMatchAppointmentCancelledEvent(common); break;
    case "match.result.set": case "match.result.corrected": case "match.result.cleared": case "match.end.corrected":
      formatted = await formatter.ensureMatchResultEvent({ ...common,
        changeType: { "match.result.set": "result", "match.result.corrected": "result_corrected", "match.result.cleared": "result_cleared", "match.end.corrected": "match_end_corrected" }[values.eventType],
      }); break;
    case "match.challenge.deleted": case "match.challenge.date_changed":
      formatted = await formatter.ensureAdminRankingChallengeEvent({ ...common,
        action: values.eventType === "match.challenge.deleted" ? "deleted" : "challenge_date_changed",
        challengerId: context.teams[0][0], challengerName: context.participantNames[context.teams[0][0]],
        opponentId: context.teams[1][0], opponentName: context.participantNames[context.teams[1][0]],
      }); break;
    case "ranking.withdrawn":
      formatted = await formatter.ensureRankingWithdrawalEvent({ ...common, participantId: values.actorPersonId, participantName: context.participantNames[values.actorPersonId] }); break;
    default: return values;
  }
  return { ...values, summary: formatted.event.summary, detail: formatted.event.detail || null,
    result: formatted.event.result || null,
    recipientMessages: formatted.event.participants.map(person => ({ personId: person.userId, subject: person.subject, body: person.body })),
  };
}

async function createDomainMessage(repository, values, transaction) {
  const context = { ...(values.messageContext || {}), reason: values.detail || values.messageContext?.reason || "" };
  const competition = values.competitionId ? await transaction.query(`SELECT competition.name FROM play.competitions competition
    JOIN core.sections section ON section.id=competition.section_id WHERE section.tenant_id=$1::uuid AND competition.contract_id=$2`, [repository.context.tenantId, values.competitionId]) : { rows: [] };
  context.competitionName = competition.rows[0]?.name || "Bewerb";
  const people = await transaction.query(`SELECT person.contract_id AS id,concat_ws(' ',person.first_name,person.last_name) AS name,ranking.rank
    FROM identity.people person LEFT JOIN play.ranking_entries ranking ON ranking.person_id=person.id AND ranking.status='active'
      AND ranking.competition_id IN (SELECT competition.id FROM play.competitions competition JOIN core.sections section ON section.id=competition.section_id
        WHERE section.tenant_id=$1::uuid AND competition.contract_id=$3)
    WHERE person.tenant_id=$1::uuid AND person.contract_id=ANY($2::text[])`, [repository.context.tenantId, values.participants.map(person => person.personId), values.competitionId || null]);
  context.participantNames = Object.fromEntries(people.rows.map(person => [person.id, person.name]));
  context.participantRanks = Object.fromEntries(people.rows.map(person => [person.id, person.rank]));
  if (values.matchId) {
    const match = await transaction.query(`SELECT side.side_no,participant.position_no,person.contract_id AS id,match.round_code
      FROM play.matches match JOIN play.competitions competition ON competition.id=match.competition_id
      JOIN core.sections section ON section.id=competition.section_id
      JOIN play.match_sides side ON side.match_id=match.id JOIN play.match_participants participant ON participant.side_id=side.id
      JOIN identity.people person ON person.id=participant.person_id
      WHERE section.tenant_id=$1::uuid AND competition.contract_id=$2 AND match.contract_id=$3 ORDER BY side.side_no,participant.position_no`, [repository.context.tenantId, values.competitionId, values.matchId]);
    context.teams = [1, 2].map(side => match.rows.filter(person => person.side_no === side).map(person => person.id));
    context.participantIds = context.teams.flat();
    context.roundCode = match.rows[0]?.round_code || "";
  }
  const enriched = await formatDomainMessage(values, context);
  if (values.eventType.startsWith("competition.entry.")) {
    const name = context.participantNames[values.actorPersonId] || values.actorPersonId;
    const joined = values.eventType === "competition.entry.created";
    enriched.summary = `${name} hat ${joined ? "sich zum Bewerb angemeldet" : "die Anmeldung zum Bewerb zurückgezogen"}.`;
    enriched.recipientMessages = values.recipients.map(personId => ({ personId,
      subject: `${joined ? "Anmeldung" : "Abmeldung"}: ${context.competitionName}`,
      body: `Du hast dich ${joined ? "zum" : "vom"} Bewerb ${context.competitionName} ${joined ? "angemeldet" : "abgemeldet"}.`,
    }));
  }
  if (values.eventType.startsWith("hall_time.")) {
    const params = values.templateParameters;
    const slot = await transaction.query(`SELECT grid.name,slot.starts_at,slot.ends_at FROM venue.hall_time_grids grid
      JOIN core.sections section ON section.id=grid.section_id
      JOIN venue.hall_time_slots slot ON slot.grid_id=grid.id WHERE section.tenant_id=$1::uuid AND grid.contract_id=$2 AND slot.id=$3::uuid`, [repository.context.tenantId, params.gridId, params.slotId]);
    if (!slot.rowCount) throw Object.assign(new Error("MESSAGE_CONTEXT_NOT_FOUND"), { code: "MESSAGE_CONTEXT_NOT_FOUND" });
    const booking = slot.rows[0];
    const date = new Date(booking.starts_at).toLocaleString("de-AT", { timeZone: "Europe/Vienna", dateStyle: "short", timeStyle: "short" });
    const end = new Date(booking.ends_at).toLocaleTimeString("de-AT", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit" });
    const status = values.eventType === "hall_time.waitlist.promoted" ? "auf einen Fixplatz nachgerückt" : params.status === "removed" ? "entfernt" : params.status === "waiting" ? "auf der Warteliste eingetragen" : "als Fixplatz eingetragen";
    enriched.summary = `Hallenzeit „${booking.name}“ am ${date}–${end} Uhr: ${status}.`;
    enriched.recipientMessages = values.recipients.map(personId => ({ personId, subject: `Hallenzeit „${booking.name}“`, body: enriched.summary }));
  }
  return repository.createEvent(enriched, transaction);
}

module.exports = { formatDomainMessage, createDomainMessage };
