import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../api/client";
import {
  RANK_FREEZE_ACTIVE_LINE,
  checkFreezeReason,
  domainSeries,
  freezeView,
  isProRequired,
  linePath,
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

test("linePath scales 0-100 into the box and clamps", () => {
  assert.equal(linePath([], 100, 40), "");
  assert.equal(linePath([0, 100], 100, 40), "M0.0 40.0 L100.0 0.0");
  assert.equal(linePath([150, -5], 100, 40), "M0.0 0.0 L100.0 40.0");
  assert.equal(linePath([50], 100, 40), "M0.0 20.0 L100.0 20.0");
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
  assert.deepEqual(domainSeries(items, "MIND"), [5, 0]);
});

test("freezeView", () => {
  assert.deepEqual(freezeView(undefined), { kind: "available" });
  assert.deepEqual(freezeView({ active: true, until: "2026-03-16", usedThisMonth: true, availableFrom: "2026-04-01" }), {
    kind: "active",
    line: RANK_FREEZE_ACTIVE_LINE,
    until: "2026-03-16",
  });
  assert.deepEqual(freezeView({ active: false, until: null, usedThisMonth: true, availableFrom: "2026-04-01" }), {
    kind: "used",
    availableFrom: "2026-04-01",
  });
});

test("isProRequired reads the server's 402", () => {
  assert.equal(isProRequired(new ApiError({ kind: "http", message: "x", status: 402, code: "pro_required" })), true);
  assert.equal(isProRequired(new ApiError({ kind: "http", message: "x", status: 409, code: "freeze_used" })), false);
});
