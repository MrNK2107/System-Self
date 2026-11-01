import { test } from "node:test";
import assert from "node:assert/strict";
import { activeMinutesFrom, coarse, distanceM, learnPlaces, matchPlace, verifyWorkout, type KnownPlace, type SessionSummary } from "./proof";

const gym: KnownPlace = { id: "g1", kind: "gym", lat: 12.9716, lng: 77.5946, radiusM: 80, source: "osm", name: "Iron Den" };
const library: KnownPlace = { id: "l1", kind: "study", lat: 12.9716, lng: 77.5946, radiusM: 80, source: "saved" };

const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  kind: "workout",
  startedAt: "2026-11-01T06:00:00.000Z",
  endedAt: "2026-11-01T06:45:00.000Z",
  activeMinutes: 0,
  steps: 0,
  placeId: null,
  placeShare: 0,
  mocked: false,
  ...over,
});
const workout30 = { kind: "workout" as const, metric: "active_minutes" as const, value: 30, unit: "min" as const };

test("distanceM: ~111 km per degree of latitude, 0 for the same point", () => {
  assert.equal(Math.round(distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) / 1000), 111);
  assert.equal(distanceM(gym, gym), 0);
});

test("matchPlace picks the place most fixes are in, ignores places that don't fit, and mocked fixes", () => {
  const near = { lat: 12.9717, lng: 77.5946, at: 0 };
  const far = { lat: 13.1, lng: 77.6, at: 1 };
  const m = matchPlace([near, near, near, far], [gym, library], "workout");
  assert.equal(m?.place.id, "g1");
  assert.equal(m?.share, 0.75);
  assert.equal(matchPlace([near], [library], "workout"), null, "a library doesn't prove a workout");
  assert.equal(matchPlace([near], [library], "study")?.place.id, "l1");
  assert.equal(matchPlace([{ ...near, mocked: true }], [gym], "workout"), null);
});

test("activeMinutesFrom counts minutes with enough movement and enough samples", () => {
  const still = Array.from({ length: 60 }, () => 1.0);
  const moving = Array.from({ length: 60 }, (_, i) => (i % 2 ? 1.25 : 0.8));
  const sparse = [1, 2, 1];
  assert.equal(activeMinutesFrom([still, moving, moving, sparse]), 2);
});

test("a workout is proven by movement for the target's minutes", () => {
  const v = verifyWorkout(summary({ activeMinutes: 32, steps: 3120 }), workout30, null);
  assert.equal(v.ok, true);
  assert.deepEqual(v.evidence, ["32 active min", "45 min total", "3,120 steps"]);
});

test("phone in a locker: proven by most of a long-enough session at a gym", () => {
  const v = verifyWorkout(summary({ activeMinutes: 2, placeId: "g1", placeShare: 0.9 }), workout30, gym);
  assert.equal(v.ok, true);
  assert.ok(v.evidence.includes("at Iron Den"));
  const brief = verifyWorkout(summary({ activeMinutes: 2, placeId: "g1", placeShare: 0.5 }), workout30, gym);
  assert.equal(brief.ok, false);
});

test("still phone, no gym: rejected with what to do next", () => {
  const v = verifyWorkout(summary({ activeMinutes: 5 }), workout30, null);
  assert.equal(v.ok, false);
  assert.match(v.reason, /save this place as your gym/);
});

test("too short is rejected as too short", () => {
  const v = verifyWorkout(summary({ endedAt: "2026-11-01T06:20:00.000Z", activeMinutes: 20 }), workout30, null);
  assert.equal(v.ok, false);
  assert.match(v.reason, /20 of 30 minutes/);
});

test("mocked location never proves, even with movement", () => {
  assert.equal(verifyWorkout(summary({ activeMinutes: 60, mocked: true }), workout30, null).ok, false);
});

test("steps targets need the steps", () => {
  const steps = { kind: "steps" as const, metric: "steps" as const, value: 8000, unit: "steps" as const };
  assert.equal(verifyWorkout(summary({ steps: 8500 }), steps, null).ok, true);
  assert.match(verifyWorkout(summary({ steps: 4000 }), steps, null).reason, /4,000 of 8,000 steps/);
});

test("a workout session can't prove a study quest", () => {
  const study = { kind: "study" as const, metric: "minutes" as const, value: 30, unit: "min" as const };
  assert.equal(verifyWorkout(summary({ activeMinutes: 60 }), study, null).ok, false);
});

test("learnPlaces: a spot becomes a place only after 3 different users, one place per busy spot", () => {
  const at = (userId: string, dLat = 0) => ({ userId, kind: "gym" as const, lat: 12.97161 + dLat, lng: 77.59461 });
  assert.equal(learnPlaces([at("a"), at("a"), at("b")]).length, 0, "two users are not enough");
  const learned = learnPlaces([at("a"), at("b"), at("c", 0.0001), at("c")]);
  assert.equal(learned.length, 1);
  assert.equal(learned[0]!.source, "learned");
  assert.equal(learned[0]!.radiusM, 75);
  assert.ok(distanceM(learned[0]!, { lat: 12.97161, lng: 77.59461 }) < 20);
});

test("coarse rounds to about 100 m", () => {
  assert.deepEqual(coarse({ lat: 12.971649, lng: 77.594612 }), { lat: 12.972, lng: 77.595 });
});
