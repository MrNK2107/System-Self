import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RANK_UP_PREP_MIN_DAYS,
  RANK_UP_PREP_MIN_PROGRESS,
  nextRankOf,
  rankUpPrepItems,
  shouldShowRankUpPrep,
} from "./rank-prep";

test("nextRankOf walks E to S and stops", () => {
  assert.equal(nextRankOf("E"), "D");
  assert.equal(nextRankOf("A"), "S");
  assert.equal(nextRankOf("S"), null);
  assert.equal(nextRankOf("Z"), null);
  assert.equal(nextRankOf(null), null);
});

test("rank-up prep never shows on day 1, even at 80% progress", () => {
  assert.equal(shouldShowRankUpPrep({ rank: "E", tierProgress: 80, dayNumber: 1 }), false);
  assert.equal(shouldShowRankUpPrep({ rank: "E", tierProgress: 100, dayNumber: 7 }), false); // 6 days since onboarding
});

test("rank-up prep shows after 7 full days at 75% or more", () => {
  const firstDay = RANK_UP_PREP_MIN_DAYS + 1;
  assert.equal(shouldShowRankUpPrep({ rank: "E", tierProgress: RANK_UP_PREP_MIN_PROGRESS, dayNumber: firstDay }), true);
  assert.equal(shouldShowRankUpPrep({ rank: "C", tierProgress: 92, dayNumber: 30 }), true);
});

test("rank-up prep needs real progress", () => {
  assert.equal(shouldShowRankUpPrep({ rank: "E", tierProgress: 74.9, dayNumber: 30 }), false);
  assert.equal(shouldShowRankUpPrep({ rank: "E", tierProgress: null, dayNumber: 30 }), false);
  assert.equal(shouldShowRankUpPrep({ rank: "E", tierProgress: Number.NaN, dayNumber: 30 }), false);
});

test("rank-up prep is off at S rank and without a profile", () => {
  assert.equal(shouldShowRankUpPrep({ rank: "S", tierProgress: 99, dayNumber: 300 }), false);
  assert.equal(shouldShowRankUpPrep({ rank: undefined, tierProgress: 99, dayNumber: 300 }), false);
  assert.equal(shouldShowRankUpPrep({ rank: "E", tierProgress: 99, dayNumber: undefined }), false);
});

test("prep items belong to the next rank", () => {
  assert.equal(rankUpPrepItems("E").length, 2);
  assert.match(rankUpPrepItems("E")[0]!.title, /7 days/);
  assert.deepEqual(rankUpPrepItems("S"), []);
});
