import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClanMember, PeerRatingsMine, PublicProfile } from "@workspace/contracts";
import { ApiError, type ApiClient, type RequestOptions } from "../api/client";
import {
  RATING_ANONYMITY_LINE,
  canRate,
  describeRatingError,
  fetchRatings,
  rateableMembers,
  ratedValue,
  remainingLine,
  submitRating,
} from "./ratings";

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
const http = (status: number, code?: string) => new ApiError({ kind: "http", status, code, message: "x" });

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const profile = (handle: string): PublicProfile => ({ handle, isCodename: false, rank: "D", trajectory: "up", shadowActive: false });
const member = (n: number, handle: string, isSelf = false): ClanMember => ({
  userId: ID(n),
  isSelf,
  profile: profile(handle),
  role: "member",
  flagged: false,
  questCompletionRate30d: null,
});
const mineView = (given: PeerRatingsMine["given"], remaining: number): PeerRatingsMine => ({ weekKey: "2026-W42", given, remaining });

test("the anonymity line is the product copy", () => {
  assert.equal(RATING_ANONYMITY_LINE, "Ratings are anonymous. Rate the output, not the person.");
});

test("rateableMembers drops the viewer", () => {
  const ms = [member(1, "me", true), member(2, "ash"), member(3, "bea")];
  assert.deepEqual(rateableMembers(ms).map((m) => m.profile.handle), ["ash", "bea"]);
});

test("ratedValue reads the rating given to a handle, or null", () => {
  const view = mineView([{ rateeHandle: "ash", rating: 4 }], 4);
  assert.equal(ratedValue(view, "ash"), 4);
  assert.equal(ratedValue(view, "bea"), null);
  assert.equal(ratedValue(undefined, "ash"), null);
});

test("canRate: a free slot, or a clanmate already rated (re-rating is not a new slot)", () => {
  const full = mineView([{ rateeHandle: "ash", rating: 4 }], 0);
  assert.equal(canRate(full, "ash"), true);
  assert.equal(canRate(full, "bea"), false);
  assert.equal(canRate(mineView([], 5), "bea"), true);
  assert.equal(canRate(undefined, "bea"), false, "nothing loaded yet");
});

test("remainingLine counts down and explains an empty allowance", () => {
  assert.equal(remainingLine(5), "5 ratings remaining this week.");
  assert.equal(remainingLine(1), "1 rating remaining this week.");
  assert.equal(remainingLine(0), "No ratings remaining this week. You can still change one you gave.");
});

test("describeRatingError maps the server codes to SYSTEM copy", () => {
  assert.match(describeRatingError(http(403, "not_eligible")), /7 days/);
  assert.match(describeRatingError(http(409, "rating_limit")), /5 clanmates/);
  assert.match(describeRatingError(http(403, "self_target")), /yourself/);
  assert.match(describeRatingError(http(400)), /Check/);
  assert.match(describeRatingError(new ApiError({ kind: "network", message: "x" })), /No connection/);
  assert.match(describeRatingError(new Error("boom")), /failed/);
});

test("fetchRatings reads GET /api/clans/ratings/mine through the contract", async () => {
  const { api, calls } = fakeApi(() => mineView([{ rateeHandle: "ash", rating: 4 }], 4));
  assert.deepEqual(await fetchRatings(api), mineView([{ rateeHandle: "ash", rating: 4 }], 4));
  assert.equal(calls[0]!.path, "/api/clans/ratings/mine");
  const bad = fakeApi(() => ({ weekKey: "x" }));
  await assert.rejects(fetchRatings(bad.api));
});

test("submitRating posts after the outbox with the clientId as idempotency key", async () => {
  const { api, calls } = fakeApi(() => mineView([{ rateeHandle: "ash", rating: 5 }], 4));
  const r = await submitRating(api, synced, ID(2), 5, "rate-1");
  assert.equal(r.ok, true);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.path, "/api/clans/ratings");
  assert.deepEqual(calls[0]!.opts.body, { rateeUserId: ID(2), rating: 5, clientId: "rate-1" });
  assert.equal(calls[0]!.opts.idempotencyKey, "rate-1");
});

test("submitRating does not send while queued entries are still syncing", async () => {
  const { api, calls } = fakeApi(() => mineView([], 5));
  const r = await submitRating(api, stuck, ID(2), 3, "rate-2");
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});
