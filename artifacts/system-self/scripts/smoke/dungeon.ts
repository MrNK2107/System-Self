// Smoke: Dungeon Briefing and Scout Reports against a running API.
// register + onboard -> briefing today (plan or beginner) with fallbacks -> 3 crowd reports -> quiet-hours suggestions.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/dungeon.ts
import assert from "node:assert/strict";
import { createApiClient } from "../../lib/api/client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { newClientId } from "../../lib/game/actions";
import { briefingHeader, fallbackLine, fetchBriefing, fetchQuietHours, quietChips, quietHint, submitCrowdReport } from "../../lib/game/dungeon";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams } from "../../lib/onboarding/payload";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required");
  process.exit(2);
}

let stored: Session | null = null;
const tokens: TokenStore = {
  get: async () => stored,
  set: async (s) => {
    stored = s;
  },
};
const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl, onSessionExpired: () => {} });
const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });

const memoryStorage = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
};
const outbox = createOutbox({
  storage: memoryStorage(),
  getUserId: async () => stored?.user.id ?? null,
  send: async (item: OutboxItem) => {
    await api.request(item.method, item.path, { body: item.body, idempotencyKey: item.clientId });
  },
});

const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

async function main() {
  const suffix = Date.now().toString(36);
  const user = await auth.signUp({
    email: `smoke-dungeon-${suffix}@example.com`,
    password: "correct horse battery",
    username: `sd_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 1, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Walk in knowing the route",
      weakness: "BODY",
      identity: "semi-public",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${suffix}`));
  step("register + onboard", { username: user.username });

  const today = await fetchBriefing(api);
  assert.ok(["plan", "beginner"].includes(today.source));
  assert.ok(today.blocks.length >= 3);
  for (const b of today.blocks) {
    assert.ok(b.howTo.length > 0, `howTo for ${b.exerciseId}`);
    assert.ok(fallbackLine(b), `fallback line for ${b.exerciseId}`);
  }
  assert.ok(today.estimatedMinutes > 0);
  step("briefing today", { header: briefingHeader(today.date), source: today.source, minutes: today.estimatedMinutes, first: `${today.blocks[0]!.name}: ${fallbackLine(today.blocks[0]!)}` });

  // 2026-10-19 is a Monday (plan day for the default plan), 2026-10-20 a Tuesday (beginner day).
  const mon = await fetchBriefing(api, "2026-10-19");
  const tue = await fetchBriefing(api, "2026-10-20");
  assert.equal(mon.source, "plan");
  assert.equal(tue.source, "beginner");
  step("MON plan / TUE beginner", { mon: mon.blocks.length, tue: tue.blocks.length });

  const before = await fetchQuietHours(api);
  assert.deepEqual(before, { suggestions: [], needed: 3 });
  step("quiet hours before reports", { hint: quietHint(before) });

  for (const level of ["quiet", "quiet", "packed"] as const) {
    const r = await submitCrowdReport(api, outbox, level, undefined, newClientId("crowd"));
    assert.ok(r.ok);
  }
  step("3 crowd reports");

  const after = await fetchQuietHours(api);
  assert.equal(after.needed, 0);
  assert.ok(after.suggestions.length >= 1, "suggestions after 3 reports");
  assert.ok(after.suggestions.length <= 3);
  step("quiet hours after reports", { chips: quietChips(after.suggestions, new Date().getDay()) });
  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
