import test from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_TYPES,
  generateQuestsResponseSchema,
  generatedQuestsPayloadSchema,
  systemMessageRequestSchema,
  systemMessageResponseSchema,
} from "./schemas";
import { NOTICE_KINDS, NoticeSchema } from "@workspace/contracts";

test("systemMessageRequestSchema accepts every message type and bounds extraContext", () => {
  assert.equal(MESSAGE_TYPES.length, 15);
  for (const type of MESSAGE_TYPES) assert.equal(systemMessageRequestSchema.parse({ type }).type, type);
  assert.equal(systemMessageRequestSchema.parse({ type: "milestone", extraContext: "x".repeat(500) }).type, "milestone");
  assert.throws(() => systemMessageRequestSchema.parse({ type: "milestone", extraContext: "x".repeat(501) }));
  assert.throws(() => systemMessageRequestSchema.parse({ type: "bogus" }));
});

test("systemMessageResponseSchema validates metadata", () => {
  const parsed = systemMessageResponseSchema.parse({
    message: "Day 8. Execute.",
    meta: { promptVersion: "system-message-v3", model: "gemini-1.5-flash", attempts: 1 },
  });
  assert.equal(parsed.meta.attempts, 1);
});

test("generateQuestsResponseSchema supports arc quests and SOCIAL", () => {
  const parsed = generateQuestsResponseSchema.parse({
    quests: [
      { title: "A", description: "B", domain: "SOCIAL", type: "daily" },
      { title: "C", description: "D", domain: "DISCIPLINE", type: "weekly" },
      { title: "E", description: "F", domain: "WEALTH", type: "arc" },
    ],
    meta: { promptVersion: "system-quests-v4", model: "gemini-1.5-flash", attempts: 2 },
  });
  assert.equal(parsed.quests[2]?.type, "arc");
});

test("generatedQuestsPayloadSchema rejects unknown domains and empty boards", () => {
  assert.throws(() => generatedQuestsPayloadSchema.parse({ quests: [] }));
  assert.throws(() =>
    generatedQuestsPayloadSchema.parse({ quests: [{ title: "A", description: "B", domain: "CUSTOM", type: "daily" }] }),
  );
});

test("NoticeSchema is a union by kind with the exact payload the server writes for every kind", () => {
  const base = { id: "n1", createdAt: "2026-01-01T00:00:00.000Z" };
  const payloads: Record<(typeof NOTICE_KINDS)[number], unknown> = {
    achievement: { id: "first_log", title: "T", description: "D", icon: "zap" },
    milestone: { domain: "BODY", tier: 60, title: "T" },
    rank_change: { from: "E", to: "D", kind: "promotion", newCodename: "VECTOR // AB1-2" },
    chain_complete: { name: "PHYSICAL PROTOCOL", templateKey: "physical_protocol" },
    quest_failed: { questId: "q1", title: "Q", type: "daily", penalty: 0.8 },
    streak_break: { domains: [{ domain: "BODY", lostStreak: 3 }], penalty: 2 },
    shadow_activated: { gap: 12, codename: "SHADOW // ALICE_1" },
    shadow_resolved: { codename: "SHADOW // ALICE_1" },
  };
  for (const kind of NOTICE_KINDS) {
    assert.equal(NoticeSchema.parse({ ...base, kind, payload: payloads[kind] }).kind, kind);
    assert.throws(() => NoticeSchema.parse({ ...base, kind, payload: {} }), kind);
  }
  // A payload of another kind does not pass.
  assert.throws(() => NoticeSchema.parse({ ...base, kind: "rank_change", payload: payloads.milestone }));
  assert.throws(() => NoticeSchema.parse({ ...base, kind: "bogus", payload: {} }));
});
