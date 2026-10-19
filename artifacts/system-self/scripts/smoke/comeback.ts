// Smoke: home-first dungeons and the redemption arc against a running API.
// register + onboard -> GET /api/comeback is idle -> home path on -> 6 home_session logs on one day count once, so no
// gym_unlocked notice and the home path stays on -> notice kinds filtering works. A real comeback needs 5 empty days and
// the unlock 6 separate days, so both are covered by the server tests with injected clocks.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/comeback.ts
import assert from "node:assert/strict";
import { z } from "zod";
import { createApiClient } from "../../lib/api/client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { enqueueLog, fetchComeback, fetchGameState, fetchNotices, newClientId, setHomePath } from "../../lib/game/actions";
import { NOTICE_KINDS_PARAM, parseNotices } from "../../lib/game/notices";
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

const LooseList = z.object({ items: z.array(z.object({ kind: z.string() }).passthrough()), hasMore: z.boolean() });

async function main() {
  const suffix = Date.now().toString(36);
  const user = await auth.signUp({
    email: `smoke-comeback-${suffix}@example.com`,
    password: "correct horse battery",
    username: `sc_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 2, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Train again after a long break",
      weakness: "BODY",
      identity: "semi-public",
    },
    "UTC",
  );
  assert.ok(draft);
  const onboarded = await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${suffix}`));
  assert.equal(onboarded.profile.homePathActive, false);
  step("register + onboard", { username: user.username });

  // A brand-new user has no comeback; the first log below is not one either.
  assert.deepEqual(await fetchComeback(api), { active: null, returnerCount: 0 });
  step("GET /api/comeback idle", { active: null, returnerCount: 0 });

  const on = await setHomePath(api, outbox, true, newClientId("hp"));
  assert.ok(on.ok && on.value.homePathActive === true);
  assert.equal((await fetchGameState(api)).profile.homePathActive, true);
  step("home path on");

  for (let i = 0; i < 6; i++) {
    await enqueueLog(outbox, { domain: "BODY", type: "home_session", note: `home ${i + 1}` }, newClientId("home"));
    assert.deepEqual(await outbox.flush(), { sent: 1, remaining: 0 });
  }
  step("6 home_session logs, one day");

  const state = await fetchGameState(api);
  assert.equal(state.profile.homePathActive, true, "home sessions count once a day: six in one day do not clear Tier I");
  const unlocked = parseNotices((await fetchNotices(api)).items).notices.filter((n) => n.kind === "gym_unlocked");
  assert.equal(unlocked.length, 0);
  step("no gym_unlocked notice", { homePathActive: true });
  assert.deepEqual(await fetchComeback(api), { active: null, returnerCount: 0 });

  // Kinds filtering: only the requested kinds come back and page.
  const present = [...new Set((await api.request("GET", "/api/notices", { schema: LooseList })).items.map((n) => n.kind))];
  assert.ok(present.length > 0, "the logs above left at least one notice");
  const kind = present[0]!;
  const only = await api.request("GET", `/api/notices?kinds=${kind}`, { schema: LooseList });
  assert.deepEqual([...new Set(only.items.map((n) => n.kind))], [kind]);
  const others = ["milestone", "rank_change", "gym_unlocked"].filter((k) => k !== kind);
  const without = await api.request("GET", `/api/notices?kinds=${others.join(",")}`, { schema: LooseList });
  assert.ok(without.items.every((n) => others.includes(n.kind)));
  assert.ok(!without.items.some((n) => n.kind === kind));
  const none = await api.request("GET", "/api/notices?kinds=from_the_future", { schema: LooseList });
  assert.deepEqual(none, { items: [], hasMore: false });
  const stateKinds = await api.request("GET", `/api/state?noticeKinds=${kind}`, {
    schema: z.object({ unseenNotices: z.array(z.object({ kind: z.string() }).passthrough()) }).passthrough(),
  });
  assert.deepEqual([...new Set(stateKinds.unseenNotices.map((n) => n.kind))], [kind]);
  const all = await fetchNotices(api);
  assert.ok(all.items.length >= only.items.length);
  step("notice kinds filtering", { sent: NOTICE_KINDS_PARAM.split(",").length });
  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
