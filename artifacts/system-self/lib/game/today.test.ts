import assert from "node:assert/strict";
import { test } from "node:test";
import { deadlineLine, formatReward, pickContextCard, pickNextQuest, questReward, questTargetLabel, rewardStatement } from "./today";
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
  assert.deepEqual(questReward({ domain: "MIND" }), { delta: 3.5, domain: "MIND" });
  assert.deepEqual(questReward({ domain: "BODY", difficulty: "hard" }, 0), { delta: 5.5, domain: "BODY" });
  // At 80 only (0.2^1.8 = 0.055) of the base is left.
  assert.deepEqual(questReward({ domain: "BODY", difficulty: "hard" }, 80), { delta: 0.3, domain: "BODY" });
  assert.equal(questReward({ domain: "BODY", bonus: true }), null);
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

test("'N more today' counts only what the Quests tab's Today segment lists (dailies and bonus), not weeklies or arcs", () => {
  const quests = [
    q({ id: "a", expiresAt: "2026-10-19T10:00:00.000Z" }),
    q({ id: "b", expiresAt: "2026-10-19T11:00:00.000Z" }),
    q({ id: "c", expiresAt: "2026-10-19T12:00:00.000Z" }),
    q({ id: "w", type: "weekly", expiresAt: "2026-10-25T00:00:00.000Z" }),
    q({ id: "x", type: "arc", expiresAt: "2026-11-01T00:00:00.000Z" }),
  ];
  const r = pickNextQuest(quests, null);
  assert.equal(r.quest?.id, "a");
  assert.equal(r.more, 2);
});

test("reward statement: one honest sentence for every surface (DISCIPLINE whatever the quest's domain; streak scales it)", () => {
  assert.equal(rewardStatement(q({ domain: "MIND" })), "+3.5 MIND base. Your streak adds more.");
  assert.equal(rewardStatement(q({ bonus: true })), "No rank effect. Bonus quests don't score.");
});

test("questTargetLabel: difficulty plus the measurable target", () => {
  assert.equal(questTargetLabel({}), "NORMAL");
  assert.equal(questTargetLabel({ difficulty: "hard", target: { kind: "study", metric: "minutes", value: 90, unit: "min" } }), "HARD · 90 MIN");
  assert.equal(
    questTargetLabel({ difficulty: "normal", target: { kind: "workout", metric: "active_minutes", value: 30, unit: "min", sessions: 4 } }),
    "NORMAL · 4 × 30 MIN",
  );
  assert.equal(questTargetLabel({ difficulty: "easy", target: { kind: "steps", metric: "steps", value: 8000, unit: "steps" } }), "EASY · 8,000 STEPS");
  assert.equal(questTargetLabel({ target: { kind: "money_save", metric: "amount", value: 500, unit: "INR" } }), "NORMAL · ₹500");
  assert.equal(questTargetLabel({ target: { kind: "money_cap", metric: "amount", value: 0, unit: "INR" } }), "NORMAL · TRACK SPENDING");
  assert.equal(questTargetLabel({ target: { kind: "social_meet", metric: "count", value: 3, unit: "times" } }), "NORMAL · 3×");
  assert.equal(questTargetLabel({ target: { kind: "no_spend", metric: "days", value: 1, unit: "days" } }), "NORMAL · NO SPEND");
});
