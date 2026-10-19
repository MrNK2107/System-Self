import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiClient } from "../api/client";
import {
  VOICE_CONTENT_TYPE,
  VOICE_MAX_MS,
  describeFreeformError,
  parseText,
  proposalSummary,
  proposalToFormValues,
  proposalToLogInput,
  sendVoice,
} from "./freeform";
import { buildLogRequest } from "../game/actions";
import { checkLogForm } from "../game/log-form";

const proposal = { domain: "BODY" as const, logType: "sleep", data: { hours: 6, quality: 3 }, confidence: 0.85 };

function fakeApi(response: unknown) {
  const calls: { method: string; path: string; opts: any }[] = [];
  const api = {
    async request(method: string, path: string, opts: any = {}) {
      calls.push({ method, path, opts });
      return opts.schema ? opts.schema.parse(response) : response;
    },
  } as unknown as ApiClient;
  return { api, calls };
}

test("parseText posts the trimmed text and returns the proposals", async () => {
  const { api, calls } = fakeApi({ proposals: [proposal] });
  assert.deepEqual(await parseText(api, "  slept 6 hours "), [proposal]);
  assert.deepEqual([calls[0]!.method, calls[0]!.path, calls[0]!.opts.body], ["POST", "/api/logs/parse", { text: "slept 6 hours" }]);
});

test("sendVoice uploads the recording as m4a with a long timeout and returns transcript and proposals", async () => {
  const { api, calls } = fakeApi({ transcript: "slept six hours", proposals: [proposal] });
  const audio = new ArrayBuffer(8);
  const out = await sendVoice(api, audio);
  assert.deepEqual(out, { transcript: "slept six hours", proposals: [proposal] });
  assert.equal(calls[0]!.path, "/api/logs/voice");
  assert.deepEqual(calls[0]!.opts.binary, { body: audio, contentType: VOICE_CONTENT_TYPE });
  assert.ok(calls[0]!.opts.timeoutMs >= 60_000);
  assert.equal(VOICE_MAX_MS, 120_000);
});

test("a confirmed proposal becomes an outbox log carrying the original text as freeText (capped at 2000)", () => {
  const input = proposalToLogInput(proposal, "slept 6 hours and read 30 pages");
  assert.deepEqual(input, { domain: "BODY", type: "sleep", data: { hours: 6, quality: 3 }, note: "slept 6 hours and read 30 pages" });
  const entry = buildLogRequest(input, "c1", new Date("2026-03-10T08:00:00Z"));
  assert.equal(entry.path, "/api/logs");
  assert.equal((entry.body as { freeText: string }).freeText, "slept 6 hours and read 30 pages");
  const long = buildLogRequest(proposalToLogInput(proposal, "x".repeat(2500)), "c2");
  assert.equal((long.body as { freeText: string }).freeText.length, 2000);
});

test("edit prefill: the form values pass the same check the structured form runs", () => {
  const values = proposalToFormValues(proposal);
  assert.deepEqual(values, { hours: 6, quality: 3 });
  assert.equal(checkLogForm("BODY", "sleep", values).ok, true);
  const exp = proposalToFormValues({ domain: "WEALTH", logType: "expense", data: { amount: 450, category: "food" }, confidence: 1 });
  assert.deepEqual(exp, { amount: 450, category: "food" });
  assert.equal(checkLogForm("WEALTH", "expense", exp).ok, true);
  // Non-scalar data is not prefilled.
  assert.deepEqual(proposalToFormValues({ ...proposal, data: { hours: 6, nested: { a: 1 } } }), { hours: 6 });
});

test("proposal summary names the domain and the entry", () => {
  assert.equal(proposalSummary(proposal), "BODY // Sleep 6h · quality 3");
  assert.equal(
    proposalSummary({ domain: "MIND", logType: "reading", data: { pages: 30 }, confidence: 1 }),
    "MIND // Read 30 pages",
  );
});

test("error copy for limits, size, length and an unavailable AI; PRO is left to the lock", () => {
  const http = (status: number, code?: string) => new ApiError({ kind: "http", status, code, message: "x" });
  assert.match(describeFreeformError(http(429, "parse_limit")), /30/);
  assert.match(describeFreeformError(http(429, "voice_limit")), /10/);
  assert.match(describeFreeformError(http(503, "ai_unavailable")), /type/i);
  assert.match(describeFreeformError(http(413, "audio_too_large")), /too long|large/i);
  assert.match(describeFreeformError(http(422, "audio_too_long")), /120/);
  assert.match(describeFreeformError(new ApiError({ kind: "network", message: "x" })), /connection/i);
  assert.match(describeFreeformError(new Error("boom")), /retry/i);
});
