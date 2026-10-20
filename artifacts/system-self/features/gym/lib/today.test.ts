import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateMinutes, exerciseCount, sessionSummary } from "./today";

test("exercise count is distinct exercises", () => {
  assert.equal(exerciseCount([]), 0);
  assert.equal(
    exerciseCount([
      { exerciseId: "squat", sets: 3, restSec: 120 },
      { exerciseId: "squat", sets: 2, restSec: 90 },
      { exerciseId: "bench", sets: 3, restSec: 90 },
    ]),
    2,
  );
});

test("estimated minutes: work plus rest, no rest after the last set, rounded up to 5", () => {
  assert.equal(estimateMinutes([]), 0);
  assert.equal(estimateMinutes([{ exerciseId: "a", sets: 0, restSec: 90 }]), 0);
  // 1 set: 40 s -> minimum 5 min.
  assert.equal(estimateMinutes([{ exerciseId: "a", sets: 1, restSec: 90 }]), 5);
  // 3 x (40 + 120) - 120 = 360 s = 6 min -> 10.
  assert.equal(estimateMinutes([{ exerciseId: "a", sets: 3, restSec: 120 }]), 10);
  // 5 x 3 sets at 90 s rest: 15 x 130 - 90 = 1860 s = 31 min -> 35.
  const day = ["a", "b", "c", "d", "e"].map((exerciseId) => ({ exerciseId, sets: 3, restSec: 90 }));
  assert.equal(estimateMinutes(day), 35);
  assert.equal(sessionSummary(day), "5 exercises · about 35 min");
  assert.equal(sessionSummary([{ exerciseId: "a", sets: 1, restSec: 0 }]), "1 exercise · about 5 min");
});
