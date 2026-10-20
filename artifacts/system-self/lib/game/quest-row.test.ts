import assert from "node:assert/strict";
import { test } from "node:test";
import { dueClock, dueIn, questMeta, shadowGapLine } from "./quest-row";
import type { Quest } from "./types";

const now = new Date(2026, 9, 20, 18, 0);
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 9, 20 + dayOffset, h, m).toISOString();

const quest: Quest = {
  id: "q1",
  type: "daily",
  title: "Home session",
  description: "25 minutes.",
  domain: "BODY",
  status: "active",
  expiresAt: at(21),
  generatedBySystem: true,
};

test("dueIn is urgent under 3 hours", () => {
  assert.deepEqual(dueIn(at(20), now), { label: "2h", urgent: true });
  assert.deepEqual(dueIn(at(18, 30), now), { label: "30m", urgent: true });
  assert.deepEqual(dueIn(at(22), now), { label: "4h", urgent: false });
  assert.deepEqual(dueIn(at(18, 0, 5), now), { label: "5d", urgent: false });
  assert.deepEqual(dueIn(at(17), now), { label: "due", urgent: true });
  assert.equal(dueIn("nope", now), null);
});

test("dueClock is local HH:MM", () => {
  assert.equal(dueClock(at(21, 5)), "21:05");
  assert.equal(dueClock("nope"), null);
});

test("questMeta is one short line", () => {
  assert.equal(questMeta(quest), "BODY · due 21:00");
  assert.equal(questMeta({ ...quest, slotStart: "18:00", slotEnd: "19:00" }), "BODY · slot 18:00–19:00 · due 21:00");
  assert.equal(questMeta({ ...quest, type: "weekly" }), "Weekly · BODY");
  assert.equal(questMeta({ ...quest, bonus: true }), "BODY · bonus, no rank effect · due 21:00");
  assert.equal(questMeta({ ...quest, type: "arc", chainStep: 1, chainTotal: 5 }), "Arc · BODY · step 2 of 5");
  assert.equal(questMeta({ ...quest, status: "complete" }), "BODY · done");
  assert.equal(questMeta({ ...quest, status: "failed" }), "BODY · missed");
});

test("shadowGapLine hides a zero gap and explains the rest", () => {
  assert.equal(shadowGapLine(0), null);
  assert.equal(shadowGapLine(-3), null);
  assert.equal(shadowGapLine(4.2), "Your Shadow is 4.2 points ahead of you. Finish quests to close the gap.");
  assert.match(shadowGapLine(12)!, /leans toward DISCIPLINE/);
  assert.match(shadowGapLine(25)!, /escalated/);
});
