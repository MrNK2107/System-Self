import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, type ApiClient, type RequestOptions } from "../api/client";
import {
  CROWD_OPTIONS,
  CROWD_PROMPT,
  briefingHeader,
  briefingRowMeta,
  fallbackLine,
  fetchBriefing,
  fetchQuietHours,
  quietChips,
  quietHint,
  submitCrowdReport,
} from "./dungeon";

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
  } as ApiClient;
  return { api, calls };
}

const block = {
  exerciseId: "ex_bench",
  name: "Bench Press",
  sets: 3,
  repRange: "5-8",
  restSec: 120,
  howTo: "Shoulder blades pinched.",
  fallbacks: [
    { exerciseId: "ex_db_press", name: "Dumbbell Bench Press" },
    { exerciseId: "ex_pushup", name: "Push-up" },
  ],
};

test("header names the weekday of the briefing date", () => {
  assert.equal(briefingHeader("2026-10-19"), "DUNGEON BRIEFING — MONDAY");
  assert.equal(briefingHeader("2026-10-25"), "DUNGEON BRIEFING — SUNDAY");
});

test("fallback line joins names with ' / ' and is absent without fallbacks", () => {
  assert.equal(fallbackLine(block), "If taken: Dumbbell Bench Press / Push-up");
  assert.equal(fallbackLine({ ...block, fallbacks: [{ exerciseId: "ex_pushup", name: "Push-up" }] }), "If taken: Push-up");
  assert.equal(fallbackLine({ ...block, fallbacks: [] }), null);
});

test("row meta: sets x reps and rest", () => {
  assert.equal(briefingRowMeta(block), "3 x 5-8 · rest 120s");
});

test("crowd sheet copy", () => {
  assert.equal(CROWD_PROMPT, "How crowded was it?");
  assert.deepEqual(CROWD_OPTIONS.map((o) => o.label), ["QUIET", "NORMAL", "PACKED", "SKIP"]);
  assert.deepEqual(CROWD_OPTIONS.map((o) => o.level), ["quiet", "normal", "packed", null]);
});

test("quiet chips label weekday and hour; hint only while reports are needed", () => {
  assert.deepEqual(quietChips([{ weekday: 2, hour: 7, quietShare: 1 }, { weekday: 0, hour: 18, quietShare: 0.5 }]), [
    { label: "TUE 07:00", start: "07:00" },
    { label: "SUN 18:00", start: "18:00" },
  ]);
  assert.deepEqual(quietChips([]), []);
  assert.equal(quietHint({ suggestions: [], needed: 2 }), "2 more scout reports needed");
  assert.equal(quietHint({ suggestions: [], needed: 1 }), "1 more scout report needed");
  assert.equal(quietHint({ suggestions: [], needed: 0 }), null);
  assert.equal(quietHint(undefined), null);
});

test("fetchBriefing and fetchQuietHours read the gym endpoints", async () => {
  const { api, calls } = fakeApi((_m, path) =>
    path.includes("briefing")
      ? { date: "2026-10-19", source: "plan", blocks: [block], estimatedMinutes: 8 }
      : { suggestions: [{ weekday: 2, hour: 7, quietShare: 1 }], needed: 0 },
  );
  assert.equal((await fetchBriefing(api)).blocks[0]!.name, "Bench Press");
  await fetchBriefing(api, "2026-10-20");
  assert.equal((await fetchQuietHours(api)).suggestions.length, 1);
  assert.deepEqual(calls.map((c) => c.path), [
    "/api/gym/briefing",
    "/api/gym/briefing?date=2026-10-20",
    "/api/gym/quiet-hours",
  ]);
});

test("submitCrowdReport posts after the outbox flushes, idempotent on its clientId", async () => {
  const { api, calls } = fakeApi(() => ({ ok: true, weekday: 1, hour: 18 }));
  const r = await submitCrowdReport(api, { flushBeforeMutation: async () => true }, "quiet", "sess-1", "crowd-sess-1");
  assert.equal(r.ok, true);
  assert.deepEqual(calls.map((c) => [c.method, c.path]), [["POST", "/api/gym/crowd"]]);
  assert.deepEqual(calls[0]!.opts.body, { level: "quiet", sessionId: "sess-1", clientId: "crowd-sess-1" });
  assert.equal(calls[0]!.opts.idempotencyKey, "crowd-sess-1");
});

test("submitCrowdReport sends nothing while queued logs cannot flush, and omits a missing session", async () => {
  const blocked = fakeApi(() => ({ ok: true, weekday: 1, hour: 18 }));
  const r = await submitCrowdReport(blocked.api, { flushBeforeMutation: async () => false }, "packed", undefined, "c1");
  assert.deepEqual(r, { ok: false, reason: "sync_pending" });
  assert.equal(blocked.calls.length, 0);
  const open = fakeApi(() => ({ ok: true, weekday: 1, hour: 18 }));
  await submitCrowdReport(open.api, { flushBeforeMutation: async () => true }, "packed", undefined, "c2");
  assert.deepEqual(open.calls[0]!.opts.body, { level: "packed", clientId: "c2" });
});
