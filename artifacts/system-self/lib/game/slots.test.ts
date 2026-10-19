import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSlot, durationsFor, missedSlotLine, missedSlotQuest, nowHHMM, slotLabel, slotStartOptions, slotStateStale } from "./slots";
import type { Quest } from "./types";

const q = (over: Partial<Quest> = {}): Quest => ({
  id: "q1",
  type: "daily",
  title: "Lift",
  description: "d",
  domain: "BODY",
  status: "active",
  expiresAt: "2026-10-19T23:59:59.000Z",
  generatedBySystem: true,
  ...over,
});
const at = (h: number, m: number) => new Date(2026, 9, 19, h, m);

test("start options step by 15 minutes across the day", () => {
  const o = slotStartOptions();
  assert.equal(o.length, 96);
  assert.deepEqual(o.slice(0, 3), ["00:00", "00:15", "00:30"]);
  assert.equal(o[95], "23:45");
});

test("buildSlot ends on the same day and within 4 hours", () => {
  assert.deepEqual(buildSlot("17:30", 60), { slotStart: "17:30", slotEnd: "18:30" });
  assert.equal(buildSlot("23:00", 90), null);
  assert.equal(buildSlot("10:00", 300), null);
  assert.deepEqual(durationsFor("22:00"), [30, 45, 60, 90]);
});

test("slotLabel and the banner line", () => {
  assert.equal(slotLabel(q({ slotStart: "17:30", slotEnd: "18:30" })), "17:30\u201318:30");
  assert.equal(slotLabel(q()), null);
  assert.equal(nowHHMM(at(9, 5)), "09:05");
  assert.equal(missedSlotLine("17:30", at(17, 42)), "You chose 17:30. It is 17:42.");
});

test("missedSlotQuest: active daily BODY with a passed slot only", () => {
  const slot = { slotStart: "17:30", slotEnd: "18:00", slotState: "open" as const };
  const computed = at(17, 40);
  assert.equal(missedSlotQuest([q(slot)], at(18, 1), computed)?.id, "q1");
  assert.equal(missedSlotQuest([q({ ...slot, slotState: "upcoming" })], at(18, 1), computed)?.id, "q1");
  assert.equal(missedSlotQuest([q(slot)], at(17, 45), computed), null);
  assert.equal(missedSlotQuest([q({ ...slot, slotState: "missed" })], at(17, 45), computed)?.id, "q1");
  // The server says "none": the device clock never invents a slot state.
  assert.equal(missedSlotQuest([q({ ...slot, slotState: "none" })], at(19, 0), computed), null);
  for (const status of ["complete", "refused", "failed"] as const) {
    assert.equal(missedSlotQuest([q({ ...slot, status })], at(19, 0), computed), null);
  }
  assert.equal(missedSlotQuest([q({ ...slot, domain: "MIND" })], at(19, 0), computed), null);
  assert.equal(missedSlotQuest([q({ ...slot, type: "weekly" })], at(19, 0), computed), null);
  assert.equal(missedSlotQuest([q()], at(19, 0), computed), null);
});

test("a cached missed state never survives a local date change", () => {
  const missed = q({ slotStart: "17:30", slotEnd: "18:00", slotState: "missed" });
  const computed = at(18, 30);
  const nextDay = new Date(2026, 9, 20, 0, 5);
  assert.equal(missedSlotQuest([missed], at(19, 0), computed)?.id, "q1");
  assert.equal(missedSlotQuest([missed], nextDay, computed), null);
  assert.equal(slotStateStale(nextDay, computed), true);
  assert.equal(slotStateStale(at(23, 59), computed), false);
});
