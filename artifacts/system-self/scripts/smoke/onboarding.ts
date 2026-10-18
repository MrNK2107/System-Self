// Smoke: drives the calls the onboarding screens make (lib/onboarding, lib/auth) against a running API.
// register (bad device timezone -> retried without it) -> gate says not onboarded -> POST /onboarding with the
// payload the screens build -> replay by clientId -> GET /state -> PATCH /profile times -> GET /state reflects them.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/onboarding.ts
import assert from "node:assert/strict";
import { GameStateSchema } from "@workspace/contracts";
import { ApiError, createApiClient } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions, fetchOnboardingStatus } from "../../lib/auth/actions";
import { applyOnboarded, applyProfile, submitOnboarding, updateSchedule } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams } from "../../lib/onboarding/payload";
import { gameStateKey } from "../../lib/game/keys";
import { onboardingStatusKey } from "../../lib/auth/actions";

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

const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

async function main() {
  const suffix = Date.now().toString(36);

  // 1. Sign up with a device timezone the server rejects: only the timezone is wrong, so it retries without it.
  const user = await auth.signUp({
    email: `smoke-${suffix}@example.com`,
    password: "correct horse battery",
    username: `smoke_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "Not/AZone",
  });
  step("sign up (bad timezone retried without it)", { username: user.username, timezone: user.timezone });

  // 2. The gate sees a fresh account as not onboarded.
  assert.equal(await fetchOnboardingStatus(api), "not_onboarded");
  step("gate: not_onboarded");

  // 3. The payload the screens build: route params -> draft -> payload.
  const params = {
    ratings: JSON.stringify({ BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 8, DISCIPLINE: 3 }),
    primaryGoal: "Build an unbreakable daily routine",
    weakness: "DISCIPLINE",
    stoppedBefore: "I quit the moment I miss one day",
    identity: "semi-public",
  };
  const draft = draftFromParams(params, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  assert.ok(draft, "draft from params");
  const clientId = `smoke-onboarding-${suffix}`;
  const payload = buildOnboardingPayload(draft, clientId);
  step("payload", { ...payload, ratings: "...", primaryGoal: "..." });

  const state = await submitOnboarding(api, payload);
  assert.equal(state.profile.onboarded, true);
  assert.equal(state.profile.rank, "E");
  assert.equal(state.profile.morningTime, "07:00");
  assert.equal(state.profile.nightlyTime, "21:00");
  const social = state.scores.find((s) => s.domain === "SOCIAL");
  assert.equal(social?.score, 32); // rating 8 x 4
  assert.equal(state.scores.length, 5);
  step("POST /onboarding", { rank: state.profile.rank, social: social?.score, domains: state.scores.length });

  // 4. Replaying the same clientId (lost reply) is a replay, not a second onboarding.
  const again = await submitOnboarding(api, payload);
  assert.deepEqual(again, state);
  step("replay by clientId returns the same state");
  // A fresh attempt after the first landed (no matching clientId) reads the state back instead of failing.
  const other = await submitOnboarding(api, buildOnboardingPayload(draft, `${clientId}-other`));
  assert.equal(other.profile.onboarded, true);
  step("409 already_onboarded is read back");

  // 5. Cache seeding (what the calibrating screen does with the response).
  const cache = new Map<string, unknown>();
  const store = {
    setQueryData(key: readonly unknown[], updater: unknown) {
      const k = JSON.stringify(key);
      cache.set(k, typeof updater === "function" ? (updater as (o: unknown) => unknown)(cache.get(k)) : updater);
    },
  };
  applyOnboarded(store, user.id, state);
  assert.equal(cache.get(JSON.stringify(onboardingStatusKey(user.id))), "onboarded");
  assert.ok(cache.get(JSON.stringify(gameStateKey(user.id))));
  assert.equal(await fetchOnboardingStatus(api), "onboarded");
  step("gate: onboarded");

  // 6. GET /state matches the contract and the POST response.
  const fetched = await api.request("GET", "/api/state", { schema: GameStateSchema });
  assert.equal(fetched.profile.primaryGoal, "Build an unbreakable daily routine");
  assert.equal(fetched.profile.biggestWeakness, "DISCIPLINE");
  step("GET /state", { morningTime: fetched.profile.morningTime, nightlyTime: fetched.profile.nightlyTime });

  // 7. The schedule screen's PATCH, then GET /state reflects it.
  const profile = await updateSchedule(api, { morningTime: "05:30", nightlyTime: "22:30" });
  assert.equal(profile.morningTime, "05:30");
  assert.equal(profile.nightlyTime, "22:30");
  applyProfile(store, user.id, profile);
  const after = await api.request("GET", "/api/state", { schema: GameStateSchema });
  assert.equal(after.profile.morningTime, "05:30");
  assert.equal(after.profile.nightlyTime, "22:30");
  assert.equal((cache.get(JSON.stringify(gameStateKey(user.id))) as typeof after).profile.morningTime, "05:30");
  step("PATCH /profile then GET /state", { morningTime: after.profile.morningTime, nightlyTime: after.profile.nightlyTime });

  // 8. An invalid time is a 400 whose issues the client keeps.
  await assert.rejects(updateSchedule(api, { morningTime: "25:00", nightlyTime: "22:30" }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 400);
    assert.ok(e.issues.length > 0);
    step("PATCH /profile invalid time -> 400", e.issues[0]);
    return true;
  });
  const unchanged = await api.request("GET", "/api/state", { schema: GameStateSchema });
  assert.equal(unchanged.profile.morningTime, "05:30");

  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
