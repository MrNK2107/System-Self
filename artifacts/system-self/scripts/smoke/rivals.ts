// Smoke: server rivals against a running API.
// register + onboard -> GET /api/rivals: 3 ghost rivals at rank E (cold start), shown by codename, SIM-flagged ->
// declare a rival challenge -> a second open one on the same rival is 409 challenge_open -> acknowledging an open
// challenge is 409 -> one transmission per rival per day (second one 429 taunt_limit) -> mark read ->
// the game state carries the user's own public codename.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/rivals.ts
import assert from "node:assert/strict";
import { createApiClient, ApiError, type ApiClient } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { fetchGameState, newClientId } from "../../lib/game/actions";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams, type IdentitySetting } from "../../lib/onboarding/payload";
import { ackRivalChallenge, declareRivalChallenge, fetchRivals, markTauntsRead, tauntRival } from "../../lib/social/rivals";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required");
  process.exit(2);
}

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
    email: `smoke-rivals-${prefix}-${label}@example.com`,
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
  const me = await makePlayer(prefix, "r", "semi-public");
  step("register + onboard", { prefix });

  const state = await fetchGameState(me.api);
  assert.match(state.profile.publicCodename, /^USER \/\/ [A-Z]+(-[A-Z]+)?-[1-9]$/);
  step("game state carries the own public codename", { codename: state.profile.publicCodename });

  const rivals = await fetchRivals(me.api);
  assert.equal(rivals.rivals.length, 3);
  for (const r of rivals.rivals) {
    assert.equal(r.isGhost, true);
    assert.equal(r.profile.rank, "E");
    assert.equal(r.profile.handle, r.codename);
    assert.match(r.codename, /^RIVAL \/\/ /);
    assert.equal(Object.keys(r.profile.scores ?? {}).length, 5);
  }
  assert.ok(!/hidden/i.test(JSON.stringify(rivals)), "no hidden score anywhere");
  assert.deepEqual((await fetchRivals(me.api)).rivals.map((r) => r.assignmentId), rivals.rivals.map((r) => r.assignmentId));
  step("3 ghost rivals at rank E, stable across reads", { codenames: rivals.rivals.map((r) => r.codename) });

  const target = rivals.rivals[0]!;
  const declared = await declareRivalChallenge(me.api, synced, target.assignmentId, "MIND", newClientId("ch"));
  assert.ok(declared.ok);
  assert.equal(declared.value.outcome, null);
  assert.equal(declared.value.codename, target.codename);
  await rejectedWith(() => declareRivalChallenge(me.api, synced, target.assignmentId, "BODY", newClientId("ch")), 409, "challenge_open");
  step("declare a 7-day MIND challenge; a second open one -> 409", { start: declared.value.startDate, end: declared.value.endDate });

  await rejectedWith(() => ackRivalChallenge(me.api, synced, declared.value.id, newClientId("ack")), 409, "challenge_open");
  const listed = await fetchRivals(me.api);
  assert.equal(listed.challenges.filter((c) => c.outcome === null).length, 1);
  step("acknowledging a running challenge -> 409; it is listed as open");

  const taunt = await tauntRival(me.api, synced, target.assignmentId, newClientId("t"));
  assert.ok(taunt.ok);
  assert.ok(taunt.value.message.length > 0);
  assert.equal(taunt.value.codename, target.codename);
  await rejectedWith(() => tauntRival(me.api, synced, target.assignmentId, newClientId("t")), 429, "taunt_limit");
  step("one transmission per rival per day; the second -> 429", { message: taunt.value.message });

  assert.ok((await markTauntsRead(me.api, synced, newClientId("read"))).ok);
  const after = await fetchRivals(me.api);
  assert.equal(after.taunts.length, 1);
  assert.equal(after.taunts[0]!.read, true);
  step("transmissions marked read");

  console.log("SMOKE rivals PASSED");
}

main().catch((err) => {
  console.error("SMOKE rivals FAILED", err);
  process.exit(1);
});
