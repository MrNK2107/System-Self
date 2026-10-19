import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicProfile } from "@workspace/contracts";
import { ApiError, type ApiClient, type RequestOptions } from "../api/client";
import {
  REPORT_REASON_MAX,
  SOCIAL_POLL_MS,
  blockPlayer,
  codenameShareMessage,
  describeSocialError,
  fetchFollowersCount,
  fetchFollowing,
  fetchSocialProfile,
  followPlayer,
  normalizeReportReason,
  normalizeSearchQuery,
  playerPath,
  profileSummary,
  reportPlayer,
  searchPlayers,
  socialRefetchInterval,
  unblockPlayer,
  unfollowPlayer,
} from "./social";

interface Call {
  method: string;
  path: string;
  opts: RequestOptions<unknown>;
}
function fakeApi(reply: (c: Call) => unknown) {
  const calls: Call[] = [];
  const api: ApiClient = {
    async request<T>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
      const c = { method, path, opts: opts as RequestOptions<unknown> };
      calls.push(c);
      const body = reply(c);
      if (opts.schema) {
        const parsed = opts.schema.safeParse(body);
        if (!parsed.success) throw new ApiError({ kind: "parse", message: `Unexpected response from ${path}` });
        return parsed.data;
      }
      return body as T;
    },
  };
  return { api, calls };
}
const synced = { flushBeforeMutation: async () => true };
const stuck = { flushBeforeMutation: async () => false };

const profile = (over: Partial<PublicProfile> = {}): PublicProfile => ({
  handle: "USER // BOLT-3",
  isCodename: true,
  rank: "C",
  trajectory: "up",
  shadowActive: false,
  ...over,
});

test("search query: trimmed, 3 characters minimum, capped at 32", () => {
  assert.equal(normalizeSearchQuery("  al "), null);
  assert.equal(normalizeSearchQuery("ab"), null);
  assert.equal(normalizeSearchQuery(" ali "), "ali");
  assert.equal(normalizeSearchQuery("x".repeat(60))!.length, 32);
});

test("report reason: trimmed, 1..500 characters", () => {
  assert.equal(normalizeReportReason("   "), null);
  assert.equal(normalizeReportReason(" spam "), "spam");
  assert.equal(normalizeReportReason("x".repeat(900))!.length, REPORT_REASON_MAX);
});

test("a codename handle is URL-safe in a path", () => {
  assert.equal(playerPath("USER // BOLT-3"), "USER%20%2F%2F%20BOLT-3");
  assert.equal(decodeURIComponent(playerPath("USER // BOLT-3")), "USER // BOLT-3");
});

test("social screens poll every 60 s only while focused", () => {
  assert.equal(SOCIAL_POLL_MS, 60_000);
  assert.equal(socialRefetchInterval(true), 60_000);
  assert.equal(socialRefetchInterval(false), false);
});

test("reads: search, following, followers count, profile", async () => {
  const { api, calls } = fakeApi((c) => {
    if (c.path.startsWith("/api/social/search")) return [profile()];
    if (c.path === "/api/social/following") return [profile({ rank: "B" })];
    if (c.path === "/api/social/followers/count") return { count: 4 };
    return { profile: profile(), following: true, isSelf: false };
  });
  assert.equal((await searchPlayers(api, "bol"))[0]!.handle, "USER // BOLT-3");
  assert.equal((await fetchFollowing(api))[0]!.rank, "B");
  assert.equal(await fetchFollowersCount(api), 4);
  assert.equal((await fetchSocialProfile(api, "USER // BOLT-3")).following, true);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    [
      "GET /api/social/search?q=bol",
      "GET /api/social/following",
      "GET /api/social/followers/count",
      "GET /api/social/profile/USER%20%2F%2F%20BOLT-3",
    ],
  );
});

test("search encodes the query", async () => {
  const { api, calls } = fakeApi(() => []);
  await searchPlayers(api, "a&b c");
  assert.equal(calls[0]!.path, "/api/social/search?q=a%26b%20c");
});

test("a profile that leaks scores or an unknown shape fails the contract", async () => {
  const { api } = fakeApi(() => [{ handle: "x" }]);
  await assert.rejects(searchPlayers(api, "abc"), (e: unknown) => e instanceof ApiError && e.kind === "parse");
});

test("mutations send idempotent requests after the outbox flushes", async () => {
  const { api, calls } = fakeApi((c) => (c.path.endsWith("/report") ? { id: "6f1e5b0a-2c1b-4d52-9f0b-1d1d2f3a4b5c" } : null));
  assert.deepEqual(await followPlayer(api, synced, "USER // BOLT-3", "c1"), { ok: true, value: null });
  await unfollowPlayer(api, synced, "pubby_1", "c2");
  await blockPlayer(api, synced, "pubby_1", "c3");
  await unblockPlayer(api, synced, "pubby_1", "c4");
  const rep = await reportPlayer(api, synced, "pubby_1", "  spam  ", "c5");
  assert.equal(rep.ok, true);
  assert.deepEqual(
    calls.map((c) => [c.method, c.path, c.opts.idempotencyKey]),
    [
      ["POST", "/api/social/follow/USER%20%2F%2F%20BOLT-3", "c1"],
      ["DELETE", "/api/social/follow/pubby_1", "c2"],
      ["POST", "/api/social/block/pubby_1", "c3"],
      ["DELETE", "/api/social/block/pubby_1", "c4"],
      ["POST", "/api/social/report", "c5"],
    ],
  );
  assert.deepEqual(calls[4]!.opts.body, { subject: "pubby_1", reason: "spam", clientId: "c5" });
});

test("while queued logs cannot be sent, no social mutation is sent either", async () => {
  const { api, calls } = fakeApi(() => null);
  assert.deepEqual(await followPlayer(api, stuck, "x_user", "c1"), { ok: false, reason: "sync_pending" });
  assert.deepEqual(await blockPlayer(api, stuck, "x_user", "c2"), { ok: false, reason: "sync_pending" });
  assert.equal(calls.length, 0);
});

test("a blank report reason is never sent", async () => {
  const { api, calls } = fakeApi(() => null);
  await assert.rejects(reportPlayer(api, synced, "pubby_1", "   ", "c1"), /reason/i);
  assert.equal(calls.length, 0);
});

test("profile summary: rank, trajectory and shadow, plus scores only when the server sent them", () => {
  assert.deepEqual(profileSummary(profile()), { rankLine: "RANK C", trajectoryLine: "TRAJECTORY UP", shadowLine: null, scores: null });
  assert.equal(profileSummary(profile({ trajectory: "down" })).trajectoryLine, "TRAJECTORY DOWN");
  assert.equal(profileSummary(profile({ trajectory: "stable" })).trajectoryLine, "TRAJECTORY STABLE");
  assert.equal(profileSummary(profile({ shadowActive: true })).shadowLine, "SHADOW ACTIVE");
  const s = profileSummary(profile({ scores: { BODY: 41.26, MIND: 52, WEALTH: 33, SOCIAL: 64, DISCIPLINE: 27 } }));
  assert.deepEqual(s.scores, [
    { domain: "BODY", value: 41.3 },
    { domain: "MIND", value: 52 },
    { domain: "WEALTH", value: 33 },
    { domain: "SOCIAL", value: 64 },
    { domain: "DISCIPLINE", value: 27 },
  ]);
});

test("errors read in the SYSTEM voice", () => {
  const e = (status: number, code?: string) => new ApiError({ kind: "http", message: "x", status, code });
  assert.equal(describeSocialError(e(404, "not_found")), "No such player.");
  assert.equal(describeSocialError(e(403, "blocked")), "That player is blocked.");
  assert.equal(describeSocialError(e(400, "self_target")), "That is you.");
  assert.equal(describeSocialError(e(409, "already_reported")), "Already reported. It is under review.");
  assert.equal(describeSocialError(e(429, "report_limit")), "Report limit reached for today.");
  assert.equal(describeSocialError(new ApiError({ kind: "network", message: "x" })), "No connection. Check your signal and retry.");
  assert.equal(describeSocialError(e(500)), "The system is unavailable. Retry shortly.");
  assert.equal(describeSocialError(new Error("boom")), "The request failed. Retry.");
});

test("codename share message names the codename", () => {
  assert.equal(codenameShareMessage("USER // ASH-3"), "Find me on SYSTEM // SELF. Search my codename: USER // ASH-3");
});
