import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EXERCISES, DEFAULT_PLAN } from "./gym";
import { BEGINNER_DAY, EXERCISE_FALLBACKS, EXERCISE_HOWTO, briefingBlocks, estimatedMinutes, quietHours } from "./dungeon";
import { localHour } from "./dates";

const seeded = new Set(DEFAULT_EXERCISES.map((e) => e.id));

test("every seeded exercise has howTo and >=1 fallback that is itself seeded", () => {
  assert.equal(DEFAULT_EXERCISES.length, 20);
  for (const e of DEFAULT_EXERCISES) {
    const howTo = EXERCISE_HOWTO[e.id];
    assert.ok(howTo && howTo.length > 0 && howTo.length <= 120, `howTo for ${e.id}`);
    const fb = EXERCISE_FALLBACKS[e.id];
    assert.ok(fb && fb.length >= 1 && fb.length <= 2, `fallbacks for ${e.id}`);
    for (const f of fb) {
      assert.ok(seeded.has(f), `${e.id} fallback ${f} is seeded`);
      assert.notEqual(f, e.id);
    }
  }
  assert.deepEqual(EXERCISE_FALLBACKS.ex_bench, ["ex_db_press", "ex_pushup"]);
  assert.deepEqual(EXERCISE_FALLBACKS.ex_deadlift, ["ex_rdl_db"]);
});

test("new exercises are not Big 5", () => {
  const extra = DEFAULT_EXERCISES.slice(8);
  assert.equal(extra.length, 12);
  assert.ok(extra.every((e) => !e.isBig5));
});

test("briefing uses the plan day on MON and BEGINNER_DAY on TUE (default plan)", () => {
  const mon = briefingBlocks(DEFAULT_PLAN.days, "MON");
  assert.equal(mon.source, "plan");
  assert.deepEqual(mon.blocks.map((b) => b.exerciseId), ["ex_squat", "ex_bench", "ex_row"]);
  const tue = briefingBlocks(DEFAULT_PLAN.days, "TUE");
  assert.equal(tue.source, "beginner");
  assert.deepEqual(tue.blocks, BEGINNER_DAY);
  assert.equal(briefingBlocks([], "MON").source, "beginner");
  assert.equal(briefingBlocks([{ weekday: "MON", blocks: [] }], "MON").source, "beginner");
});

test("BEGINNER_DAY is goblet squat, db press, db row 3x8-12 and dead bug 2x10", () => {
  assert.deepEqual(
    BEGINNER_DAY.map((b) => [b.exerciseId, b.sets, b.repRange]),
    [["ex_goblet_squat", 3, "8-12"], ["ex_db_press", 3, "8-12"], ["ex_db_row", 3, "8-12"], ["ex_dead_bug", 2, "10"]],
  );
});

test("estimatedMinutes for BEGINNER_DAY", () => {
  // 3 x 3 x (45+90) + 2 x (45+60) = 1425 s = 23.75 min
  assert.equal(estimatedMinutes(BEGINNER_DAY), 24);
  assert.equal(estimatedMinutes([{ exerciseId: "x", sets: 2, repRange: "5", restSec: 15 }]), 2);
});

const rep = (weekday: number, hour: number, level: "quiet" | "normal" | "packed") => ({ weekday, hour, level });

test("quiet hours needs 3 reports", () => {
  assert.deepEqual(quietHours([]), { suggestions: [], needed: 3 });
  assert.deepEqual(quietHours([rep(1, 7, "quiet")]), { suggestions: [], needed: 2 });
  assert.deepEqual(quietHours([rep(1, 7, "quiet"), rep(1, 7, "quiet")]), { suggestions: [], needed: 1 });
  const three = quietHours([rep(1, 7, "quiet"), rep(1, 7, "quiet"), rep(2, 9, "packed")]);
  assert.equal(three.needed, 0);
  assert.deepEqual(three.suggestions, [{ weekday: 1, hour: 7, quietShare: 1 }]);
});

test("quiet hours ranks quiet share, ties to fewer packed, top 3, never a zero-quiet bucket", () => {
  const out = quietHours([
    rep(2, 7, "quiet"), rep(2, 7, "quiet"),
    rep(3, 18, "quiet"), rep(3, 18, "packed"),
    rep(4, 12, "quiet"), rep(4, 12, "normal"),
    rep(5, 20, "quiet"), rep(5, 20, "packed"), rep(5, 20, "packed"),
    rep(6, 9, "packed"),
  ]);
  assert.deepEqual(out.suggestions, [
    { weekday: 2, hour: 7, quietShare: 1 },
    { weekday: 4, hour: 12, quietShare: 0.5 },
    { weekday: 3, hour: 18, quietShare: 0.5 },
  ]);
});

test("localHour reads the hour in the user's zone", () => {
  assert.equal(localHour(new Date("2026-10-19T12:30:00Z"), "Asia/Kolkata"), 18);
  assert.equal(localHour(new Date("2026-10-19T00:10:00Z"), "UTC"), 0);
});
