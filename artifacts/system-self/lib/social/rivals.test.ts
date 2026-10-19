import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicProfile, RivalChallenge, RivalsResponse } from "@workspace/contracts";
import { ApiError, type ApiClient, type RequestOptions } from "../api/client";
import {
  ackRivalChallenge,
  buildLeaderboard,
  challengeProgress,
  composite,
  declareRivalChallenge,
  declareOutcomeMessage,
  describeRivalError,
  fetchRivals,
  leaderStatus,
  markTauntsRead,
  shortCodename,
  tauntRival,
} from "./rivals";

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

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scores = (v: number) => ({ BODY: v, MIND: v, WEALTH: v, SOCIAL: v, DISCIPLINE: v });
const profile = (over: Partial<PublicProfile> = {}): PublicProfile => ({
  handle: "RIVAL // ASH-3",
  isCodename: true,
  rank: "D",
  trajectory: "up",
  shadowActive: false,
  scores: scores(30),
  ...over,
});
const challenge = (over: Partial<RivalChallenge> = {}): RivalChallenge => ({
  id: ID(9),
  assignmentId: ID(1),
  codename: "RIVAL // ASH-3",
  domain: "MIND",
  startDate: "2026-01-01",
  endDate: "2026-01-07",
  userStart: 20,
  rivalStart: 30,
  userCurrent: 24,
  rivalCurrent: 31,
  outcome: null,
  acknowledged: false,
  ...over,
});
const response = (over: Partial<RivalsResponse> = {}): RivalsResponse => ({
  rivals: [
    { assignmentId: ID(1), slot: 1, codename: "RIVAL // ASH-3", isGhost: true, profile: profile({ scores: scores(40) }) },
    { assignmentId: ID(2), slot: 2, codename: "RIVAL // OAK-1", isGhost: false, profile: profile({ handle: "RIVAL // OAK-1", scores: scores(20), trajectory: "down" }) },
  ],
  shadow: { codename: "SHADOW // ME", rank: "C", scores: scores(50) },
  challenges: [],
  record: { wins: 1, losses: 2, draws: 0 },
  taunts: [],
  ...over,
});

test("fetchRivals reads GET /api/rivals with the contract", async () => {
  const { api, calls } = fakeApi(() => response());
  const r = await fetchRivals(api);
  assert.equal(calls[0]!.method, "GET");
  assert.equal(calls[0]!.path, "/api/rivals");
  assert.equal(r.rivals.length, 2);
  const bad = fakeApi(() => ({ rivals: "nope" }));
  await assert.rejects(fetchRivals(bad.api));
});

test("rival mutations go after the outbox with an idempotency key", async () => {
  const { api, calls } = fakeApi((c) => (c.path.endsWith("/challenge") ? challenge() : c.path.endsWith("/taunt") ? { id: ID(5), codename: "RIVAL // ASH-3", isGhost: false, message: "m", createdAt: "2026-01-01T00:00:00.000Z", read: false } : null));
  const declared = await declareRivalChallenge(api, synced, ID(1), "MIND", "c-1");
  assert.ok(declared.ok);
  assert.deepEqual(calls[0], {
    method: "POST",
    path: `/api/rivals/${ID(1)}/challenge`,
    opts: calls[0]!.opts,
  });
  assert.deepEqual(calls[0]!.opts.body, { domain: "MIND", clientId: "c-1" });
  assert.equal(calls[0]!.opts.idempotencyKey, "c-1");
  assert.ok((await ackRivalChallenge(api, synced, ID(9), "c-2")).ok);
  assert.equal(calls[1]!.path, `/api/rivals/challenges/${ID(9)}/ack`);
  const t = await tauntRival(api, synced, ID(1), "c-3");
  assert.ok(t.ok && t.value.message === "m");
  assert.equal(calls[2]!.path, `/api/rivals/${ID(1)}/taunt`);
  assert.ok((await markTauntsRead(api, synced, "c-4")).ok);
  assert.equal(calls[3]!.path, "/api/rivals/taunts/read");
  assert.equal(calls[3]!.opts.idempotencyKey, "c-4");

  const held = fakeApi(() => null);
  assert.deepEqual(await declareRivalChallenge(held.api, stuck, ID(1), "MIND", "c-5"), { ok: false, reason: "sync_pending" });
  assert.equal(held.calls.length, 0);
});

test("composite is the plain mean of the five visible domain scores (never the hidden score)", () => {
  assert.equal(composite(scores(40)), 40);
  assert.equal(composite({ BODY: 10, MIND: 20, WEALTH: 30, SOCIAL: 40, DISCIPLINE: 50 }), 30);
});

test("leaderboard: you, your shadow and every rival, sorted by composite; ghosts flagged", () => {
  const me = { handle: "alice_1", rank: "D" as const, trajectory: "stable" as const, scores: scores(35) };
  const board = buildLeaderboard(me, response());
  assert.deepEqual(board.entries.map((e) => e.kind), ["shadow", "rival", "you", "rival"]);
  assert.deepEqual(board.entries.map((e) => e.label), ["SHADOW // ME", "RIVAL // ASH-3", "alice_1", "RIVAL // OAK-1"]);
  assert.equal(board.entries[1]!.isGhost, true);
  assert.equal(board.entries[3]!.isGhost, false);
  assert.equal(board.position, 3);
  assert.equal(board.losingTo, 2);
  assert.equal(board.surpassing, 1);
  assert.equal(board.userComposite, 35);
  // no shadow while dormant
  assert.equal(buildLeaderboard(me, response({ shadow: null })).entries.length, 3);
});

test("leader status: THREATENING ahead and rising, AHEAD, CLOSING within 8 and rising, BEHIND, SHADOW", () => {
  const e = (kind: "rival" | "shadow", c: number, trajectory: "up" | "down" | "stable") => ({ kind, composite: c, trajectory });
  assert.equal(leaderStatus(e("rival", 40, "up"), 35), "THREATENING");
  assert.equal(leaderStatus(e("rival", 40, "down"), 35), "AHEAD");
  assert.equal(leaderStatus(e("rival", 30, "up"), 35), "CLOSING");
  assert.equal(leaderStatus(e("rival", 20, "up"), 35), "BEHIND");
  assert.equal(leaderStatus(e("rival", 30, "stable"), 35), "BEHIND");
  assert.equal(leaderStatus(e("shadow", 50, "up"), 35), "SHADOW");
});

test("challenge progress: gains from the start, days left in the 7-day window, leading", () => {
  const p = challengeProgress(challenge(), "2026-01-03");
  assert.equal(p.userGain, 4);
  assert.equal(p.rivalGain, 1);
  assert.equal(p.leading, true);
  assert.equal(p.daysLeft, 5); // Jan 3..7 inclusive
  assert.equal(p.pct, (2 / 7) * 100);
  const last = challengeProgress(challenge(), "2026-01-07");
  assert.equal(last.daysLeft, 1);
  const done = challengeProgress(challenge({ outcome: "loss" }), "2026-01-09");
  assert.equal(done.daysLeft, 0);
  assert.equal(done.pct, 100);
});

test("rival error copy", () => {
  const http = (code: string, status = 409) => new ApiError({ kind: "http", status, code, message: code });
  assert.equal(describeRivalError(http("challenge_open")), "A challenge against this rival is already running.");
  assert.equal(describeRivalError(http("taunt_limit", 429)), "One transmission per rival per day.");
  assert.equal(describeRivalError(http("message_limit", 429)), "Transmission limit reached for today.");
  assert.equal(describeRivalError(http("not_found", 404)), "That rival is gone. Pull to refresh.");
  assert.equal(describeRivalError(new ApiError({ kind: "network", message: "x" })), "No connection. Check your signal and retry.");
});

test("shortCodename strips the prefix", () => {
  assert.equal(shortCodename("RIVAL // ASH-3"), "ASH-3");
  assert.equal(shortCodename("plain"), "plain");
});

test("declareOutcomeMessage: null only when the server confirmed the challenge, else a SYSTEM-voice error", async () => {
  assert.equal(await declareOutcomeMessage(async () => ({ ok: true, value: challenge() })), null);
  assert.equal(
    await declareOutcomeMessage(async () => ({ ok: false, reason: "sync_pending" })),
    "Queued entries are still syncing. Retry once they land.",
  );
  const rejected = new ApiError({ kind: "http", status: 409, code: "challenge_open", message: "x" });
  assert.equal(
    await declareOutcomeMessage(async () => {
      throw rejected;
    }),
    "A challenge against this rival is already running.",
  );
  assert.equal(
    await declareOutcomeMessage(async () => {
      throw new ApiError({ kind: "network", message: "x" });
    }),
    "No connection. Check your signal and retry.",
  );
});

test("a 402 pro_required reads as a PRO lock, not a generic rejection", () => {
  assert.equal(describeRivalError(new ApiError({ kind: "http", status: 402, code: "pro_required", message: "x" })), "PRO required.");
});
