// Smoke: identity projection, search, follow, block and report against a running API.
// register + onboard four users (viewer semi-public, one public, one semi-public, one anonymous) ->
// search finds the public + semi-public users (by username / codename), never the anonymous one ->
// follow both -> following list is the projection (no scores, no usernames of non-public users) ->
// block one -> following it again is 403 -> report the anonymous user by codename -> 201.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/social.ts
// (the register limiter allows 10 per 15 min per IP: restart the API between runs if you see 429)
import assert from "node:assert/strict";
import { createApiClient, ApiError, type ApiClient } from "../../lib/api/client";
import type { KeyValueStorage } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { newClientId } from "../../lib/game/actions";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams, type IdentitySetting } from "../../lib/onboarding/payload";
import {
  blockPlayer,
  fetchFollowersCount,
  fetchFollowing,
  fetchSocialProfile,
  followPlayer,
  reportPlayer,
  searchPlayers,
} from "../../lib/social/social";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required");
  process.exit(2);
}

const memoryStorage = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
};
const synced = { flushBeforeMutation: async () => true };
const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

interface Player {
  api: ApiClient;
  username: string;
  identity: IdentitySetting;
}

async function makePlayer(prefix: string, label: string, identity: IdentitySetting): Promise<Player> {
  let stored: Session | null = null;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl: baseUrl!, onSessionExpired: () => {} });
  const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });
  const username = `${prefix}_${label}`;
  await auth.signUp({
    email: `smoke-social-${prefix}-${label}@example.com`,
    password: "correct horse battery",
    username,
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 4, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Build a disciplined life",
      weakness: "MIND",
      identity,
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${prefix}-${label}`));
  return { api, username, identity };
}

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
  const prefix = `sm${Date.now().toString(36).slice(-6)}`;
  const viewer = await makePlayer(prefix, "v", "semi-public");
  const pub = await makePlayer(prefix, "p", "public");
  const semi = await makePlayer(prefix, "s", "semi-public");
  const anon = await makePlayer(prefix, "a", "anonymous");
  step("register + onboard 4 users", { prefix });

  const found = await searchPlayers(viewer.api, prefix);
  const handles = found.map((p) => p.handle);
  assert.equal(found.length, 2, `expected 2 results, got ${JSON.stringify(handles)}`);
  assert.ok(handles.includes(pub.username), "the public user is found by username");
  const semiResult = found.find((p) => p.handle !== pub.username)!;
  assert.equal(semiResult.isCodename, true);
  assert.match(semiResult.handle, /^USER \/\/ [A-Z]+-[1-9]$/);
  assert.ok(!JSON.stringify(found).includes(semi.username), "the semi-public username is not shown");
  assert.ok(!JSON.stringify(found).includes(anon.username), "the anonymous user is not searchable");
  for (const p of found) assert.equal("scores" in p, false);
  step("search finds public + semi-public, not anonymous", { handles });

  assert.deepEqual(await searchPlayers(viewer.api, `${prefix}_a`), []);
  step("anonymous username search is empty");

  assert.ok((await followPlayer(viewer.api, synced, pub.username, newClientId("f"))).ok);
  assert.ok((await followPlayer(viewer.api, synced, semiResult.handle, newClientId("f"))).ok);
  await rejectedWith(() => followPlayer(viewer.api, synced, anon.username, newClientId("f")), 404, "not_found");
  step("follow public (username) and semi-public (codename); anonymous -> 404");

  const following = await fetchFollowing(viewer.api);
  assert.equal(following.length, 2);
  for (const p of following) {
    assert.deepEqual(Object.keys(p).sort(), ["handle", "isCodename", "rank", "shadowActive", "trajectory"]);
  }
  assert.ok(!JSON.stringify(following).includes(semi.username));
  assert.equal(await fetchFollowersCount(pub.api), 1);
  const view = await fetchSocialProfile(viewer.api, semiResult.handle);
  assert.equal(view.following, true);
  assert.equal(view.profile.handle, semiResult.handle);
  step("following list is the follower projection", { following: following.map((p) => p.handle) });

  assert.ok((await blockPlayer(viewer.api, synced, semiResult.handle, newClientId("b"))).ok);
  assert.equal((await fetchFollowing(viewer.api)).length, 1);
  await rejectedWith(() => followPlayer(viewer.api, synced, semiResult.handle, newClientId("f")), 403, "blocked");
  step("block -> follows removed, follow blocked user -> 403 blocked");

  // Anonymous users are only ever known by codename (which a viewer gets from a projection), so the report
  // goes to the blocked semi-public user by the codename the search showed.
  const report = await reportPlayer(viewer.api, synced, semiResult.handle, "Smoke report", newClientId("r"));
  assert.ok(report.ok);
  assert.match(report.value.id, /^[0-9a-f-]{36}$/);
  step("report by codename -> 201", { id: report.value.id });
  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
