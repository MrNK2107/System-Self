import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGymPoints, DEFAULT_EXERCISES, DEFAULT_PLAN, estimate1RM } from "./gym";

const primary = (id: string) => DEFAULT_EXERCISES.find((e) => e.id === id)?.primaryBodyPart;
const mon = DEFAULT_PLAN.days.find((d) => d.weekday === "MON")!.blocks;
const sets = (id: string, n: number, completed = true) =>
  Array.from({ length: n }, () => ({ exerciseId: id, completed }));

test("default plan and exercises exactly as in the app", () => {
  assert.equal(DEFAULT_PLAN.name, "Starter Strength");
  assert.equal(DEFAULT_PLAN.goal, "Consistency and progressive overload");
  assert.deepEqual(DEFAULT_PLAN.days.map((d) => d.weekday), ["MON", "WED", "FRI"]);
  assert.equal(DEFAULT_EXERCISES.length, 8);
  assert.deepEqual(mon[2], { exerciseId: "ex_row", sets: 3, repRange: "6-10", restSec: 90 });
});

test("gym full default MON day = 17.3", () => {
  const performed = [...sets("ex_squat", 3), ...sets("ex_bench", 3), ...sets("ex_row", 3)];
  const r = computeGymPoints(performed, mon, primary);
  assert.equal(r.totalPoints, 17.3);
  assert.equal(r.finishedBlocks, 3);
  assert.equal(r.byBodyPart.quads, 5.1);
});

test("partial: no block bonus, extra sets and uncompleted sets ignored", () => {
  const performed = [
    ...sets("ex_squat", 5),
    ...sets("ex_bench", 2),
    ...sets("ex_bench", 1, false),
    ...sets("ex_deadlift", 3),
  ];
  const r = computeGymPoints(performed, mon, primary);
  assert.equal(r.totalPoints, 7.5); // squat 3.6+1.5, bench 2.4
  assert.equal(r.finishedBlocks, 1);
  assert.equal(r.byBodyPart.hamstrings, undefined);
});

test("no plan scores 0", () => {
  assert.deepEqual(computeGymPoints(sets("ex_squat", 3), [], primary), {
    totalPoints: 0,
    byBodyPart: {},
    finishedBlocks: 0,
  });
});

test("estimate1RM(100, 5) = 116.67 (2 decimals)", () => {
  assert.equal(estimate1RM(100, 5), 116.67);
  assert.equal(estimate1RM(0, 5), 0);
  assert.equal(estimate1RM(100, 0), 0);
});
