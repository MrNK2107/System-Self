import assert from "node:assert/strict";
import { test } from "node:test";
import { OnboardingRequestSchema, type GameState } from "@workspace/contracts";
import { ApiError, createApiClient } from "../api/client";
import type { Session, TokenStore } from "../api/session";
import { gameStateKey } from "../game/keys";
import { onboardingStatusKey } from "../auth/actions";
import {
  applyOnboarded,
  applyProfile,
  canRetry,
  describeOnboardingError,
  submitOnboarding,
  submitOnboardingWithFallback,
  updateSchedule,
} from "./actions";
import { buildOnboardingPayload, draftFromParams, parseRatings, pickTimezone, type OnboardingDraft } from "./payload";

const session: Session = {
  user: { id: "u1", email: "a@b.co", username: "alpha", role: "user", emailVerified: false, timezone: "UTC", createdAt: "2026-01-01T00:00:00.000Z" },
  accessToken: "at",
  accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
  refreshToken: "rt",
};

const draft: OnboardingDraft = {
  ratings: { BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 },
  primaryGoal: "  Build an unbreakable daily routine ",
  weakness: "DISCIPLINE",
  stoppedBefore: "  I quit when I miss a day  ",
  identity: "semi-public",
  timezone: "Asia/Kolkata",
};

const profile = {
  username: "alpha",
  codename: "X",
  rank: "E",
  rankSince: "2026-01-01T00:00:00.000Z",
  identitySetting: "semi-public",
  primaryGoal: "Build an unbreakable daily routine",
  biggestWeakness: "DISCIPLINE",
  morningTime: "07:00",
  nightlyTime: "21:00",
  dayNumber: 1,
  onboarded: true,
  homePathActive: false,
  lifeContext: "student",
  season: null,
};
const gameState = {
  profile,
  scores: [],
  tierProgress: 0,
  trajectory: "stable",
  shadow: null,
  unseenNotices: [],
  hasMoreNotices: false,
  achievements: [],
  milestones: [],
  today: "2026-01-01",
};

type Call = { method: string; url: string; body: unknown; key: string | null };
function harness(handler: (c: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const tokens: TokenStore = { get: async () => session, set: async () => {} };
  const fakeFetch: typeof fetch = async (input, init) => {
    const headers = (init?.headers as Record<string, string>) ?? {};
    const call = {
      method: String(init?.method),
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      key: headers["Idempotency-Key"] ?? null,
    };
    calls.push(call);
    const r = handler(call);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  return { api: createApiClient({ fetch: fakeFetch, tokens, baseUrl: "http://x", onSessionExpired: () => {} }), calls };
}

test("payload: trims, defaults times, matches the server schema", () => {
  const p = buildOnboardingPayload(draft, "cid-1");
  assert.equal(p.primaryGoal, "Build an unbreakable daily routine");
  assert.equal(p.stoppedBefore, "I quit when I miss a day");
  assert.equal(p.morningTime, "07:00");
  assert.equal(p.nightlyTime, "21:00");
  assert.equal(p.biggestWeakness, "DISCIPLINE");
  assert.equal(p.clientId, "cid-1");
  assert.equal(OnboardingRequestSchema.safeParse(p).success, true);
});

test("payload: an empty 'stopped you' answer is omitted; long text is capped at 500", () => {
  assert.equal("stoppedBefore" in buildOnboardingPayload({ ...draft, stoppedBefore: "   " }), false);
  const p = buildOnboardingPayload({ ...draft, stoppedBefore: "x".repeat(900) });
  assert.equal(p.stoppedBefore?.length, 500);
  assert.equal(OnboardingRequestSchema.safeParse(p).success, true);
});

test("payload: START AT HOME FIRST sends homePathActive; off omits it; the param round-trips", () => {
  assert.equal("homePathActive" in buildOnboardingPayload(draft), false);
  const p = buildOnboardingPayload({ ...draft, homePath: true });
  assert.equal(p.homePathActive, true);
  assert.equal(OnboardingRequestSchema.safeParse(p).success, true);
  const params = { ratings: JSON.stringify(draft.ratings), primaryGoal: "Run 5km without stopping", weakness: "BODY", identity: "public" };
  assert.equal(draftFromParams({ ...params, homePath: "1" }, "UTC")!.homePath, true);
  assert.equal(draftFromParams(params, "UTC")!.homePath, false);
});

test("payload: lifeContext is sent when chosen, omitted otherwise; the param round-trips and a bad one is dropped", () => {
  assert.equal("lifeContext" in buildOnboardingPayload(draft), false);
  const p = buildOnboardingPayload({ ...draft, lifeContext: "founder" });
  assert.equal(p.lifeContext, "founder");
  assert.equal(OnboardingRequestSchema.safeParse(p).success, true);
  const params = { ratings: JSON.stringify(draft.ratings), primaryGoal: "Run 5km without stopping", weakness: "BODY", identity: "public" };
  assert.equal(draftFromParams({ ...params, lifeContext: "parent" }, "UTC")!.lifeContext, "parent");
  assert.equal(draftFromParams({ ...params, lifeContext: "pirate" }, "UTC")!.lifeContext, undefined);
  assert.equal(draftFromParams(params, "UTC")!.lifeContext, undefined);
});

test("params: round trip, defaults for damage, null when out of order", () => {
  const params = { ratings: JSON.stringify(draft.ratings), primaryGoal: "Run 5km without stopping", weakness: "BODY", stoppedBefore: "", identity: "public" };
  const d = draftFromParams(params, "UTC")!;
  assert.deepEqual(d.ratings, draft.ratings);
  assert.equal(d.identity, "public");
  assert.equal(d.weakness, "BODY");
  assert.deepEqual(parseRatings("{nope"), { BODY: 5, MIND: 5, WEALTH: 5, SOCIAL: 5, DISCIPLINE: 5 });
  assert.equal(parseRatings(JSON.stringify({ BODY: 99, SOCIAL: 3 })).BODY, 5);
  assert.equal(parseRatings(JSON.stringify({ BODY: 99, SOCIAL: 3 })).SOCIAL, 3);
  assert.equal(draftFromParams({ ...params, weakness: "NOPE" }, "UTC"), null);
  assert.equal(draftFromParams({ ...params, primaryGoal: "abc" }, "UTC"), null);
  assert.equal(draftFromParams({ ...params, identity: "weird" }, "UTC")!.identity, "semi-public");
});

test("submitOnboarding posts the payload with the clientId as idempotency key and parses GameState", async () => {
  const h = harness(() => ({ status: 201, body: gameState }));
  const state = await submitOnboarding(h.api, buildOnboardingPayload(draft, "cid-2"));
  assert.equal(state.profile.onboarded, true);
  assert.equal(h.calls[0]!.method, "POST");
  assert.equal(h.calls[0]!.url, "http://x/api/onboarding");
  assert.equal(h.calls[0]!.key, "cid-2");
  assert.equal((h.calls[0]!.body as { clientId: string }).clientId, "cid-2");
});

test("submitOnboarding: 409 already_onboarded reads the existing state back", async () => {
  const h = harness((c) =>
    c.method === "POST" ? { status: 409, body: { error: "Already onboarded", code: "already_onboarded" } } : { status: 200, body: gameState },
  );
  const state = await submitOnboarding(h.api, buildOnboardingPayload(draft));
  assert.equal(state.today, "2026-01-01");
  assert.deepEqual(h.calls.map((c) => `${c.method} ${c.url}`), ["POST http://x/api/onboarding", "GET http://x/api/state"]);
});

test("submitOnboarding: other failures propagate with issues kept", async () => {
  const h = harness(() => ({ status: 400, body: { error: "Validation failed", issues: [{ path: "primaryGoal", message: "Too short" }] } }));
  await assert.rejects(submitOnboarding(h.api, buildOnboardingPayload(draft)), (e: ApiError) => {
    assert.equal(e.status, 400);
    assert.deepEqual(e.issues, [{ path: "primaryGoal", message: "Too short" }]);
    assert.equal(describeOnboardingError(e), "Rejected: Too short");
    assert.equal(canRetry(e), false);
    return true;
  });
});

test("describeOnboardingError: SYSTEM-voice lines per failure kind", () => {
  assert.match(describeOnboardingError(new ApiError({ kind: "network", message: "x" })), /No connection/);
  assert.match(describeOnboardingError(new ApiError({ kind: "http", status: 503, message: "x" })), /unavailable/);
  assert.match(describeOnboardingError(new ApiError({ kind: "http", status: 429, message: "x" })), /Too many/);
  assert.match(describeOnboardingError(new ApiError({ kind: "http", status: 400, message: "x" })), /rejected/);
  assert.equal(canRetry(new ApiError({ kind: "network", message: "x" })), true);
  assert.equal(canRetry(new ApiError({ kind: "http", status: 503, message: "x" })), true);
  for (const m of [new ApiError({ kind: "network", message: "x" }), new ApiError({ kind: "http", status: 500, message: "x" })]) {
    assert.equal(describeOnboardingError(m).includes("!"), false);
  }
});

test("updateSchedule PATCHes the chosen times and parses the profile", async () => {
  const h = harness(() => ({ status: 200, body: { ...profile, morningTime: "05:30", nightlyTime: "22:00" } }));
  const p = await updateSchedule(h.api, { morningTime: "05:30", nightlyTime: "22:00" });
  assert.equal(p.morningTime, "05:30");
  assert.equal(h.calls[0]!.method, "PATCH");
  assert.equal(h.calls[0]!.url, "http://x/api/profile");
  assert.deepEqual(h.calls[0]!.body, { morningTime: "05:30", nightlyTime: "22:00" });
});

test("applyOnboarded seeds the game state and marks the gate onboarded; applyProfile patches the cached profile", () => {
  const store = new Map<string, unknown>();
  const qc = {
    setQueryData(key: readonly unknown[], updater: unknown) {
      const k = JSON.stringify(key);
      store.set(k, typeof updater === "function" ? (updater as (o: unknown) => unknown)(store.get(k)) : updater);
    },
  };
  applyOnboarded(qc, "u1", gameState as unknown as GameState);
  assert.equal(store.get(JSON.stringify(onboardingStatusKey("u1"))), "onboarded");
  assert.equal((store.get(JSON.stringify(gameStateKey("u1"))) as GameState).profile.morningTime, "07:00");
  applyProfile(qc, "u1", { ...profile, morningTime: "05:00" } as GameState["profile"]);
  assert.equal((store.get(JSON.stringify(gameStateKey("u1"))) as GameState).profile.morningTime, "05:00");
  applyProfile(qc, "u2", profile as GameState["profile"]); // no cache for u2: stays empty
  assert.equal(store.get(JSON.stringify(gameStateKey("u2"))), undefined);
});

test("pickTimezone: device, then account, then UTC", () => {
  assert.equal(pickTimezone("Asia/Kolkata", "UTC"), "Asia/Kolkata");
  assert.equal(pickTimezone("", "Europe/Paris"), "Europe/Paris");
  assert.equal(pickTimezone("  ", ""), "UTC");
});

const tzReject = { status: 400, body: { error: "Validation failed", issues: [{ path: "timezone", message: "Unknown timezone" }] } };

test("submitOnboardingWithFallback retries a timezone-only rejection with the account zone, then UTC", async () => {
  const seen: string[] = [];
  const h = harness((c) => {
    const tz = (c.body as { timezone: string }).timezone;
    seen.push(tz);
    return tz === "UTC" ? { status: 201, body: gameState } : tzReject;
  });
  const state = await submitOnboardingWithFallback(h.api, buildOnboardingPayload({ ...draft, timezone: "Bad/Zone" }), ["Also/Bad", "UTC"]);
  assert.equal(state.profile.onboarded, true);
  assert.deepEqual(seen, ["Bad/Zone", "Also/Bad", "UTC"]);
});

test("submitOnboardingWithFallback does not retry other rejections and gives up after the list", async () => {
  const other = harness(() => ({ status: 400, body: { issues: [{ path: "primaryGoal", message: "Too short" }] } }));
  await assert.rejects(submitOnboardingWithFallback(other.api, buildOnboardingPayload(draft), ["UTC"]), ApiError);
  assert.equal(other.calls.length, 1);
  const always = harness(() => tzReject);
  await assert.rejects(submitOnboardingWithFallback(always.api, buildOnboardingPayload(draft), ["UTC"]), ApiError);
  assert.equal(always.calls.length, 2);
});
