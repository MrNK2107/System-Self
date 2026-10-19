import assert from "node:assert/strict";
import { test } from "node:test";
import type { DuoCheckinItem, DuoResponse } from "@workspace/contracts";
import { ApiError, type ApiClient, type RequestOptions } from "../api/client";
import {
  DUO_BUTTONS,
  agoLabel,
  answerDuoInvite,
  checkinLine,
  describeDuoError,
  fetchDuo,
  hasDuoActivity,
  incomingInvites,
  inviteToDuo,
  latestCheckins,
  leaveDuo,
  sendDuoCheckin,
} from "./duo";

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
const NOW = new Date("2026-10-19T12:00:00.000Z");

const checkin = (n: number, over: Partial<DuoCheckinItem> = {}): DuoCheckinItem => ({
  id: ID(n),
  kind: "going_now",
  fromMe: false,
  createdAt: "2026-10-19T10:00:00.000Z",
  ...over,
});
const view = (over: Partial<DuoResponse> = {}): DuoResponse => ({ partner: null, checkins: [], pendingInvites: [], ...over });
const partner = { handle: "yuri_1", isCodename: false, rank: "C", trajectory: "up", shadowActive: false } as const;

test("the three check-in buttons are GOING NOW, CHECKED IN, DONE", () => {
  assert.deepEqual(DUO_BUTTONS.map((b) => [b.kind, b.label]), [
    ["going_now", "GOING NOW"],
    ["checked_in", "CHECKED IN"],
    ["done", "DONE"],
  ]);
});

test("check-in lines name the sender and the age; the newest come first", () => {
  assert.equal(checkinLine(checkin(1), "yuri_1", NOW), "GOING NOW // yuri_1 // 2h ago");
  assert.equal(checkinLine(checkin(2, { kind: "done", fromMe: true, createdAt: "2026-10-19T11:58:00.000Z" }), "yuri_1", NOW), "DONE // YOU // 2m ago");
  assert.equal(agoLabel("2026-10-19T11:59:40.000Z", NOW), "just now");
  assert.equal(agoLabel("2026-10-14T12:00:00.000Z", NOW), "5d ago");
  const items = [checkin(1, { createdAt: "2026-10-19T08:00:00.000Z" }), checkin(2, { createdAt: "2026-10-19T11:00:00.000Z" }), checkin(3, { createdAt: "2026-10-19T09:00:00.000Z" })];
  assert.deepEqual(latestCheckins(items, 2).map((c) => c.id), [ID(2), ID(3)]);
});

test("the dashboard card shows for a duo or a waiting invite only", () => {
  const incoming = { id: ID(9), direction: "incoming", handle: "USER // ASH-3", isCodename: true, createdAt: "2026-10-19T10:00:00.000Z" } as const;
  const outgoing = { ...incoming, direction: "outgoing" } as const;
  assert.equal(hasDuoActivity(undefined), false);
  assert.equal(hasDuoActivity(view()), false);
  assert.equal(hasDuoActivity(view({ pendingInvites: [outgoing] })), false);
  assert.equal(hasDuoActivity(view({ pendingInvites: [incoming] })), true);
  assert.equal(hasDuoActivity(view({ partner })), true);
  assert.deepEqual(incomingInvites(view({ pendingInvites: [incoming, outgoing] })), [incoming]);
});

test("fetchDuo parses the duo view; mutations send the client id after the outbox", async () => {
  const { api, calls } = fakeApi((c) => {
    if (c.path === "/api/duo/checkin") return checkin(1, { fromMe: true });
    if (c.path === "/api/duo/invite") return { id: ID(5), direction: "outgoing", handle: "yuri_1", isCodename: false, createdAt: "2026-10-19T10:00:00.000Z" };
    if (c.path.includes("/invites/")) return view({ partner });
    if (c.path === "/api/duo/leave") return null;
    return view({ partner, checkins: [checkin(1)] });
  });
  assert.equal((await fetchDuo(api)).partner?.handle, "yuri_1");
  const inv = await inviteToDuo(api, synced, " yuri_1 ", "c1");
  assert.equal(inv.ok && inv.value.handle, "yuri_1");
  assert.deepEqual(calls[1]!.opts.body, { username: "yuri_1", clientId: "c1" });
  assert.equal(calls[1]!.opts.idempotencyKey, "c1");
  const acc = await answerDuoInvite(api, synced, ID(5), "accept", "c2");
  assert.equal(acc.ok && acc.value.partner?.handle, "yuri_1");
  assert.equal(calls[2]!.path, `/api/duo/invites/${ID(5)}/accept`);
  await answerDuoInvite(api, synced, ID(5), "decline", "c3");
  assert.equal(calls[3]!.path, `/api/duo/invites/${ID(5)}/decline`);
  const ck = await sendDuoCheckin(api, synced, "going_now", "c4");
  assert.equal(ck.ok && ck.value.kind, "going_now");
  assert.deepEqual(calls[4]!.opts.body, { kind: "going_now", clientId: "c4" });
  await leaveDuo(api, synced, "c5");
  assert.equal(calls[5]!.path, "/api/duo/leave");
});

test("a stuck outbox sends nothing", async () => {
  const { api, calls } = fakeApi(() => view());
  const r = await sendDuoCheckin(api, stuck, "done", "c1");
  assert.deepEqual(r, { ok: false, reason: "sync_pending" });
  assert.equal((await leaveDuo(api, stuck, "c2")).ok, false);
  assert.equal(calls.length, 0);
});

test("errors read in the SYSTEM voice", () => {
  assert.equal(describeDuoError(http(429, "nudge_limit")), "3 nudges a day is the limit. Logged.");
  assert.equal(describeDuoError(http(409, "already_in_duo")), "A Party of Two is already formed. One partner at a time.");
  assert.equal(describeDuoError(http(409, "invite_open")), "An invite between you is already open.");
  assert.equal(describeDuoError(http(409, "not_pending")), "That invite is no longer open.");
  assert.equal(describeDuoError(http(404, "not_in_duo")), "You are not in a Party of Two.");
  assert.equal(describeDuoError(http(404, "not_found")), "Player not found.");
  assert.equal(describeDuoError(http(500)), "The system is unavailable. Retry shortly.");
  assert.equal(describeDuoError(new ApiError({ kind: "network", message: "x" })), "No connection. Check your signal and retry.");
  assert.equal(describeDuoError(new Error("x")), "The request failed. Retry.");
});
