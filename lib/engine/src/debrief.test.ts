import { test } from "node:test";
import assert from "node:assert/strict";
import { debriefVerdict } from "./debrief";

const d = (v: number, discipline = v) => ({ BODY: v, MIND: v, WEALTH: v, SOCIAL: v, DISCIPLINE: discipline });

test("verdict ACCEPTABLE avg 2.0 discipline 0 rate 0.5", () => {
  assert.equal(debriefVerdict({ BODY: 2.5, MIND: 2.5, WEALTH: 2.5, SOCIAL: 2.5, DISCIPLINE: 0 }, 0.5), "ACCEPTABLE");
});
test("verdict PATHETIC avg 0 rate 0", () => {
  assert.equal(debriefVerdict(d(0), 0), "PATHETIC");
});
test("verdict PATHETIC avg < -1 rate < 0.25", () => {
  assert.equal(debriefVerdict(d(-1.5), 0.2), "PATHETIC");
});
test("verdict INSUFFICIENT otherwise", () => {
  assert.equal(debriefVerdict(d(2), 0.4), "INSUFFICIENT");
  assert.equal(debriefVerdict(d(2, -1), 1), "INSUFFICIENT");
  assert.equal(debriefVerdict(d(0.5), 0), "INSUFFICIENT");
});
