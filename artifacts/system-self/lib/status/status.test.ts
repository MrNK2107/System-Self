import test from "node:test";
import assert from "node:assert/strict";
import {
  changeTone,
  domainSummaryLine,
  historyReady,
  overviewLine,
  performanceLine,
  formatChange,
  groupByDay,
  latestTitle,
  rankLine,
  recapReady,
  weekChange,
} from "./status";

test("rankLine: progress toward the next rank, with the honest promotion rule", () => {
  const l = rankLine("E", 42.4);
  assert.equal(l.progress, 42);
  assert.equal(l.next, "D");
  assert.equal(l.progressLine, "42% of the way to D");
  assert.equal(l.promotionLine, "Promotion: 14 days in a row above the D line.");
});

test("rankLine: clamps and handles the top rank", () => {
  assert.equal(rankLine("C", 140).progress, 100);
  assert.equal(rankLine("C", -3).progress, 0);
  assert.equal(rankLine("C", Number.NaN).progress, 0);
  const s = rankLine("S", 50);
  assert.equal(s.next, null);
  assert.equal(s.promotionLine, null);
});

test("weekChange: today minus the snapshot seven days before the last day", () => {
  const history = {
    to: "2026-10-20",
    items: [
      { date: "2026-10-13", rank: "E", scores: { BODY: 30 } },
      { date: "2026-10-20", rank: "E", scores: { BODY: 31 } },
    ],
  };
  assert.equal(weekChange(history, "BODY", 31.4), 1.4);
  assert.equal(weekChange(history, "MIND", 10), null);
});

test("weekChange: null before a week of history exists", () => {
  assert.equal(weekChange(undefined, "BODY", 10), null);
  assert.equal(weekChange({ to: "2026-10-20", items: [] }, "BODY", 10), null);
  assert.equal(weekChange({ to: "2026-10-20", items: [{ date: "2026-10-18", rank: "E", scores: { BODY: 5 } }] }, "BODY", 10), null);
});

test("formatChange and changeTone", () => {
  assert.equal(formatChange(1.4), "+1.4");
  assert.equal(formatChange(-0.3), "−0.3");
  assert.equal(formatChange(0), "0.0");
  assert.equal(changeTone(1), "up");
  assert.equal(changeTone(-1), "down");
  assert.equal(changeTone(0), "flat");
  assert.equal(changeTone(null), "flat");
});

test("latestTitle: newest milestone title, else newest achievement, else null", () => {
  const defs = (id: string) => ({ first_log: "FIRST TRANSMISSION", streak_7: "7-DAY OPERATIVE" })[id];
  const ach = [
    { id: "first_log", unlockedAt: "2026-10-01T00:00:00Z" },
    { id: "streak_7", unlockedAt: "2026-10-08T00:00:00Z" },
  ];
  assert.equal(latestTitle([], ach, defs), "7-DAY OPERATIVE");
  assert.equal(
    latestTitle(
      [
        { title: "CONDITIONED", unlockedAt: "2026-10-02T00:00:00Z" },
        { title: "AWARE", unlockedAt: "2026-10-05T00:00:00Z" },
        { title: "BUILDER", unlockedAt: null },
      ],
      ach,
      defs,
    ),
    "AWARE",
  );
  assert.equal(latestTitle([{ title: "X", unlockedAt: null }], [{ id: "first_log", unlockedAt: null }], defs), null);
});

test("recapReady: no recap claims before a week has closed", () => {
  assert.equal(recapReady(1), false);
  assert.equal(recapReady(7), false);
  assert.equal(recapReady(8), true);
});

test("groupByDay: newest day first, newest entry first", () => {
  const logs = [
    { id: "a", timestamp: "2026-10-19T08:00:00Z" },
    { id: "b", timestamp: "2026-10-20T09:00:00Z" },
    { id: "c", timestamp: "2026-10-20T07:00:00Z" },
  ];
  const g = groupByDay(logs, (iso) => iso.slice(0, 10));
  assert.deepEqual(
    g.map((d) => [d.day, d.items.map((i) => i.id)]),
    [
      ["2026-10-20", ["b", "c"]],
      ["2026-10-19", ["a"]],
    ],
  );
});

test("historyReady: needs two distinct days", () => {
  assert.equal(historyReady([]), false);
  assert.equal(historyReady([{ date: "2026-10-01" }]), false);
  assert.equal(historyReady([{ date: "2026-10-01" }, { date: "2026-10-01" }]), false);
  assert.equal(historyReady([{ date: "2026-10-01" }, { date: "2026-10-02" }]), true);
});

test("domainSummaryLine: one sentence, honest when empty", () => {
  assert.equal(domainSummaryLine({ streak: 0, multiplier: 1, logs: 0, change: null }), "Streak 0 days. Multiplier x1.0. No logs yet.");
  assert.equal(
    domainSummaryLine({ streak: 1, multiplier: 1.2, logs: 12, change: 1.4, title: "Iron" }),
    "Streak 1 day. Multiplier x1.2. 12 logs. +1.4 this week. Title earned: Iron.",
  );
});

test("overviewLine: days, logs and quests in words", () => {
  assert.equal(overviewLine({ day: 1, logs: 0, quests: 0, forbidden: 0 }), "Day 1. No logs yet. No quests completed.");
  assert.equal(overviewLine({ day: 12, logs: 1, quests: 9, forbidden: 2 }), "Day 12. 1 log. 9 quests completed. 2 forbidden logs.");
});

test("performanceLine: no fake rate before any attempt", () => {
  assert.equal(performanceLine(0, 0, 14), "No quests tried in 14 days.");
  assert.equal(performanceLine(7, 10, 14), "7 of 10 quests tried were completed in 14 days.");
});
