import assert from "node:assert/strict";
import { test } from "node:test";
import { FLOOR_ROUTINES } from "@workspace/engine";
import { ApiError, type ApiClient, type RequestOptions } from "../api/client";
import { createOutbox, type KeyValueStorage } from "../api/outbox";
import { buildLogRequest, enqueueLog, refuseQuest } from "./actions";
import {
  LEDGER_HEADER,
  REASON_MAX,
  fetchDeferrals,
  fetchShadowTakeovers,
  floorHeader,
  floorLogInput,
  floorProgress,
  ledgerLine,
  normalizeReason,
  shadowTallyLine,
} from "./adherence";

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

function fakeApi(reply: (method: string, path: string) => unknown) {
  const calls: { method: string; path: string; opts: RequestOptions<unknown> }[] = [];
  const api: ApiClient = {
    async request<T>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
      calls.push({ method, path, opts: opts as RequestOptions<unknown> });
      const body = reply(method, path);
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

test("normalizeReason trims, caps at 200 and rejects blank", () => {
  assert.equal(normalizeReason("  too tired "), "too tired");
  assert.equal(normalizeReason("   "), null);
  assert.equal(normalizeReason(""), null);
  assert.equal(normalizeReason("x".repeat(300))!.length, REASON_MAX);
});

test("exact copy strings", () => {
  assert.equal(floorHeader(12), "NOT THE GYM. 12 MINUTES. HERE. NOW.");
  assert.equal(LEDGER_HEADER, "DEFERRAL LEDGER");
  assert.equal(
    ledgerLine({ localDate: "2026-10-19", reason: "too tired", questTitle: "Push Day" }),
    '2026-10-19 — "too tired" — Push Day',
  );
  assert.equal(shadowTallyLine("Push Day"), "SHADOW completed: Push Day. You did not.");
});

test("floorProgress walks the steps by elapsed seconds", () => {
  const r = { id: "t", title: "T", minutes: 1, steps: [{ name: "a", seconds: 30 }, { name: "b", seconds: 30 }] };
  assert.deepEqual(floorProgress(r, 0), { stepIndex: 0, stepRemaining: 30, totalRemaining: 60, done: false });
  assert.deepEqual(floorProgress(r, 31), { stepIndex: 1, stepRemaining: 29, totalRemaining: 29, done: false });
  assert.deepEqual(floorProgress(r, 60), { stepIndex: 1, stepRemaining: 0, totalRemaining: 0, done: true });
  assert.equal(floorProgress(r, 500).done, true);
  assert.equal(floorProgress(r, -5).stepIndex, 0);
});

test("a floor session is queued in the outbox as an ordinary BODY log with a clientId", async () => {
  const routine = FLOOR_ROUTINES[0]!;
  const input = floorLogInput(routine);
  assert.deepEqual(input, { domain: "BODY", type: "floor_session", data: { routineId: routine.id, minutes: routine.minutes } });
  const entry = buildLogRequest(input, "f-1", new Date("2026-10-19T10:00:00Z"));
  assert.equal(entry.path, "/api/logs");
  assert.deepEqual(entry.body, {
    clientId: "f-1",
    domain: "BODY",
    logType: "floor_session",
    data: { routineId: routine.id, minutes: routine.minutes },
    forbidden: false,
    occurredAt: "2026-10-19T10:00:00.000Z",
  });
  const sent: unknown[] = [];
  const outbox = createOutbox({ storage: memoryStorage(), getUserId: async () => "u1", send: async (i) => void sent.push(i) });
  await outbox.ready();
  const queued = await enqueueLog(outbox, input, "f-2");
  assert.equal(queued.clientId, "f-2");
  assert.equal(outbox.pending().length, 1);
});

test("refuseQuest sends the required trimmed reason and returns the floor offer", async () => {
  const { api, calls } = fakeApi(() => ({
    quest: {
      id: "q1", type: "daily", title: "Push Day", description: "d", domain: "BODY", status: "refused",
      expiresAt: "2026-10-19T20:00:00.000Z", resolvedAt: "2026-10-19T10:00:00.000Z", chainId: null, chainStep: null,
      chainTotal: null, refusalReason: "tomorrow", createdAt: "2026-10-19T00:00:00.000Z",
    },
    penalty: 0,
    results: [],
    notices: [],
    floor: FLOOR_ROUTINES[0],
    shadowTook: { questTitle: "Push Day" },
  }));
  const outbox = { flushBeforeMutation: async () => true };
  const r = await refuseQuest(api, outbox, "q1", "  tomorrow ", "rq-1");
  assert.ok(r.ok);
  assert.deepEqual(calls[0]!.opts.body, { reason: "tomorrow", clientId: "rq-1" });
  assert.equal(r.value.floor?.id, FLOOR_ROUTINES[0]!.id);
  assert.deepEqual(r.value.shadowTook, { questTitle: "Push Day" });
  await assert.rejects(() => refuseQuest(api, outbox, "q1", "   ", "rq-2"), /reason/i);
  assert.equal(calls.length, 1);
});

test("fetchDeferrals and fetchShadowTakeovers read the adherence endpoints", async () => {
  const { api, calls } = fakeApi((_m, path) =>
    path.includes("deferrals")
      ? { items: [{ questTitle: "Push Day", domain: "BODY", reason: "x", localDate: "2026-10-19" }], countThisWeek: 1 }
      : { items: [{ questTitle: "Push Day", localDate: "2026-10-19" }], count: 1 },
  );
  assert.equal((await fetchDeferrals(api, 30)).countThisWeek, 1);
  assert.equal((await fetchShadowTakeovers(api)).count, 1);
  assert.deepEqual(calls.map((c) => c.path), ["/api/adherence/deferrals?days=30", "/api/adherence/shadow-takeovers?days=30"]);
});
