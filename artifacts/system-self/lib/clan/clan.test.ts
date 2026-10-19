import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClanMember, MyClanResponse, PublicProfile } from "@workspace/contracts";
import { ApiError, type ApiClient, type RequestOptions } from "../api/client";
import {
  clanCreateBody,
  clanLabel,
  clanStatusLine,
  completionLabel,
  createClan,
  createErrorOutcome,
  describeClanError,
  fetchClanLeaderboard,
  fetchMyClan,
  isFull,
  joinClanByCode,
  joinClanById,
  leaveBlocker,
  leaveClan,
  normalizeInviteCode,
  normalizeTag,
  removableMembers,
  removeClanMember,
  searchClans,
  transferCandidates,
  transferClanLeader,
  validateClanDraft,
} from "./clan";

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
const member = (n: number, over: Partial<ClanMember> = {}): ClanMember => ({
  userId: ID(n),
  isSelf: false,
  profile: profile(`user_${n}`),
  role: "member",
  flagged: false,
  questCompletionRate30d: null,
  ...over,
});
const clan = {
  id: ID(1),
  name: "Iron Wolves",
  tag: "IRON",
  memberCount: 3,
  status: "forming" as const,
  clanRank: null,
  description: null,
  clanScore: 0,
  raidWins: 0,
  inviteCode: "ABCD2345",
  createdAt: "2026-10-19T00:00:00.000Z",
  myRole: "leader" as const,
};

test("validateClanDraft: name 3–24 of letters/digits/space/_/-, tag 2–5 upper letters, description ≤ 200", () => {
  const ok = { name: "Iron Wolves", tag: "IRON", description: "" };
  assert.equal(validateClanDraft(ok), null);
  assert.match(validateClanDraft({ ...ok, name: "ab" })!, /^Name/);
  assert.match(validateClanDraft({ ...ok, name: "x".repeat(25) })!, /^Name/);
  assert.match(validateClanDraft({ ...ok, name: "Bad!" })!, /^Name/);
  assert.match(validateClanDraft({ ...ok, tag: "I" })!, /^Tag/);
  assert.match(validateClanDraft({ ...ok, tag: "iron" })!, /^Tag/);
  assert.match(validateClanDraft({ ...ok, description: "x".repeat(201) })!, /^Description/);
});

test("normalizeTag / normalizeInviteCode / clanCreateBody", () => {
  assert.equal(normalizeTag("ir-on9x!yz"), "IRONX");
  assert.equal(normalizeInviteCode(" abcd 2345 "), "ABCD2345");
  assert.deepEqual(clanCreateBody({ name: " Iron Wolves ", tag: "IRON", description: "  " }, "c1"), { name: "Iron Wolves", tag: "IRON", clientId: "c1" });
  assert.deepEqual(clanCreateBody({ name: "Iron", tag: "IRON", description: " We log. " }, "c1"), {
    name: "Iron",
    tag: "IRON",
    description: "We log.",
    clientId: "c1",
  });
});

test("display helpers", () => {
  assert.equal(clanLabel(clan), "IRON WOLVES [IRON]");
  assert.equal(clanStatusLine(clan), "FORMING — 3/8. 5 more operators required for raids and rank.");
  assert.equal(clanStatusLine({ ...clan, memberCount: 7 }), "FORMING — 7/8. 1 more operator required for raids and rank.");
  assert.equal(clanStatusLine({ status: "active", memberCount: 12, clanRank: 4 }), "ACTIVE — RANK #4. 12/30 operators.");
  assert.match(clanStatusLine({ status: "active", memberCount: 8, clanRank: null }), /UNRANKED/);
  assert.equal(isFull({ memberCount: 30 }), true);
  assert.equal(isFull({ memberCount: 29 }), false);
  assert.equal(completionLabel(null), "—");
  assert.equal(completionLabel(75), "75%");
});

test("leader actions: removable = flagged non-leaders; transfer to anyone but self; leave blocker", () => {
  const members = [member(1, { role: "leader", isSelf: true, flagged: true }), member(2, { flagged: true }), member(3)];
  assert.deepEqual(removableMembers(members).map((m) => m.userId), [ID(2)]);
  assert.deepEqual(transferCandidates(members).map((m) => m.userId), [ID(2), ID(3)]);
  const data: MyClanResponse = { clan, members, dispatches: [], raid: null };
  assert.equal(leaveBlocker(data), "Transfer leadership before leaving.");
  assert.equal(leaveBlocker({ ...data, members: [members[0]!] }), null);
  assert.equal(leaveBlocker({ ...data, clan: { ...clan, myRole: "member" } }), null);
});

test("errors: 402 → PRO lock, 403 email_unverified → verify prompt, codes → SYSTEM lines", () => {
  assert.deepEqual(createErrorOutcome(http(402, "pro_required")), { kind: "pro" });
  assert.deepEqual(createErrorOutcome(http(403, "email_unverified")), { kind: "verify_email" });
  assert.deepEqual(createErrorOutcome(http(409, "name_taken")), { kind: "error", message: "That clan name is taken." });
  assert.equal(describeClanError(http(409, "clan_full")), "Clan is full. 30 operators maximum.");
  assert.equal(describeClanError(http(409, "already_in_clan")), "You are already in a clan. One clan per operator.");
  assert.equal(describeClanError(http(409, "leader_must_transfer")), "Transfer leadership before leaving.");
  assert.equal(describeClanError(http(409, "not_flagged")), "Only members flagged as dead weight can be removed.");
  assert.equal(describeClanError(http(402, "pro_required")), "PRO required.");
  assert.equal(describeClanError(new ApiError({ kind: "network", message: "x" })), "No connection. Check your signal and retry.");
  assert.equal(describeClanError(http(500)), "The system is unavailable. Retry shortly.");
  assert.equal(describeClanError(new Error("x")), "The request failed. Retry.");
});

test("reads parse the contract", async () => {
  const { api, calls } = fakeApi((c) => {
    if (c.path === "/api/clans/mine") return { clan: null, members: [], dispatches: [], raid: null };
    if (c.path.startsWith("/api/clans/search")) return { items: [{ id: ID(1), name: "Iron Wolves", tag: "IRON", memberCount: 3, status: "forming", clanRank: null }] };
    return { items: [{ id: ID(1), name: "Iron Wolves", tag: "IRON", memberCount: 9, status: "active", clanRank: 1, clanScore: 51.2 }] };
  });
  assert.equal((await fetchMyClan(api)).clan, null);
  assert.equal((await searchClans(api, " iron wolves ")).length, 1);
  assert.equal((await fetchClanLeaderboard(api)).length, 1);
  assert.deepEqual(calls.map((c) => c.path), ["/api/clans/mine", "/api/clans/search?q=iron%20wolves", "/api/clans/leaderboard?limit=50"]);
});

test("mutations wait for the outbox and send idempotency keys", async () => {
  const { api, calls } = fakeApi((c) => (c.path === "/api/clans" ? clan : null));
  const draft = { name: "Iron Wolves", tag: "IRON", description: "" };
  const made = await createClan(api, synced, draft, "k1");
  assert.ok(made.ok && made.value.id === ID(1));
  await joinClanById(api, synced, ID(1), "k2");
  await joinClanByCode(api, synced, "abcd 2345", "k3");
  await leaveClan(api, synced, "k4");
  await removeClanMember(api, synced, ID(2), "k5");
  await transferClanLeader(api, synced, ID(3), "k6");
  assert.deepEqual(
    calls.map((c) => [c.method, c.path, c.opts.idempotencyKey]),
    [
      ["POST", "/api/clans", "k1"],
      ["POST", `/api/clans/${ID(1)}/join`, "k2"],
      ["POST", "/api/clans/join", "k3"],
      ["POST", "/api/clans/leave", "k4"],
      ["POST", `/api/clans/members/${ID(2)}/remove`, "k5"],
      ["POST", "/api/clans/leader", "k6"],
    ],
  );
  assert.deepEqual(calls[2]!.opts.body, { inviteCode: "ABCD2345", clientId: "k3" });
  assert.deepEqual(calls[5]!.opts.body, { userId: ID(3), clientId: "k6" });

  const before = calls.length;
  assert.deepEqual(await leaveClan(api, stuck, "k7"), { ok: false, reason: "sync_pending" });
  assert.equal(calls.length, before);
});
