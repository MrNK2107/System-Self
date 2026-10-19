import test from "node:test";
import assert from "node:assert/strict";
import { slotStateOf } from "./quests";

const KOL = "Asia/Kolkata"; // UTC+05:30, no DST
const slot = { slotStart: "17:30", slotEnd: "18:30" };
// 2026-10-19 17:30 IST = 12:00Z; 18:30 IST = 13:00Z.
const start = Date.parse("2026-10-19T12:00:00.000Z");
const end = Date.parse("2026-10-19T13:00:00.000Z");
const state = (ms: number, s: { slotStart: string | null; slotEnd: string | null } = slot, tz = KOL) => slotStateOf(s, new Date(ms), tz);

test("slotStateOf: none without a full slot", () => {
  assert.equal(state(start, { slotStart: null, slotEnd: null }), "none");
  assert.equal(state(start, { slotStart: "17:30", slotEnd: null }), "none");
});

test("slotStateOf: boundaries are inclusive of start and end, missed 1 ms after end", () => {
  assert.equal(state(start - 1), "upcoming");
  assert.equal(state(start), "open");
  assert.equal(state(start + 30 * 60_000), "open");
  assert.equal(state(end), "open");
  assert.equal(state(end + 1), "missed");
});

test("slotStateOf: uses the user's local date when it differs from the UTC date", () => {
  // 2026-10-19T19:00Z is 2026-10-20 00:30 IST: the UTC date is the 19th, the local date the 20th.
  const now = Date.parse("2026-10-19T19:00:00.000Z");
  assert.equal(state(now, { slotStart: "00:15", slotEnd: "00:45" }), "open");
  assert.equal(state(now, { slotStart: "00:00", slotEnd: "00:15" }), "missed");
  assert.equal(state(now, { slotStart: "00:45", slotEnd: "01:30" }), "upcoming");
  // 18:30Z is exactly 00:00 IST on the 20th.
  assert.equal(state(Date.parse("2026-10-19T18:30:00.000Z"), { slotStart: "00:00", slotEnd: "00:30" }), "open");
  // The late-evening IST slot of the 19th is still "today" at 23:59 IST (18:29Z).
  assert.equal(state(Date.parse("2026-10-19T18:29:00.000Z"), { slotStart: "23:00", slotEnd: "23:30" }), "missed");
});

test("slotStateOf: a negative-offset zone across the UTC date", () => {
  // 2026-10-20T02:00Z is 2026-10-19 22:00 in New York (EDT, UTC-4).
  const now = Date.parse("2026-10-20T02:00:00.000Z");
  assert.equal(state(now, { slotStart: "21:30", slotEnd: "22:30" }, "America/New_York"), "open");
  assert.equal(state(now, { slotStart: "22:30", slotEnd: "23:00" }, "America/New_York"), "upcoming");
});
