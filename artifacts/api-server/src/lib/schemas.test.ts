import test from "node:test";
import assert from "node:assert/strict";
import {
  generateQuestsBodySchema,
  generateQuestsResponseSchema,
  generateSystemMessageBodySchema,
  generateSystemMessageResponseSchema,
} from "./schemas";
import { NOTICE_KINDS, NoticeSchema } from "@workspace/contracts";

test("generateSystemMessageBodySchema accepts extended message types", () => {
  const parsed = generateSystemMessageBodySchema.parse({
    messageType: "rank_up_prep",
    rank: "B",
    domainScores: { BODY: 1, MIND: 2, WEALTH: 3, DISCIPLINE: 4 },
    trajectory: "up",
    shadowActive: true,
    shadowGap: 12,
    questCount: 3,
    completedQuestCount: 1,
    primaryGoal: "Ship app",
    dayNumber: 4,
  });

  assert.equal(parsed.messageType, "rank_up_prep");
});

test("generateQuestsBodySchema fills optional fields", () => {
  const parsed = generateQuestsBodySchema.parse({
    rank: "E",
    domainScores: { BODY: 1, MIND: 1, WEALTH: 1, DISCIPLINE: 1 },
    primaryGoal: "Consistency",
    weakestDomain: "DISCIPLINE",
  });

  assert.deepEqual(parsed.recentLogs, []);
  assert.equal(parsed.dayNumber, undefined);
});

test("generateSystemMessageResponseSchema validates metadata", () => {
  const parsed = generateSystemMessageResponseSchema.parse({
    message: "Day 8. Execute.",
    messageType: "morning_briefing",
    meta: { promptVersion: "system-message-v2", model: "gemini-1.5-flash", attempts: 1 },
  });
  assert.equal(parsed.meta.attempts, 1);
});

test("generateQuestsResponseSchema supports arc quests", () => {
  const parsed = generateQuestsResponseSchema.parse({
    quests: [
      { title: "A", description: "B", domain: "MIND", type: "daily" },
      { title: "C", description: "D", domain: "DISCIPLINE", type: "weekly" },
      { title: "E", description: "F", domain: "WEALTH", type: "arc" },
    ],
    meta: { promptVersion: "system-quests-v2", model: "gemini-1.5-flash", attempts: 2 },
  });
  assert.equal(parsed.quests[2]?.type, "arc");
});

test("NoticeSchema.kind is restricted to NOTICE_KINDS", () => {
  const base = { id: "n1", payload: {}, createdAt: "2026-01-01T00:00:00.000Z" };
  for (const kind of ["quest_failed", "streak_break", "shadow_activated", "shadow_resolved", "rank_change"]) {
    assert.ok((NOTICE_KINDS as readonly string[]).includes(kind), kind);
    assert.equal(NoticeSchema.parse({ ...base, kind }).kind, kind);
  }
  assert.throws(() => NoticeSchema.parse({ ...base, kind: "bogus" }));
});
