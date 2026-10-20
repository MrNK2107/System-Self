import assert from "node:assert/strict";
import { test } from "node:test";
import { deadlineLine, formatReward, pickContextCard, pickNextQuest, questReward } from "./today";
import type { Quest } from "./types";

const q = (over: Partial<Quest> = {}): Quest => ({
  id: "q1",
  type: "daily",
  title: "Lift",
  description: "d",
  domain: "BODY",
  status: "active",
  expiresAt: "2026-10-19T23:59:59.000Z",
  generatedBySystem: true,
  ...over,
});

test("next quest: none when nothing is active", () => {
  assert.deepEqual(pickNextQuest([q({ status: "complete" })], null), { quest: null, more: 0 });
});

test("next quest: earliest deadline first, ranked before bonus, counts the rest", () => {
  const quests = [
    q({ id: "late", expiresAt: "2026-10-25T00:00:00.000Z" }),
    q({ id: "bonus", bonus: true, expiresAt: "2026-10-19T01:00:00.000Z" }),
    q({ id: "soon", expiresAt: "2026-10-19T20:00:00.000Z" }),
    q({ id: "done", status: "complete", expiresAt: "2026-10-19T00:00:00.000Z" }),
  ];
  const r = pickNextQuest(quests, null);
  assert.equal(r.quest?.id, "soon");
  assert.equal(r.more, 2);
});

test("next quest: a missed slot comes first", () => {
  const missed = q({ id: "m", expiresAt: "2026-10-30T00:00:00.000Z" });
  const r = pickNextQuest([q({ id: "a" }), missed], missed);
  assert.equal(r.quest?.id, "m");
  assert.equal(r.more, 1);
});

test("next quest: only bonus quests left still gives one", () => {
  assert.equal(pickNextQuest([q({ id: "b", bonus: true })], null).quest?.id, "b");
});

test("reward: the server's quest-complete delta to DISCIPLINE; none for bonus quests", () => {
  assert.deepEqual(questReward({}), { delta: 3, domain: "DISCIPLINE" });
  assert.equal(questReward({ bonus: true }), null);
  assert.equal(formatReward(3), "+3");
  assert.equal(formatReward(2.5), "+2.5");
});

test("deadline: hours, minutes, days, urgency and a passed deadline", () => {
  const now = new Date("2026-10-19T18:00:00.000Z");
  const two = deadlineLine("2026-10-19T20:30:00.000Z", now, "UTC");
  assert.deepEqual(two, { text: "Due 20:30 · 2h left", urgent: true });
  assert.deepEqual(deadlineLine("2026-10-19T18:20:00.000Z", now, "UTC"), { text: "Due 18:20 · 20m left", urgent: true });
  assert.deepEqual(deadlineLine("2026-10-19T23:00:00.000Z", now, "UTC"), { text: "Due 23:00 · 5h left", urgent: false });
  assert.deepEqual(deadlineLine("2026-10-22T18:00:00.000Z", now, "UTC"), { text: "Due 18:00 · 3d left", urgent: false });
  assert.deepEqual(deadlineLine("2026-10-19T17:00:00.000Z", now, "UTC"), { text: "Deadline passed", urgent: true });
  assert.equal(deadlineLine("nope", now), null);
});

test("context card: shadow > comeback > duo > floor", () => {
  assert.equal(pickContextCard({ shadow: true, comeback: true, duo: true, floor: true }), "shadow");
  assert.equal(pickContextCard({ shadow: false, comeback: true, duo: true, floor: true }), "comeback");
  assert.equal(pickContextCard({ shadow: false, comeback: false, duo: true, floor: true }), "duo");
  assert.equal(pickContextCard({ shadow: false, comeback: false, duo: false, floor: true }), "floor");
  assert.equal(pickContextCard({ shadow: false, comeback: false, duo: false, floor: false }), null);
});
