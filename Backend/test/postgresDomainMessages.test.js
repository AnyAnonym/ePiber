"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { formatDomainMessage } = require("../postgresDomainMessages");

const values = {
  operationId: "0199c800-0000-7000-8000-00000000aa01", matchId: "match-1", competitionId: "2",
  actorPersonId: "admin", actorName: "Ada Admin", createdAt: new Date("2026-10-20T10:00:00Z"),
};
const context = {
  competitionName: "Clubmeisterschaft", teams: [["1", "2"], ["3", "4"]], participantIds: ["1", "2", "3", "4"],
  participantNames: { 1: "Anna Eins", 2: "Berta Zwei", 3: "Clara Drei", 4: "Dora Vier" }, roundCode: "HF",
};

for (const eventType of ["match.result.set", "match.result.corrected"]) {
  for (const completionType of ["regular", "retirement", "walkover"]) {
    test(`${eventType}: ${completionType} nennt beide Teams und wahrt Gewinner-/Empfaengerperspektive`, async () => {
      const result = completionType === "regular" ? "2-6/4-6" : completionType === "retirement" ? "2-4" : "";
      const message = await formatDomainMessage({ ...values, eventType }, { ...context, winnerSide: 2, completionType, result });
      assert.equal(message.summary, completionType === "walkover"
        ? "Clara Drei / Dora Vier gewinnt durch W.O. von Anna Eins / Berta Zwei."
        : "Clara Drei / Dora Vier gewinnt gegen Anna Eins / Berta Zwei.");
      assert.equal(message.result, completionType === "walkover" ? "W.O." : completionType === "retirement" ? "4-2 (Aufgabe)" : "6-2/6-4");
      assert.equal(message.recipientMessages.length, 4);
      for (const personal of message.recipientMessages) {
        const won = ["3", "4"].includes(personal.personId);
        assert.equal(personal.subject, `Match ${won ? "gewonnen" : "verloren"}: Clubmeisterschaft`);
        assert.doesNotMatch(personal.body, /undefined|walkover/);
        if (completionType === "regular") assert.ok(personal.body.includes(won ? "6-2/6-4" : "2-6/4-6"));
        if (completionType === "walkover") assert.match(personal.body, /W\.O\./);
      }
    });
  }
}

test("Forderung nennt Namen, Rang und persoenliche Handlungsaufforderung", async () => {
  const message = await formatDomainMessage({ ...values, eventType: "match.challenge.created" }, {
    ...context, teams: [["1"], ["3"]], participantRanks: { 1: 12, 3: 8 },
  });
  assert.equal(message.summary, "Anna Eins (12) hat Clara Drei (8) gefordert.");
  assert.match(message.recipientMessages.find(person => person.personId === "3").body, /hat dich.*gefordert/);
  assert.match(message.recipientMessages.find(person => person.personId === "1").body, /Du \(12\) hast.*gefordert/);
});

for (const eventType of ["match.appointment.set", "match.appointment.cleared", "match.challenge.date_changed", "match.challenge.deleted", "match.result.cleared", "match.end.corrected", "ranking.withdrawn"]) {
  test(`${eventType}: aussagekraeftige Historie und persoenlicher Text`, async () => {
    const message = await formatDomainMessage({ ...values, actorPersonId: "1", eventType }, {
      ...context, teams: [["1"], ["3"]], participantIds: ["1", "3"],
      previousDate: "261020-1000", nextDate: "261021-1100", matchDate: "261021-1100", matchEnd: "261021-1200", reason: "Berichtigung",
    });
    assert.match(message.summary, /Anna Eins/);
    assert.ok(message.recipientMessages.length);
    for (const personal of message.recipientMessages) {
      assert.ok(personal.subject);
      assert.ok(personal.body);
      assert.doesNotMatch(personal.body, /undefined/);
    }
    if (eventType.includes("appointment") || eventType === "match.challenge.date_changed") assert.match(message.summary, /20\.10\.2026|21\.10\.2026/);
    if (eventType === "match.result.cleared") assert.equal(message.result, null);
    assert.match(eventType === "ranking.withdrawn" ? message.recipientMessages[0].body : message.detail, /Berichtigung/);
  });
}
