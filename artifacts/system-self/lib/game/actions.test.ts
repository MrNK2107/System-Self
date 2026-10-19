import assert from "node:assert/strict";
import { test } from "node:test";
import { LogRequestSchema } from "@workspace/contracts";
import { ApiError, type ApiClient, type RequestOptions } from "../api/client";
import { createOutbox, type KeyValueStorage } from "../api/outbox";
import {
  buildLogRequest,
  completeQuest,
  discardFailedEntries,
  enqueueLog,
  fetchComeback,
  fetchGameState,
  fetchNotices,
  setHomePath,
  markNoticesSeen,
  newClientId,
  refuseQuest,
  retryFailedEntries,
  startChain,
  validGameState,
} from "./actions";
import { NOTICE_KINDS_PARAM } from "./notices";
import { chainsKey, comebackKey, deferralsKey, gameStateKey, invalidateGame, logsKey, noticesKey, questsKey, shadowTakeoversKey } from "./keys";

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

interface Call {
  method: string;
  path: string;
  opts: RequestOptions<unknown>;
}

function fakeApi(reply: (c: Call) => unknown): ApiClient & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async request<T>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
      const call = { method, path, opts: opts as RequestOptions<unknown> };
      calls.push(call);
      const body = reply(call);
      if (opts.schema) {
        const parsed = opts.schema.safeParse(body);
        if (!parsed.success) throw new ApiError({ kind: "parse", message: `Unexpected response from ${path}` });
        return parsed.data;
      }
      return body as T;
    },
  };
}

const NOW = new Date("2026-10-19T10:00:00.000Z");

test("buildLogRequest builds a contract-valid POST /api/logs outbox entry", () => {
  const entry = buildLogRequest({ domain: "SOCIAL", type: "conversation", note: "  called my brother  ", intensity: 4 }, "c-1", NOW);
  assert.equal(entry.clientId, "c-1");
  assert.equal(entry.method, "POST");
  assert.equal(entry.path, "/api/logs");
  assert.deepEqual(entry.body, {
    clientId: "c-1",
    domain: "SOCIAL",
    logType: "conversation",
    data: { intensity: 4 },
    freeText: "called my brother",
    forbidden: false,
    occurredAt: "2026-10-19T10:00:00.000Z",
  });
  assert.ok(LogRequestSchema.safeParse(entry.body).success);

  const bare = buildLogRequest({ domain: "BODY", type: "workout", forbidden: true, note: "   " }, "c-2", NOW);
  assert.equal((bare.body as { freeText?: string }).freeText, undefined);
  assert.equal((bare.body as { forbidden: boolean }).forbidden, true);
  assert.ok(LogRequestSchema.safeParse(bare.body).success);
});

test("enqueueLog queues the log in the outbox (no network until flush)", async () => {
  const sent: string[] = [];
  const outbox = createOutbox({ storage: memoryStorage(), getUserId: async () => "u1", send: async (i) => void sent.push(i.clientId) });
  const entry = await enqueueLog(outbox, { domain: "BODY", type: "workout" }, "c-9");
  assert.equal(entry.clientId, "c-9");
  assert.deepEqual(outbox.pending().map((i) => i.clientId), ["c-9"]);
  assert.deepEqual(sent, []);
});

test("newClientId returns distinct non-empty ids", () => {
  const a = newClientId("log");
  const b = newClientId("log");
  assert.ok(a.startsWith("log-") && a.length > 8);
  assert.notEqual(a, b);
});

const questDto = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "daily",
  title: "Walk",
  description: "d",
  domain: "BODY",
  status: "complete",
  expiresAt: "2026-10-19T23:59:59.000Z",
  resolvedAt: "2026-10-19T10:00:00.000Z",
  chainId: null,
  chainStep: null,
  chainTotal: null,
  refusalReason: null,
  slotStart: null,
  slotEnd: null,
  slotState: "none",
  createdAt: "2026-10-19T00:00:00.000Z",
};

test("quest and chain mutations flush the outbox first and are not sent while older logs are stuck", async () => {
  let offline = true;
  const order: string[] = [];
  const outbox = createOutbox({
    storage: memoryStorage(),
    getUserId: async () => "u1",
    send: async (i) => {
      if (offline) throw new ApiError({ kind: "network", message: "offline" });
      order.push(`log:${i.clientId}`);
    },
  });
  const api = fakeApi((c) => {
    order.push(`${c.method} ${c.path}`);
    if (c.path.endsWith("/complete")) return { quest: questDto, results: [], notices: [{ id: "x", kind: "future_kind" }] };
    if (c.path.endsWith("/refuse")) return { quest: { ...questDto, status: "refused" }, penalty: 0, results: [], notices: [], floor: null, shadowTook: null };
    return {
      chain: {
        id: "c1",
        templateKey: "discipline_forge",
        name: "DISCIPLINE FORGE",
        domain: "DISCIPLINE",
        currentStep: 0,
        totalSteps: 3,
        status: "active",
        startedAt: "2026-10-19T10:00:00.000Z",
      },
      quest: { ...questDto, status: "active" },
    };
  });

  await enqueueLog(outbox, { domain: "BODY", type: "workout" }, "older-log");
  const blocked = await completeQuest(api, outbox, questDto.id, "cq-1");
  assert.deepEqual(blocked, { ok: false, reason: "sync_pending" });
  assert.equal(api.calls.length, 0, "nothing sent ahead of the queued log");

  offline = false;
  const done = await completeQuest(api, outbox, questDto.id, "cq-1");
  assert.equal(done.ok, true);
  assert.deepEqual(order, ["log:older-log", `POST /api/quests/${questDto.id}/complete`]);
  const call = api.calls[0]!;
  assert.equal(call.opts.idempotencyKey, "cq-1");
  assert.deepEqual(call.opts.body, { clientId: "cq-1" });

  const refused = await refuseQuest(api, outbox, questDto.id, "  too tired  ", "rq-1");
  assert.equal(refused.ok, true);
  assert.deepEqual(api.calls[1]!.opts.body, { reason: "too tired", clientId: "rq-1" });

  const chain = await startChain(api, outbox, "discipline_forge", "ch-1");
  assert.equal(chain.ok, true);
  assert.equal(api.calls[2]!.path, "/api/chains");
  assert.deepEqual(api.calls[2]!.opts.body, { templateKey: "discipline_forge", clientId: "ch-1" });
});

const state = {
  profile: {
    username: "alpha",
    codename: "GHOST // AB1-2",
    rank: "E",
    rankSince: "2026-10-01T00:00:00.000Z",
    identitySetting: "semi-public",
    primaryGoal: "Build a routine",
    biggestWeakness: "SOCIAL",
    morningTime: "07:00",
    nightlyTime: "21:00",
    dayNumber: 1,
    onboarded: true,
    homePathActive: false, lifeContext: "student", season: null,
  },
  scores: [{ domain: "BODY", score: 20, streak: 0, lastLogDate: null }],
  tierProgress: 40,
  trajectory: "stable",
  shadow: null,
  unseenNotices: [{ id: "n1", kind: "kind_from_the_future", payload: {}, createdAt: "2026-10-19T00:00:00.000Z" }],
  hasMoreNotices: false,
  achievements: [],
  milestones: [],
  today: "2026-10-19",
};

test("fetchGameState accepts notice kinds this build does not know (they are skipped later, not a parse error)", async () => {
  const api = fakeApi(() => state);
  const s = await fetchGameState(api);
  // Always asks only for the kinds this build renders, so an old client never starves on newer kinds.
  assert.equal(api.calls[0]!.path, `/api/state?noticeKinds=${NOTICE_KINDS_PARAM}`);
  assert.equal(s.unseenNotices.length, 1);
  assert.equal(s.tierProgress, 40);
});

test("fetchNotices and markNoticesSeen use GET /api/notices and POST /api/notices/seen (uuid ids only)", async () => {
  const api = fakeApi((c) => (c.method === "GET" ? { items: [{ id: "n", kind: "nope" }], hasMore: true } : null));
  const page = await fetchNotices(api);
  assert.equal(api.calls[0]!.path, `/api/notices?kinds=${NOTICE_KINDS_PARAM}`);
  assert.equal(page.hasMore, true);
  assert.equal(page.items.length, 1);

  const uuid = "22222222-2222-4222-8222-222222222222";
  await markNoticesSeen(api, [uuid, "not-a-uuid"], "seen-1");
  const call = api.calls[1]!;
  assert.equal(call.method, "POST");
  assert.equal(call.path, "/api/notices/seen");
  assert.deepEqual(call.opts.body, { ids: [uuid], clientId: "seen-1" });
  assert.equal(call.opts.idempotencyKey, "seen-1");

  await markNoticesSeen(api, ["junk"], "seen-2");
  assert.equal(api.calls.length, 2, "nothing to send when no id is valid");
});

test("markNoticesSeen sends more than 100 ids in chunks and reports exactly the ids it handled", async () => {
  const ids = Array.from({ length: 230 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const api = fakeApi(() => null);
  const ok = await markNoticesSeen(api, [...ids, "junk"], "seen-x");
  assert.equal(ok.error, null);
  assert.deepEqual(api.calls.map((c) => (c.opts.body as { ids: string[] }).ids.length), [100, 100, 30]);
  assert.equal(new Set(api.calls.map((c) => (c.opts.body as { clientId: string }).clientId)).size, 3, "one idempotency key per chunk");
  assert.equal(ok.handled.length, 231, "junk ids can never be sent, so they are handled too");

  // The second chunk fails: only the first chunk (plus junk) is reported as handled.
  let n = 0;
  const flaky = fakeApi(() => {
    if (++n === 2) throw new ApiError({ kind: "network", message: "down" });
    return null;
  });
  const partial = await markNoticesSeen(flaky, [...ids, "junk"], "seen-y");
  assert.ok(partial.error);
  assert.deepEqual(partial.handled.sort(), [...ids.slice(0, 100), "junk"].sort());
});

test("retryFailedEntries re-queues failed items; discardFailedEntries drops them", async () => {
  let reject = true;
  const outbox = createOutbox({
    storage: memoryStorage(),
    getUserId: async () => "u1",
    send: async () => {
      if (reject) throw new ApiError({ kind: "http", status: 422, message: "too old" });
    },
  });
  await enqueueLog(outbox, { domain: "BODY", type: "workout" }, "a");
  await enqueueLog(outbox, { domain: "MIND", type: "reading" }, "b");
  await outbox.flush();
  assert.equal(outbox.failed().length, 2);

  assert.equal(await retryFailedEntries(outbox), 2);
  assert.equal(outbox.failed().length, 0);
  assert.deepEqual(outbox.pending().map((i) => i.clientId), ["a", "b"]);

  await outbox.flush();
  assert.equal(outbox.failed().length, 2);
  await discardFailedEntries(outbox);
  assert.equal(outbox.failed().length, 0);
  assert.equal(outbox.pending().length, 0);
  reject = false;
});

test("invalidateGame invalidates state, quests and notices (plus logs, chains and the ledger views) for the user", async () => {
  const keys: unknown[] = [];
  await invalidateGame({ invalidateQueries: async (f: { queryKey: readonly unknown[] }) => void keys.push(f.queryKey) }, "u1");
  assert.deepEqual(keys, [gameStateKey("u1"), questsKey("u1"), noticesKey("u1"), logsKey("u1"), chainsKey("u1"), deferralsKey("u1"), shadowTakeoversKey("u1"), comebackKey("u1")]);
});

test("validGameState passes a contract-valid cached state through unchanged and rejects a stale shape", () => {
  assert.equal(validGameState(state), state);
  const { tierProgress: _gone, ...stale } = state;
  assert.equal(validGameState(stale), undefined);
  assert.equal(validGameState({ ...state, scores: "nope" }), undefined);
  assert.equal(validGameState(undefined), undefined);
});

test("fetchComeback reads GET /api/comeback", async () => {
  const api = fakeApi(() => ({ active: { gapDays: 6, checklist: [{ key: "body_session", label: "Log one BODY session", done: false }] }, returnerCount: 1 }));
  const c = await fetchComeback(api);
  assert.equal(api.calls[0]!.path, "/api/comeback");
  assert.equal(c.active?.gapDays, 6);
  assert.equal(c.returnerCount, 1);
});

test("setHomePath flushes the outbox first, then POSTs the flag with an idempotency key", async () => {
  const profile = {
    username: "a", codename: "C", rank: "E", rankSince: "2026-10-01T00:00:00.000Z", identitySetting: "anonymous",
    primaryGoal: "Build a disciplined life", biggestWeakness: "BODY", morningTime: "07:00", nightlyTime: "21:00",
    dayNumber: 1, onboarded: true, homePathActive: true, lifeContext: "student", season: null,
  };
  const api = fakeApi(() => profile);
  const blocked = await setHomePath(api, { flushBeforeMutation: async () => false }, true, "hp-0");
  assert.deepEqual(blocked, { ok: false, reason: "sync_pending" });
  assert.equal(api.calls.length, 0);
  const res = await setHomePath(api, { flushBeforeMutation: async () => true }, true, "hp-1");
  assert.equal(res.ok && res.value.homePathActive, true);
  assert.equal(api.calls[0]!.method, "POST");
  assert.equal(api.calls[0]!.path, "/api/profile/home-path");
  assert.deepEqual(api.calls[0]!.opts.body, { active: true, clientId: "hp-1" });
  assert.equal(api.calls[0]!.opts.idempotencyKey, "hp-1");
});
