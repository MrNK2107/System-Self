import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_LOG_DELTA,
  CUSTOM_LIMIT_FREE,
  CUSTOM_LIMIT_PRO,
  CUSTOM_START_SCORE,
  applyCustomLog,
  customStreakNow,
  customProgress,
} from "./custom";

const fresh = { score: CUSTOM_START_SCORE, streak: 0, lastLogDate: null as string | null };

test("custom constants", () => {
  assert.equal(CUSTOM_LOG_DELTA, 2.5);
  assert.equal(CUSTOM_LIMIT_FREE, 3);
  assert.equal(CUSTOM_LIMIT_PRO, 20);
  assert.equal(CUSTOM_START_SCORE, 50);
});

test("a custom log is +2.5 with the domain's own streak multiplier", () => {
  const first = applyCustomLog(fresh, "2026-01-01");
  assert.deepEqual(first.next, { score: 52.5, streak: 1, lastLogDate: "2026-01-01" });
  // streak 1 -> x1.05: 2.625 rounds to 2.6
  const second = applyCustomLog(first.next, "2026-01-02");
  assert.deepEqual(second.next, { score: 55.1, streak: 2, lastLogDate: "2026-01-02" });
  // the same day again: streak unchanged, multiplier of the current streak
  const same = applyCustomLog(second.next, "2026-01-02");
  assert.equal(same.next.streak, 2);
  // streak 2 -> x1.1: 2.75 rounds to 2.8
  assert.equal(same.next.score, 57.9);
});

test("a gap resets the streak, a retroactive older date scores without moving the streak", () => {
  const s = { score: 60, streak: 5, lastLogDate: "2026-01-10" };
  assert.equal(applyCustomLog(s, "2026-01-13").next.streak, 1);
  const retro = applyCustomLog(s, "2026-01-09");
  assert.equal(retro.next.streak, 5);
  assert.equal(retro.next.lastLogDate, "2026-01-10");
  assert.ok(retro.next.score > 60);
});

test("with today given, a backdated log into a lapsed streak scores but repairs nothing", () => {
  const lapsed = { score: 60, streak: 5, lastLogDate: "2026-01-02" };
  const r = applyCustomLog(lapsed, "2026-01-05", "2026-01-08");
  assert.ok(r.next.score > 60);
  assert.equal(r.next.streak, 5);
  assert.equal(r.next.lastLogDate, "2026-01-02");
  assert.equal(applyCustomLog(r.next, "2026-01-08", "2026-01-08").next.streak, 1);
});

test("the custom score is capped at 100", () => {
  assert.equal(applyCustomLog({ score: 99, streak: 20, lastLogDate: "2026-01-01" }, "2026-01-02").next.score, 100);
});

test("customStreakNow: a streak that was not continued yesterday or today reads 0", () => {
  assert.equal(customStreakNow(4, "2026-01-10", "2026-01-10"), 4);
  assert.equal(customStreakNow(4, "2026-01-10", "2026-01-11"), 4);
  assert.equal(customStreakNow(4, "2026-01-10", "2026-01-12"), 0);
  assert.equal(customStreakNow(0, null, "2026-01-12"), 0);
});

test("customProgress: baseline to target as 0..1, either direction, no division by zero", () => {
  assert.equal(customProgress(0, 100, 25), 0.25);
  assert.equal(customProgress(100, 60, 80), 0.5);
  assert.equal(customProgress(0, 100, 150), 1);
  assert.equal(customProgress(0, 100, -5), 0);
  assert.equal(customProgress(10, 10, 10), 1);
  assert.equal(customProgress(10, 10, 9), 0);
  assert.equal(customProgress(0, 100, null), 0);
});
