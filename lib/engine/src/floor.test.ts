import test from "node:test";
import assert from "node:assert/strict";
import { FLOOR_ROUTINES, pickFloorRoutine } from "./floor";

test("at least 6 routines, 8-15 minutes, steps add up to the stated minutes", () => {
  assert.ok(FLOOR_ROUTINES.length >= 6);
  assert.equal(new Set(FLOOR_ROUTINES.map((r) => r.id)).size, FLOOR_ROUTINES.length);
  for (const r of FLOOR_ROUTINES) {
    assert.ok(r.minutes >= 8 && r.minutes <= 15, `${r.id} minutes ${r.minutes}`);
    assert.ok(r.steps.length > 0);
    const total = r.steps.reduce((s, x) => s + x.seconds, 0);
    assert.equal(Math.round(total / 60), r.minutes, `${r.id} steps total ${total}s`);
  }
});

test("pickFloorRoutine is deterministic and within 8-15 min", () => {
  const a = pickFloorRoutine("quest-1");
  assert.equal(pickFloorRoutine("quest-1"), a);
  assert.ok(a.minutes >= 8 && a.minutes <= 15);
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(pickFloorRoutine(`seed-${i}`).id);
  assert.ok(seen.size > 1);
  assert.ok(FLOOR_ROUTINES.includes(pickFloorRoutine("")));
});
