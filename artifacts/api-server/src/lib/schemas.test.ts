import test from "node:test";
import assert from "node:assert/strict";
import { generateQuestsBodySchema, generateSystemMessageBodySchema } from "./schemas";

test("generateSystemMessageBodySchema accepts extended message types", () => {
  const parsed = generateSystemMessageBodySchema.parse({
    messageType: "rank_up_prep",
    username: "nanda",
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
    username: "nanda",
    rank: "E",
    domainScores: { BODY: 1, MIND: 1, WEALTH: 1, DISCIPLINE: 1 },
    primaryGoal: "Consistency",
    weakestDomain: "DISCIPLINE",
  });

  assert.deepEqual(parsed.recentLogs, []);
  assert.equal(parsed.dayNumber, undefined);
});
