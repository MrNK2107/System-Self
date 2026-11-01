import { test } from "node:test";
import assert from "node:assert/strict";
import { addSample, finishMovement, formatElapsed, newMovement } from "./minutes";

const feed = (start: number, minutes: number, moving: boolean) => {
  let s = newMovement(start);
  for (let i = 0; i < minutes * 600; i++) {
    const at = start + i * 100; // 10 Hz
    const z = moving ? (i % 2 ? 1.3 : 0.75) : 1.0;
    s = addSample(s, 0, 0, z, at);
  }
  return finishMovement(s);
};

test("a still phone measures minutes but none are active", () => {
  const s = feed(0, 3, false);
  assert.equal(s.measuredMinutes, 3);
  assert.equal(s.activeMinutes, 0);
});

test("a moving phone makes every measured minute active", () => {
  const s = feed(0, 4, true);
  assert.equal(s.activeMinutes, 4);
});

test("a minute with too few samples (phone asleep) is not measured", () => {
  let s = newMovement(0);
  for (let i = 0; i < 10; i++) s = addSample(s, 0, 0, i % 2 ? 1.5 : 0.5, i * 1000);
  s = addSample(s, 0, 0, 1, 61_000);
  assert.equal(s.measuredMinutes, 0);
});

test("a gap of several minutes starts a fresh bucket aligned to the minute", () => {
  let s = newMovement(0);
  s = addSample(s, 0, 0, 1, 5 * 60_000 + 500);
  assert.equal(s.minuteStart, 5 * 60_000);
  assert.equal(s.n, 1);
});

test("formatElapsed", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(12 * 60_000 + 4000), "12:04");
  assert.equal(formatElapsed(3_729_000), "1:02:09");
});
