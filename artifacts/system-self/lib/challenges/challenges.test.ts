import assert from "node:assert/strict";
import { test } from "node:test";
import type { Challenge } from "@workspace/contracts";
import { ApiError, type ApiClient, type RequestOptions } from "../api/client";
import {
  CHALLENGE_DAYS,
  acceptChallenge,
  challengeCreateBody,
  challengeHeadline,
  createChallenge,
  createOutcome,
  describeChallengeError,
  fetchChallenges,
  gainLabel,
  groupChallenges,
  ignoreChallenge,
  respondTimeLeft,
  standingLine,
  statusLine,
} from "./challenges";

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

const ch = (n: number, over: Partial<Challenge> = {}): Challenge => ({
  id: ID(n),
  role: "challenger",
  opponent: { handle: "yuri_1", isCodename: false },
  domain: "MIND",
  days: 7,
  status: "pending",
  createdAt: "2026-10-19T10:00:00.000Z",
  respondBy: "2026-10-21T10:00:00.000Z",
  startDate: null,
  endDate: null,
  myGain: null,
  theirGain: null,
  outcome: null,
  line: null,
  ...over,
});

test("days are the server's 3, 7, 14, 30", () => {
  assert.deepEqual([...CHALLENGE_DAYS], [3, 7, 14, 30]);
});

test("fetchChallenges returns the items; createChallenge sends the body with the client id after the outbox", async () => {
  const made = ch(1);
  const { api, calls } = fakeApi((c) => (c.method === "GET" ? { items: [made] } : made));
  assert.deepEqual(await fetchChallenges(api), [made]);
  const r = await createChallenge(api, synced, { opponent: " yuri_1 ", domain: "MIND", days: 7 }, "k1");
  assert.equal(r.ok, true);
  assert.deepEqual(calls[1]!.opts.body, { opponent: "yuri_1", domain: "MIND", days: 7, clientId: "k1" });
  assert.equal(calls[1]!.opts.idempotencyKey, "k1");
  assert.equal(calls[1]!.path, "/api/challenges");
  assert.deepEqual(challengeCreateBody({ opponent: "a", domain: "BODY", days: 3 }, "c"), { opponent: "a", domain: "BODY", days: 3, clientId: "c" });
});

test("accept and ignore post to the challenge; a stuck outbox sends nothing", async () => {
  const { api, calls } = fakeApi(() => ch(2, { status: "active" }));
  assert.equal((await acceptChallenge(api, synced, ID(2), "k2")).ok, true);
  assert.equal((await ignoreChallenge(api, synced, ID(2), "k3")).ok, true);
  assert.deepEqual(calls.map((c) => [c.method, c.path]), [
    ["POST", `/api/challenges/${ID(2)}/accept`],
    ["POST", `/api/challenges/${ID(2)}/ignore`],
  ]);
  const quiet = fakeApi(() => ch(2));
  assert.deepEqual(await acceptChallenge(quiet.api, stuck, ID(2), "k4"), { ok: false, reason: "sync_pending" });
  assert.deepEqual(await createChallenge(quiet.api, stuck, { opponent: "a", domain: "MIND", days: 3 }, "k5"), { ok: false, reason: "sync_pending" });
  assert.equal(quiet.calls.length, 0);
});

test("groupChallenges: incoming to answer, waiting on others, active, closed", () => {
  const items = [
    ch(1, { role: "opponent" }),
    ch(2, { role: "challenger" }),
    ch(3, { status: "active", startDate: "2026-10-19", endDate: "2026-10-25", myGain: 1, theirGain: 2 }),
    ch(4, { status: "ignored", line: "Challenge ignored. Logged." }),
    ch(5, { status: "resolved", outcome: "win", myGain: 3, theirGain: 1 }),
    ch(6, { role: "opponent", status: "void" }),
  ];
  const g = groupChallenges(items);
  assert.deepEqual(g.incoming.map((c) => c.id), [ID(1)]);
  assert.deepEqual(g.sent.map((c) => c.id), [ID(2)]);
  assert.deepEqual(g.active.map((c) => c.id), [ID(3)]);
  assert.deepEqual(g.closed.map((c) => c.id), [ID(4), ID(5), ID(6)]);
});

test("gain labels, standing and status lines use the SYSTEM voice and only domain gains", () => {
  assert.equal(gainLabel(4), "+4.0");
  assert.equal(gainLabel(-1.26), "-1.3");
  assert.equal(gainLabel(0), "0.0");
  const live = ch(3, { status: "active", myGain: 4, theirGain: 1.5, endDate: "2026-10-25" });
  assert.equal(standingLine(live), "LEADING BY 2.5");
  assert.equal(standingLine({ ...live, myGain: 1, theirGain: 3 }), "TRAILING BY 2.0");
  assert.equal(standingLine({ ...live, myGain: 2, theirGain: 2 }), "TIED");
  assert.equal(standingLine(ch(1)), "");
  assert.equal(challengeHeadline(ch(1)), "MIND // 7 DAYS vs yuri_1");
  assert.equal(challengeHeadline(ch(1, { opponent: { handle: null, isCodename: false } })), "MIND // 7 DAYS vs [GONE]");
  assert.equal(statusLine(ch(4, { status: "ignored", line: "Challenge ignored. Logged." })), "Challenge ignored. Logged.");
  assert.equal(statusLine(ch(4, { status: "ignored", role: "opponent" })), "Ignored.");
  assert.equal(statusLine(ch(5, { status: "resolved", outcome: "win" })), "WON. +3.0 DISCIPLINE.");
  assert.equal(statusLine(ch(5, { status: "resolved", outcome: "loss" })), "LOST. -1.5 DISCIPLINE.");
  assert.equal(statusLine(ch(5, { status: "resolved", outcome: "draw" })), "DRAW. No score change.");
  assert.equal(statusLine(ch(6, { status: "void" })), "VOID. No score change.");
  assert.equal(statusLine(ch(1, { role: "challenger" })), "Waiting for an answer.");
  assert.equal(statusLine(ch(1, { role: "opponent" })), "Answer within 48 hours or it is ignored.");
});

test("respondTimeLeft counts down to the 48 hour deadline", () => {
  const by = "2026-10-21T10:00:00.000Z";
  assert.equal(respondTimeLeft(by, new Date("2026-10-19T10:00:00.000Z")), "2d 0h left");
  assert.equal(respondTimeLeft(by, new Date("2026-10-21T04:30:00.000Z")), "5h 30m left");
  assert.equal(respondTimeLeft(by, new Date("2026-10-21T09:50:00.000Z")), "10m left");
  assert.equal(respondTimeLeft(by, new Date("2026-10-21T10:00:00.000Z")), "closing");
});

test("errors map to a PRO lock or a SYSTEM-voice line", () => {
  assert.deepEqual(createOutcome(http(402, "pro_required")), { kind: "pro" });
  assert.deepEqual(createOutcome(http(403, "not_eligible")), { kind: "error", message: "You can only challenge a player you follow or a clanmate." });
  assert.equal(describeChallengeError(http(409, "challenge_limit")), "Three open challenges is the limit. Finish or answer one first.");
  assert.equal(describeChallengeError(http(409, "opponent_busy")), "That player has too many open challenges.");
  assert.equal(describeChallengeError(http(409, "challenge_open")), "A challenge between you is already open.");
  assert.equal(describeChallengeError(http(409, "expired")), "The 48 hours to answer have passed. It was ignored. Logged.");
  assert.equal(describeChallengeError(http(409, "not_pending")), "That challenge is no longer waiting for an answer.");
  assert.equal(describeChallengeError(http(404, "not_found")), "Player or challenge not found.");
  assert.equal(describeChallengeError(http(400, "self_challenge")), "You cannot challenge yourself.");
  assert.equal(describeChallengeError(http(409, "not_in_clan")), "Join a clan to use Shame Mode.");
  assert.equal(describeChallengeError(http(500)), "The system is unavailable. Retry shortly.");
  assert.equal(describeChallengeError(new ApiError({ kind: "network", message: "x" })), "No connection. Check your signal and retry.");
  assert.equal(describeChallengeError(new Error("x")), "The request failed. Retry.");
});
