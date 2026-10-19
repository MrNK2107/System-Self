import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../api/client";
import {
  RANK_FREEZE_ACTIVE_LINE,
  checkFreezeReason,
  domainSeries,
  freezeView,
  isProRequired,
  barRects,
  dayOffset,
  seriesPath,
  rankChanges,
} from "./history";

test("the active line is verbatim", () => {
  assert.equal(RANK_FREEZE_ACTIVE_LINE, "Rank Freeze active. The clock is paused. You are not.");
});

test("checkFreezeReason: required once trimmed, at most 120", () => {
  assert.notEqual(checkFreezeReason("   "), null);
  assert.equal(checkFreezeReason("  away  "), null);
  assert.equal(checkFreezeReason("x".repeat(120)), null);
  assert.notEqual(checkFreezeReason("x".repeat(121)), null);
});

test("rankChanges marks the first day of each new rank", () => {
  const items = [{ rank: "E" }, { rank: "E" }, { rank: "D" }, { rank: "D" }, { rank: "E" }];
  assert.deepEqual(rankChanges(items), [
    { index: 2, from: "E", to: "D" },
    { index: 4, from: "D", to: "E" },
  ]);
  assert.deepEqual(rankChanges([]), []);
});

test("domainSeries reads one domain, missing as 0", () => {
  const items: { date: string; rank: string; scores: Record<string, number> }[] = [
    { date: "a", rank: "E", scores: { BODY: 10, MIND: 5 } },
    { date: "b", rank: "E", scores: { BODY: 20 } },
  ];
  assert.deepEqual(domainSeries(items, "MIND"), [{ date: "a", value: 5 }, { date: "b", value: 0 }]);
});

test("freezeView", () => {
  assert.deepEqual(freezeView(undefined), { kind: "available" });
  assert.deepEqual(freezeView({ active: true, until: "2026-03-16", usedThisMonth: true, availableFrom: "2026-04-01" }), {
    kind: "active",
    line: RANK_FREEZE_ACTIVE_LINE,
    until: "2026-03-16",
  });
  assert.deepEqual(freezeView({ active: false, until: null, usedThisMonth: true, availableFrom: "2026-04-01" }), {
    kind: "wait",
    availableFrom: "2026-04-01",
  });
  assert.deepEqual(freezeView({ active: false, until: null, usedThisMonth: false, availableFrom: "2026-04-13" }), {
    kind: "wait",
    availableFrom: "2026-04-13",
  });
});

test("isProRequired reads the server's 402", () => {
  assert.equal(isProRequired(new ApiError({ kind: "http", message: "x", status: 402, code: "pro_required" })), true);
  assert.equal(isProRequired(new ApiError({ kind: "http", message: "x", status: 409, code: "freeze_used" })), false);
});

test("dayOffset counts days from the window start (month and year boundaries)", () => {
  assert.equal(dayOffset("2026-02-25", "2026-02-25"), 0);
  assert.equal(dayOffset("2026-02-25", "2026-03-10"), 13);
  assert.equal(dayOffset("2025-12-30", "2026-01-02"), 3);
});

test("seriesPath places points by day offset and breaks the path at missing days", () => {
  // Window of 5 days (offsets 0..4) over width 80: 20 per day.
  const pts = [
    { date: "2026-03-01", value: 100 },
    { date: "2026-03-02", value: 100 },
    { date: "2026-03-05", value: 0 },
  ];
  assert.equal(seriesPath(pts, "2026-03-01", 5, 80, 40), "M0.0 0.0 L20.0 0.0 M80.0 40.0 L80.0 40.0");
  assert.equal(seriesPath([], "2026-03-01", 5, 80, 40), "");
  // Contiguous days stay one stroke.
  assert.equal(seriesPath(pts.slice(0, 2), "2026-03-01", 5, 80, 40), "M0.0 0.0 L20.0 0.0");
});

test("barRects: one bar per day by offset, height is the completion rate", () => {
  const bars = barRects([{ date: "2026-03-03", completed: 1, resolved: 2 }], "2026-03-01", 5, 100, 40);
  assert.equal(bars.length, 1);
  assert.equal(bars[0]!.x, 45); // offset 2 of 4 steps over width 100: centre 50, bar width 10
  assert.equal(bars[0]!.height, 20);
  assert.equal(bars[0]!.y, 20);
});
