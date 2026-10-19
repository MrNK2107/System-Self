// Smoke: Lock the Slot against a running API.
// register + onboard -> generate -> set a slot on a BODY quest -> GET /api/quests shows slotState -> clear the slot ->
// a slot with end before start is a 400.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/slots.ts
import assert from "node:assert/strict";
import { createApiClient } from "../../lib/api/client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { ApiError } from "../../lib/api/client";
import { fetchQuests, generateQuests, newClientId, setQuestSlot } from "../../lib/game/actions";
import { toHHMM } from "../../lib/game/slots";
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
    email: `smoke-slots-${suffix}@example.com`,
    password: "correct horse battery",
    username: `ss_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 1, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Show up at the time I chose",
      weakness: "BODY",
      identity: "semi-public",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${suffix}`));
  step("register + onboard", { username: user.username });

  const gen = await generateQuests(api, outbox, newClientId("gen"));
  assert.ok(gen.ok);
  const body = (await fetchQuests(api)).active.find((q) => q.domain === "BODY");
  assert.ok(body, "a BODY quest exists (weakest domain is BODY)");
  assert.equal(body.slotState, "none");
  step("generate", { quest: body.title });

  // The server clock is UTC here (the user's timezone): aim the window at "missed" when the day allows it.
  const now = new Date();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const past = mins >= 30;
  const window = past
    ? { slotStart: toHHMM(mins - 30), slotEnd: toHHMM(mins - 10) }
    : { slotStart: toHHMM(mins + 10), slotEnd: toHHMM(mins + 30) };
  const set = await setQuestSlot(api, outbox, body.id, window, newClientId("slot"));
  assert.ok(set.ok);
  assert.equal(set.value.quest.slotStart, window.slotStart);
  assert.equal(set.value.quest.slotEnd, window.slotEnd);
  step("set slot", window);

  const listed = (await fetchQuests(api)).active.find((q) => q.id === body.id)!;
  assert.equal(listed.slotStart, window.slotStart);
  assert.equal(listed.slotState, past ? "missed" : "upcoming");
  step("GET quests shows slotState", { slotState: listed.slotState });

  const cleared = await setQuestSlot(api, outbox, body.id, null, newClientId("slot"));
  assert.ok(cleared.ok);
  assert.equal(cleared.value.quest.slotStart, null);
  const after = (await fetchQuests(api)).active.find((q) => q.id === body.id)!;
  assert.equal(after.slotState, "none");
  step("clear slot");

  await assert.rejects(
    () => setQuestSlot(api, outbox, body.id, { slotStart: "18:30", slotEnd: "17:30" }, newClientId("slot")),
    (e: unknown) => e instanceof ApiError && e.status === 400,
  );
  step("end before start -> 400");

  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
