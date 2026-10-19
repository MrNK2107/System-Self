// Smoke: deferral ledger, floor quest and shadow takeover against a running API.
// register + onboard -> generate -> refuse a BODY quest with a reason -> floor + shadowTook returned -> the
// deferrals endpoint lists the reason -> enqueue + flush a floor_session log -> BODY +2.5 -> refuse a MIND quest ->
// floor null, no takeover.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/deferral.ts
import assert from "node:assert/strict";
import { createApiClient } from "../../lib/api/client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { enqueueLog, fetchGameState, fetchQuests, generateQuests, newClientId, refuseQuest } from "../../lib/game/actions";
import { fetchDeferrals, fetchShadowTakeovers, floorLogInput, ledgerLine } from "../../lib/game/adherence";
import { toDomainScores } from "../../lib/game/mappers";
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
const bodyScore = async () => toDomainScores((await fetchGameState(api)).scores).find((d) => d.domain === "BODY")!.score;

async function main() {
  const suffix = Date.now().toString(36);
  const user = await auth.signUp({
    email: `smoke-deferral-${suffix}@example.com`,
    password: "correct horse battery",
    username: `sd_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 1, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Stop saying tomorrow",
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
  const board = (await fetchQuests(api)).active.filter((q) => q.type === "daily");
  const bodyQuest = board.find((q) => q.domain === "BODY");
  const otherQuest = board.find((q) => q.domain !== "BODY");
  assert.ok(bodyQuest, "a BODY daily exists (weakest domain is BODY)");
  assert.ok(otherQuest, "a non-BODY daily exists");
  step("generate", { daily: board.length });

  // 1. Refuse a BODY quest with a reason: floor + shadowTook.
  const r1 = await refuseQuest(api, outbox, bodyQuest.id, "  too tired  ", newClientId("qr"));
  assert.ok(r1.ok);
  assert.equal(r1.value.quest.refusalReason, "too tired");
  assert.ok(r1.value.floor, "floor offered");
  assert.ok(r1.value.floor.minutes >= 8 && r1.value.floor.minutes <= 15);
  assert.deepEqual(r1.value.shadowTook, { questTitle: bodyQuest.title });
  step("refuse BODY: floor + shadowTook", { floor: r1.value.floor.id, minutes: r1.value.floor.minutes });

  // 2. The ledger and the takeover tally.
  const ledger = await fetchDeferrals(api, 30);
  assert.equal(ledger.countThisWeek, 1);
  assert.equal(ledger.items[0]!.reason, "too tired");
  const tally = await fetchShadowTakeovers(api);
  assert.equal(tally.count, 1);
  assert.equal(tally.items[0]!.questTitle, bodyQuest.title);
  step("deferrals lists the reason", { line: ledgerLine(ledger.items[0]!) });

  // 3. The floor session: an ordinary BODY log through the outbox.
  const before = await bodyScore();
  await enqueueLog(outbox, floorLogInput(r1.value.floor, bodyQuest.id), newClientId("floor")); // from the refusal offer
  assert.deepEqual(await outbox.flush(), { sent: 1, remaining: 0 });
  const after = await bodyScore();
  assert.equal(Math.round((after - before) * 100) / 100, 2.5);
  step("floor_session log: BODY +2.5", { before, after });

  // 4. A non-BODY refusal: no floor, no takeover; the reason is still stored.
  const r2 = await refuseQuest(api, outbox, otherQuest.id, "exams", newClientId("qr"));
  assert.ok(r2.ok);
  assert.equal(r2.value.floor, null);
  assert.equal(r2.value.shadowTook, null);
  assert.equal((await fetchShadowTakeovers(api)).count, 1);
  assert.equal((await fetchDeferrals(api, 30)).items[0]!.reason, "exams");
  step("refuse non-BODY: floor null, reason stored", { domain: otherQuest.domain });

  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
