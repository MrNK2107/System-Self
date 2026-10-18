// Smoke: the calls the quest board makes (lib/game, lib/api outbox) against a running API.
// register + onboard -> generate -> 3 dailies + weekly + arc -> generate again (generated false) -> complete one
// (DISCIPLINE +3) -> refuse twice (second costs 1.5) -> third refusal is 409 refusal_limit -> start a chain ->
// complete step 1 -> step 2 quest exists and the chain reports currentStep 1.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/quests.ts
import assert from "node:assert/strict";
import { ApiError, createApiClient } from "../../lib/api/client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import {
  completeQuest,
  fetchChains,
  fetchGameState,
  fetchQuests,
  generateQuests,
  newClientId,
  refuseQuest,
  startChain,
} from "../../lib/game/actions";
import { toChainTemplates, toDomainScores, toQuestChains } from "../../lib/game/mappers";
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
const disciplineScore = async () => toDomainScores((await fetchGameState(api)).scores).find((d) => d.domain === "DISCIPLINE")!.score;

async function main() {
  const suffix = Date.now().toString(36);
  const user = await auth.signUp({
    email: `smoke-quests-${suffix}@example.com`,
    password: "correct horse battery",
    username: `sq_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Build an unbreakable daily routine",
      weakness: "DISCIPLINE",
      identity: "semi-public",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${suffix}`));
  step("register + onboard", { username: user.username });

  // 1. First generation: 3 dailies + weekly + arc.
  const gen1 = await generateQuests(api, outbox, newClientId("gen"));
  assert.ok(gen1.ok);
  assert.equal(gen1.value.generated, true);
  const count = (type: string) => gen1.value.active.filter((q) => q.type === type).length;
  assert.deepEqual([count("daily"), count("weekly"), count("arc")], [3, 1, 1]);
  step("generate: 3 dailies + weekly + arc", { generated: gen1.value.generated, active: gen1.value.active.length });

  // 2. Again the same day: nothing new.
  const gen2 = await generateQuests(api, outbox, newClientId("gen"));
  assert.ok(gen2.ok);
  assert.equal(gen2.value.generated, false);
  assert.equal(gen2.value.active.length, 5);
  step("generate again: generated false", { active: gen2.value.active.length });

  const board = await fetchQuests(api);
  const dailies = board.active.filter((q) => q.type === "daily");
  const weekly = board.active.find((q) => q.type === "weekly")!;

  // 3. Complete the weekly: DISCIPLINE +3.
  const before = await disciplineScore();
  const done = await completeQuest(api, outbox, weekly.id, newClientId("qc"));
  assert.ok(done.ok);
  const disc = done.value.results.find((r) => r.domain === "DISCIPLINE")!;
  assert.equal(disc.actualDelta, 3);
  const after = await disciplineScore();
  assert.equal(Math.round((after - before) * 100) / 100, 3);
  step("complete quest: DISCIPLINE +3", { before, after, actualDelta: disc.actualDelta });

  // 4. Refuse twice: first free, second 1.5. Third is refused by the server.
  const r1 = await refuseQuest(api, outbox, dailies[0]!.id, "too tired", newClientId("qr"));
  assert.ok(r1.ok);
  assert.equal(r1.value.penalty, 0);
  const r2 = await refuseQuest(api, outbox, dailies[1]!.id, undefined, newClientId("qr"));
  assert.ok(r2.ok);
  assert.equal(r2.value.penalty, 1.5);
  assert.equal(r2.value.results.find((r) => r.domain === "DISCIPLINE")!.actualDelta, -1.5);
  step("refuse twice: second costs 1.5", { first: r1.value.penalty, second: r2.value.penalty });

  await assert.rejects(
    () => refuseQuest(api, outbox, dailies[2]!.id, undefined, newClientId("qr")),
    (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === "refusal_limit",
  );
  step("third refusal: 409 refusal_limit");

  // 5. Chains: templates, start, complete step 1, step 2 appears.
  const templates = await fetchChains(api);
  assert.equal(toChainTemplates(templates).length, templates.templates.length);
  assert.ok(templates.templates.length > 0);
  assert.deepEqual(templates.active, []);
  const key = templates.templates[0]!.templateKey;
  const started = await startChain(api, outbox, key, newClientId("ch"));
  assert.ok(started.ok);
  assert.equal(started.value.chain.currentStep, 0);
  assert.equal(started.value.quest.chainStep, 0);
  await assert.rejects(
    () => startChain(api, outbox, key, newClientId("ch")),
    (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === "chain_active",
  );
  step("start chain; second start is 409 chain_active", { templateKey: key, total: started.value.chain.totalSteps });

  const step1 = await completeQuest(api, outbox, started.value.quest.id, newClientId("qc"));
  assert.ok(step1.ok);
  const next = (await fetchQuests(api)).active.find((q) => q.chainId === started.value.chain.id);
  assert.ok(next, "step 2 quest exists");
  assert.equal(next.chainStep, 1);
  const active = toQuestChains(await fetchChains(api));
  assert.equal(active.length, 1);
  assert.equal(active[0]!.currentStep, 1);
  step("complete step 1: step 2 quest exists", { chainStep: next.chainStep, progress: `${active[0]!.currentStep}/${started.value.chain.totalSteps}` });

  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
