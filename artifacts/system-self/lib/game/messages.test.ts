import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, type ApiClient } from "../api/client";
import {
  ackDebrief,
  fallbackMessage,
  fetchDebriefToday,
  fetchMessage,
  msUntilLocalMidnight,
  toDebriefData,
} from "./messages";

const META = { promptVersion: "v1", model: "template", attempts: 1 };

function fakeApi(handler: (method: string, path: string, body: unknown) => unknown): { api: ApiClient; calls: string[] } {
  const calls: string[] = [];
  const api: ApiClient = {
    async request(method, path, opts) {
      calls.push(`${method} ${path}`);
      const out = handler(method, path, opts?.body);
      return (opts?.schema ? opts.schema.parse(out) : out) as never;
    },
  };
  return { api, calls };
}
const httpError = (status: number, code: string) => new ApiError({ kind: "http", status, code, message: code });

test("fetchMessage posts the type (and the note) and returns the server text", async () => {
  let sent: unknown;
  const { api } = fakeApi((_m, _p, body) => {
    sent = body;
    return { message: "Day 1. Noted.", meta: META };
  });
  assert.equal(await fetchMessage(api, "morning_briefing"), "Day 1. Noted.");
  assert.deepEqual(sent, { type: "morning_briefing" });
  await fetchMessage(api, "rival_taunt", { extraContext: "Rival: X" });
  assert.deepEqual(sent, { type: "rival_taunt", extraContext: "Rival: X" });
});

test("429 message_limit, 409 debrief_unavailable and network errors fall back silently", async () => {
  for (const err of [httpError(429, "message_limit"), httpError(409, "debrief_unavailable"), new ApiError({ kind: "network", message: "x" })]) {
    const { api } = fakeApi(() => {
      throw err;
    });
    assert.equal(await fetchMessage(api, "failure_response"), fallbackMessage("failure_response"));
  }
});

test("every message type has a fallback string in SYSTEM voice (no exclamation marks)", () => {
  for (const type of ["morning_briefing", "nightly_debrief", "quest_assignment", "rank_change", "shadow_self", "milestone",
    "failure_response", "streak_break", "shadow_confrontation", "rival_taunt", "chain_complete", "domain_milestone",
    "forbidden_log", "rank_up_prep", "weekly_debrief"] as const) {
    const s = fallbackMessage(type);
    assert.ok(s.length > 0 && !s.includes("!"), type);
  }
});

test("msUntilLocalMidnight counts to the next local midnight", () => {
  const now = new Date(2026, 9, 19, 23, 0, 0);
  assert.equal(msUntilLocalMidnight(now), 60 * 60 * 1000);
  assert.ok(msUntilLocalMidnight(new Date(2026, 9, 19, 0, 0, 0)) > 0);
});

test("fetchDebriefToday parses both shapes; toDebriefData adds the shadow gap", async () => {
  const deltas = { BODY: 1, MIND: 0, WEALTH: 0, SOCIAL: 0, DISCIPLINE: 2 };
  const closed = fakeApi(() => ({ available: false, availableAt: "2026-10-19T20:00:00.000Z" }));
  assert.deepEqual(await fetchDebriefToday(closed.api), { available: false, availableAt: "2026-10-19T20:00:00.000Z" });
  const open = fakeApi(() => ({
    available: true,
    debrief: { date: "2026-10-19", deltas, questCompleted: 1, questTotal: 2, verdict: "ACCEPTABLE", text: "Closed.", acknowledged: false },
  }));
  const r = await fetchDebriefToday(open.api);
  assert.ok(r.available);
  const d = toDebriefData(r.debrief, 4.5);
  assert.equal(d.aiText, "Closed.");
  assert.equal(d.shadowGap, 4.5);
  assert.equal(d.domainDeltas.DISCIPLINE, 2);
});

test("ackDebrief flushes the outbox first and blocks while it cannot", async () => {
  const { api, calls } = fakeApi(() => null);
  const blocked = await ackDebrief(api, { flushBeforeMutation: async () => false }, "2026-10-19", "ack-1");
  assert.deepEqual(blocked, { ok: false, reason: "sync_pending" });
  assert.deepEqual(calls, []);
  const sent = await ackDebrief(api, { flushBeforeMutation: async () => true }, "2026-10-19", "ack-1");
  assert.equal(sent.ok, true);
  assert.deepEqual(calls, ["POST /api/debrief/2026-10-19/ack"]);
});
