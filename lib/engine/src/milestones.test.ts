import { test } from "node:test";
import assert from "node:assert/strict";
import { crossedMilestones, MILESTONE_TIERS, MILESTONE_TITLES } from "./milestones";

test("tiers and titles", () => {
  assert.deepEqual([...MILESTONE_TIERS], [60, 70, 80, 90, 100]);
  assert.equal(MILESTONE_TITLES.BODY[80], "PHYSICAL APEX");
  assert.equal(MILESTONE_TITLES.SOCIAL[100], "SOCIAL SOVEREIGN");
  assert.equal(MILESTONE_TITLES.DISCIPLINE[100], "DISCIPLINE SOVEREIGN");
});

test("crossedMilestones 58 to 82 = [60,70,80]", () => {
  assert.deepEqual(crossedMilestones("BODY", 58, 82, new Set()), [60, 70, 80]);
});

test("crossedMilestones skips unlocked 70", () => {
  assert.deepEqual(crossedMilestones("BODY", 58, 82, new Set(["BODY_70"])), [60, 80]);
});

test("crossedMilestones boundaries: prev < tier <= next", () => {
  assert.deepEqual(crossedMilestones("MIND", 60, 70, new Set()), [70]);
  assert.deepEqual(crossedMilestones("MIND", 50, 59.9, new Set()), []);
  assert.deepEqual(crossedMilestones("MIND", 90, 100, new Set()), [100]);
});
