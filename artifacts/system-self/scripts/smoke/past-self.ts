// Smoke: Past You against a running API.
// register + onboard -> past-self reads DAY 1 with the baseline equal to the onboarding scores -> log a BODY
// session -> current moves, baseline stays.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/past-self.ts
import assert from "node:assert/strict";
import { localDate } from "@workspace/engine";
import { createApiClient } from "../../lib/api/client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { enqueueLog, fetchGameState, newClientId } from "../../lib/game/actions";
import { fetchPastSelf, pastSelfRows, pastSelfTitle } from "../../lib/game/progress";
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
    email: `smoke-pastself-${suffix}@example.com`,
    password: "correct horse battery",
    username: `sp_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 4, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Show up every day",
      weakness: "DISCIPLINE",
      identity: "semi-public",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${suffix}`));
  const onboarded = Object.fromEntries((await fetchGameState(api)).scores.map((s) => [s.domain, s.score]));
  step("register + onboard", { username: user.username });

  const day1 = await fetchPastSelf(api);
  assert.equal(day1.label, "DAY 1");
  assert.equal(day1.baselineDate, localDate(new Date(), "UTC"));
  assert.deepEqual(day1.baseline, onboarded);
  assert.deepEqual(day1.current, onboarded);
  assert.deepEqual(day1.gym, { sessionsTotal: 0, exercisesWithPr: 0 });
  assert.equal(pastSelfTitle(day1.label), "YOU // DAY 1");
  step("GET /api/progress/past-self reads DAY 1, baseline = onboarding scores", { baselineDate: day1.baselineDate });

  await enqueueLog(outbox, { domain: "BODY", type: "workout", note: "first session" }, newClientId("ps"));
  assert.deepEqual(await outbox.flush(), { sent: 1, remaining: 0 });
  const now = await fetchPastSelf(api);
  assert.deepEqual(now.baseline, onboarded);
  assert.ok(now.current.BODY > onboarded.BODY, "BODY moved");
  const body = pastSelfRows(now).find((r) => r.domain === "BODY")!;
  assert.equal(body.direction, "up");
  step("after a BODY log current moves, baseline stays", { delta: body.delta });
  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
