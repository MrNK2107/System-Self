import { test } from "node:test";
import assert from "node:assert/strict";
import {
  completionMultiplier,
  evaluateRankTransition,
  generateCodename,
  hiddenScore,
  rankCeil,
  rankFloor,
  tierOf,
  tierProgress,
  trajectory,
  type Snapshot,
} from "./rank";
import { addDays } from "./dates";

const snaps = (values: number[], end = "2026-10-19"): Snapshot[] =>
  values.map((hidden, i) => ({ date: addDays(end, i - (values.length - 1)), hidden }));

test("hiddenScore all 50 with m=1 → 50", () => {
  const s = { BODY: 50, MIND: 50, WEALTH: 50, SOCIAL: 50, DISCIPLINE: 50 };
  assert.equal(hiddenScore(s, 1), 50);
});

test("hiddenScore weights and rounding", () => {
  const s = { BODY: 60, MIND: 40, WEALTH: 30, SOCIAL: 20, DISCIPLINE: 70 };
  assert.equal(hiddenScore(s, 1), 48.5);
  assert.equal(hiddenScore(s, 1.1), 53.35);
});

test("completionMultiplier", () => {
  assert.equal(completionMultiplier(4, 4), 1.0);
  assert.equal(completionMultiplier(10, 9), 1.1);
  assert.equal(completionMultiplier(10, 4), 0.85);
  assert.equal(completionMultiplier(10, 7), 1.0);
  assert.equal(completionMultiplier(0, 0), 1.0);
});

test("tierOf boundaries", () => {
  assert.equal(tierOf(25), "E");
  assert.equal(tierOf(26), "D");
  assert.equal(tierOf(85.99), "A");
  assert.equal(tierOf(86), "S");
  assert.equal(tierOf(0), "E");
  assert.equal(tierOf(100), "S");
});

test("rankFloor / rankCeil", () => {
  assert.deepEqual((["E", "D", "C", "B", "A", "S"] as const).map(rankFloor), [0, 26, 41, 56, 71, 86]);
  assert.deepEqual((["E", "D", "C", "B", "A", "S"] as const).map(rankCeil), [25, 40, 55, 70, 85, 100]);
});

test("tierProgress", () => {
  assert.equal(tierProgress(26, "D"), 0);
  assert.equal(tierProgress(33, "D"), 50);
  assert.equal(tierProgress(10, "D"), 0);
  assert.equal(tierProgress(99, "D"), 100);
  assert.equal(tierProgress(93, "S"), 50);
  assert.equal(tierProgress(100, "S"), 100);
});

test("promotion needs 14 consecutive snapshots above tier: 13 → null, 14 → D", () => {
  assert.equal(evaluateRankTransition("E", snaps(Array(13).fill(30)), false), null);
  assert.deepEqual(evaluateRankTransition("E", snaps(Array(14).fill(30)), false), { kind: "promotion", to: "D" });
});

test("one dip in the last 14 resets promotion", () => {
  const v = Array(14).fill(30);
  v[5] = 20;
  assert.equal(evaluateRankTransition("E", snaps(v), false), null);
});

test("only the last 14 matter", () => {
  const v = [10, 10, ...Array(14).fill(30)];
  assert.deepEqual(evaluateRankTransition("E", snaps(v), false), { kind: "promotion", to: "D" });
});

test("promotion is one tier even if snapshots are in A", () => {
  assert.deepEqual(evaluateRankTransition("E", snaps(Array(14).fill(75)), false), { kind: "promotion", to: "D" });
});

test("demotion after 7 below floor; freeze blocks it", () => {
  const s = snaps(Array(7).fill(30));
  assert.deepEqual(evaluateRankTransition("C", s, false), { kind: "demotion", to: "D" });
  assert.equal(evaluateRankTransition("C", s, true), null);
  assert.equal(evaluateRankTransition("C", snaps(Array(6).fill(30)), false), null);
});

test("E never demotes, S never promotes", () => {
  assert.equal(evaluateRankTransition("E", snaps(Array(7).fill(0)), false), null);
  assert.equal(evaluateRankTransition("S", snaps(Array(14).fill(100)), false), null);
});

test("trajectory", () => {
  assert.equal(trajectory([], 50), "stable");
  const s = snaps([50, 50, 50, 50, 50, 50, 50, 50]); // 7 days before newest exists
  assert.equal(trajectory(s, 51.5), "up");
  assert.equal(trajectory(s, 48.5), "down");
  assert.equal(trajectory(s, 51), "stable");
  assert.equal(trajectory(snaps([40, 50]), 50), "up"); // earliest fallback
});

test("trajectory uses the snapshot exactly 7 days before newest", () => {
  const s = snaps([10, 60, 50, 50, 50, 50, 50, 50]); // index0 = 7 days before newest
  assert.equal(trajectory(s, 50), "up");
  const t = snaps([60, 10, 50, 50, 50, 50, 50, 50]); // index1 is 6 days before; index0 is the 7-day one
  assert.equal(trajectory(t, 50), "down");
});

test("generateCodename", () => {
  assert.match(generateCodename("D"), /^VECTOR \/\/ [A-Z0-9]{3}-[1-9]$/);
  for (const [r, p] of [["E", "GHOST"], ["C", "CIPHER"], ["B", "PHANTOM"], ["A", "WRAITH"], ["S", "ORACLE"]] as const) {
    assert.ok(generateCodename(r).startsWith(`${p} // `));
  }
  assert.equal(generateCodename("D", () => 0), "VECTOR // AAA-1");
});

test("trajectory: an exact +1.00 difference (float noise) is stable", () => {
  const s = [{ date: "2026-01-01", hidden: 1.14 }];
  assert.equal(trajectory(s, 2.14), "stable");
  assert.equal(trajectory([{ date: "2026-01-01", hidden: 2.14 }], 1.14), "stable");
});
