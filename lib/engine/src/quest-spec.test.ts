import { test } from "node:test";
import assert from "node:assert/strict";
import { inferQuestSpec } from "./quest-spec";

const q = (domain: string, type: "daily" | "weekly" | "arc", title: string, description: string) =>
  inferQuestSpec({ domain, type, title, description });

test("MIND 90-minute focus block is a hard 90 min study target", () => {
  assert.deepEqual(q("MIND", "daily", "Deep work session", "Complete one uninterrupted 90-minute focus session."), {
    difficulty: "hard",
    target: { kind: "study", metric: "minutes", value: 90, unit: "min" },
  });
});

test("a 25-minute block is easy", () => {
  assert.equal(q("MIND", "daily", "One short focus block", "Complete one focused block of 25 minutes and log it.").difficulty, "easy");
});

test("hours convert to minutes", () => {
  const s = q("MIND", "weekly", "Finish one deep project block", "Spend five hours of focused work on one thing this week.");
  assert.deepEqual(s.target, { kind: "study", metric: "minutes", value: 300, unit: "min" });
});

test("BODY weekly four sessions: workout sessions target, default 30 active min each", () => {
  assert.deepEqual(q("BODY", "weekly", "Four training sessions", "Log four separate workouts before the week closes."), {
    difficulty: "normal",
    target: { kind: "workout", metric: "active_minutes", value: 30, unit: "min", sessions: 4 },
  });
});

test("BODY home session under 25 minutes is easy", () => {
  const s = q("BODY", "daily", "Home session", "Do one bodyweight home session of under 25 minutes, no equipment, and log it.");
  assert.equal(s.difficulty, "easy");
  assert.equal(s.target?.value, 25);
});

test("steps quests target steps", () => {
  assert.deepEqual(q("BODY", "daily", "Walk it off", "Walk 8,000 steps today.").target, {
    kind: "steps",
    metric: "steps",
    value: 8000,
    unit: "steps",
  });
});

test("WEALTH saving with a rupee amount is money_save", () => {
  assert.deepEqual(q("WEALTH", "weekly", "Pay yourself first", "Move ₹500 to savings this week.").target, {
    kind: "money_save",
    metric: "amount",
    value: 500,
    unit: "INR",
  });
});

test("WEALTH spending limit is money_cap; no-spend is no_spend", () => {
  assert.equal(q("WEALTH", "weekly", "Hold the line", "Keep spending under Rs 1,500 this week.").target?.kind, "money_cap");
  assert.equal(q("WEALTH", "weekly", "Hold the line", "Keep spending under Rs 1,500 this week.").target?.value, 1500);
  assert.equal(q("WEALTH", "daily", "No-spend day", "Spend nothing today.").target?.kind, "no_spend");
});

test("SOCIAL three conversations is a hard 3-meet target", () => {
  assert.deepEqual(q("SOCIAL", "weekly", "Three real conversations", "Meet or call three people you have been avoiding."), {
    difficulty: "hard",
    target: { kind: "social_meet", metric: "count", value: 3, unit: "times" },
  });
});

test("arcs are hard; DISCIPLINE quests carry no target", () => {
  assert.equal(q("BODY", "arc", "Twenty-one day training arc", "Train at least five days in each of the next three weeks.").difficulty, "hard");
  assert.deepEqual(q("DISCIPLINE", "daily", "Maintain your streak", "Log at least one entry today in every domain."), {
    difficulty: "normal",
    target: null,
  });
});

test("text with no numbers falls back to the domain default and never throws", () => {
  assert.deepEqual(q("BODY", "daily", "Log your workout", "Complete and log any physical activity today.").target, {
    kind: "workout",
    metric: "active_minutes",
    value: 30,
    unit: "min",
  });
  assert.deepEqual(q("CUSTOM_X", "daily", "", "").target, null);
});
