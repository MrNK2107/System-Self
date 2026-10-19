import { test } from "node:test";
import assert from "node:assert/strict";
import { PEER_MIN_RATINGS, PEER_RATINGS_PER_WEEK, PEER_TENURE_DAYS, peerRatingResult, peerTenureMet } from "./peer-ratings";

test("peer rating constants", () => {
  assert.equal(PEER_RATINGS_PER_WEEK, 5);
  assert.equal(PEER_MIN_RATINGS, 3);
  assert.equal(PEER_TENURE_DAYS, 7);
});

test("fewer than 3 ratings: no result, no change", () => {
  assert.equal(peerRatingResult([]), null);
  assert.equal(peerRatingResult([5, 5]), null);
});

test("3 or more ratings: SOCIAL change is (average - 3) x 1.0, no bonus, not activity", () => {
  assert.deepEqual(peerRatingResult([5, 4, 4]), {
    count: 3,
    average: 4.3,
    delta: 1.3,
    changes: [{ domain: "SOCIAL", delta: 13 / 3 - 3, bonus: false, activity: false }],
  });
  const low = peerRatingResult([1, 2, 1, 2]);
  assert.equal(low!.average, 1.5);
  assert.equal(low!.delta, -1.5);
  assert.equal(low!.changes[0]!.delta, -1.5);
});

test("an average of exactly 3 notifies with delta 0 and changes nothing", () => {
  const r = peerRatingResult([2, 3, 4]);
  assert.deepEqual(r, { count: 3, average: 3, delta: 0, changes: [] });
});

test("tenure: joined at least 7 days before now", () => {
  const now = new Date("2026-01-20T12:00:00Z");
  assert.equal(peerTenureMet(new Date("2026-01-13T12:00:00Z"), now), true);
  assert.equal(peerTenureMet(new Date("2026-01-13T12:00:01Z"), now), false);
});
