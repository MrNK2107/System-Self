import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, endOfLocalDay, isoWeekKey, localDate, localTimeToInstant } from "./dates";

test("localDate in Asia/Kolkata", () => {
  assert.equal(localDate(new Date("2026-10-19T18:25:00Z"), "Asia/Kolkata"), "2026-10-19");
  assert.equal(localDate(new Date("2026-10-19T18:35:00Z"), "Asia/Kolkata"), "2026-10-20");
});

test("addDays / daysBetween", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(daysBetween("2026-03-01", "2026-03-04"), 3);
  assert.equal(daysBetween("2026-03-04", "2026-03-01"), -3);
});

test("isoWeekKey", () => {
  assert.equal(isoWeekKey("2026-01-01"), "2026-W01");
  assert.equal(isoWeekKey("2027-01-01"), "2026-W53");
  assert.equal(isoWeekKey("2026-10-19"), "2026-W43");
});

test("endOfLocalDay Kolkata", () => {
  assert.equal(endOfLocalDay("2026-10-19", "Asia/Kolkata").toISOString(), "2026-10-19T18:30:00.000Z");
});

test("endOfLocalDay across DST", () => {
  // US spring forward 2026-03-08: day is 23h long
  assert.equal(endOfLocalDay("2026-03-08", "America/New_York").toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(endOfLocalDay("2026-03-07", "America/New_York").toISOString(), "2026-03-08T05:00:00.000Z");
  // fall back 2026-11-01
  assert.equal(endOfLocalDay("2026-11-01", "America/New_York").toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(endOfLocalDay("2026-10-31", "America/New_York").toISOString(), "2026-11-01T04:00:00.000Z");
  // Sydney spring forward 2026-10-04
  assert.equal(endOfLocalDay("2026-10-04", "Australia/Sydney").toISOString(), "2026-10-04T13:00:00.000Z");
});

test("endOfLocalDay when midnight does not exist (Sao Paulo-style gap) lands on first valid instant", () => {
  // Asia/Beirut springs forward at 00:00 -> 01:00 on 2026-03-29; local midnight does not exist.
  const end = endOfLocalDay("2026-03-28", "Asia/Beirut");
  assert.equal(localDate(end, "Asia/Beirut"), "2026-03-29");
  assert.equal(localDate(new Date(end.getTime() - 1), "Asia/Beirut"), "2026-03-28");
});

test("localTimeToInstant follows the wall clock across DST", () => {
  assert.equal(localTimeToInstant("2026-10-19", 21, 30, "Asia/Kolkata").toISOString(), "2026-10-19T16:00:00.000Z");
  // New York: EST (UTC-5) the day before spring-forward, EDT (UTC-4) the day of.
  assert.equal(localTimeToInstant("2026-03-07", 21, 0, "America/New_York").toISOString(), "2026-03-08T02:00:00.000Z");
  assert.equal(localTimeToInstant("2026-03-08", 21, 0, "America/New_York").toISOString(), "2026-03-09T01:00:00.000Z");
  assert.equal(localTimeToInstant("2026-03-08", 0, 0, "America/New_York").toISOString(), "2026-03-08T05:00:00.000Z");
});
