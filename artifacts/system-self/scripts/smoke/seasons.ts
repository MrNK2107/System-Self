// Smoke: life context and season modes against a running API.
// register + onboard with lifeContext -> schedule an exam season starting tomorrow -> GET shows it scheduled ->
// an overlapping season is 409 -> delete it (204) -> a kind the context does not allow is 400 -> state carries
// lifeContext and no running season.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/seasons.ts
import assert from "node:assert/strict";
import { addDays, localDate } from "@workspace/engine";
import { createApiClient, ApiError } from "../../lib/api/client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { fetchGameState, newClientId } from "../../lib/game/actions";
import { cancelSeason, fetchSeasons, scheduleSeason } from "../../lib/game/life";
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

async function rejectedWith(run: () => Promise<unknown>, status: number, code: string) {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof ApiError, "an ApiError was expected");
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    return;
  }
  assert.fail(`expected ${status} ${code}`);
}

async function main() {
  const suffix = Date.now().toString(36);
  const user = await auth.signUp({
    email: `smoke-seasons-${suffix}@example.com`,
    password: "correct horse battery",
    username: `ss_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 4, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Pass my exams and keep training",
      weakness: "MIND",
      identity: "semi-public",
      lifeContext: "student",
    },
    "UTC",
  );
  assert.ok(draft);
  const onboarded = await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${suffix}`));
  assert.equal(onboarded.profile.lifeContext, "student");
  assert.equal(onboarded.profile.season, null);
  step("register + onboard with lifeContext", { username: user.username, lifeContext: onboarded.profile.lifeContext });

  const tomorrow = addDays(localDate(new Date(), "UTC"), 1);
  const created = await scheduleSeason(api, outbox, { kind: "exam", startsOn: tomorrow, lengthDays: 5 }, newClientId("season"));
  assert.ok(created.ok);
  assert.equal(created.value.endsOn, addDays(tomorrow, 4));
  step("POST /api/seasons exam from tomorrow", { id: created.value.id, endsOn: created.value.endsOn });

  const got = await fetchSeasons(api);
  assert.equal(got.active, null);
  assert.equal(got.scheduled?.id, created.value.id);
  assert.deepEqual(got.availableKinds, ["exam", "away"]);
  assert.equal(got.earliestStart, addDays(created.value.endsOn, 8)); // cooldown after the scheduled season
  step("GET /api/seasons shows it scheduled", { availableKinds: got.availableKinds });

  await rejectedWith(
    () => scheduleSeason(api, outbox, { kind: "away", startsOn: addDays(tomorrow, 2), lengthDays: 2 }, newClientId("season")),
    409,
    "season_conflict",
  );
  step("overlapping season -> 409 season_conflict");

  const del = await cancelSeason(api, outbox, created.value.id, newClientId("season-cancel"));
  assert.ok(del.ok);
  assert.equal((await fetchSeasons(api)).scheduled, null);
  step("DELETE /api/seasons/:id -> 204, nothing scheduled");

  await rejectedWith(
    () => scheduleSeason(api, outbox, { kind: "crunch", startsOn: tomorrow, lengthDays: 3 }, newClientId("season")),
    400,
    "invalid_kind",
  );
  step("crunch for a student -> 400 invalid_kind");

  const state = await fetchGameState(api);
  assert.equal(state.profile.lifeContext, "student");
  assert.equal(state.profile.season, null);
  step("GameState.profile carries lifeContext, no running season");
  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
