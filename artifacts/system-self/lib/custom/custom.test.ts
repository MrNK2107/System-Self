import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiClient } from "../api/client";
import { isProRequired } from "../api/pro";
import type { OutboxItem } from "../api/outbox";
import {
  archiveCustomDomain,
  buildCustomLogRequest,
  checkCustomDomainForm,
  checkCustomLogForm,
  createCustomDomain,
  customDomainsKey,
  customLimitLine,
  customRootKeys,
  describeCustomError,
  enqueueCustomLog,
  pendingCustomLogs,
  progressLine,
  updateCustomDomain,
} from "./custom";

const synced = { flushBeforeMutation: async () => true };
const stuck = { flushBeforeMutation: async () => false };
const ID = "11111111-1111-4111-8111-111111111111";

const domain = {
  id: ID,
  name: "Language",
  unit: "min",
  logLabel: "Study",
  baseline: 0,
  target: 60,
  isPublic: false,
  archived: false,
  score: 52.5,
  streak: 1,
  lastLogDate: "2026-03-10",
  latestValue: 15,
};

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

const httpError = (status: number, code?: string) => new ApiError({ kind: "http", status, code, message: "x" });

test("query keys are scoped to the user and share a root", () => {
  assert.deepEqual(customDomainsKey("u1"), ["custom-domains", "u1"]);
  assert.deepEqual(customRootKeys("u1"), [["custom-domains", "u1"]]);
});

test("the create/edit form: trims, 1-24 name, unit <= 12, label <= 40, numeric baseline and target", () => {
  const ok = checkCustomDomainForm({ name: " Language ", unit: " min ", logLabel: "", baseline: "0", target: "1,200.5", isPublic: true });
  assert.deepEqual(ok, { ok: true, input: { name: "Language", unit: "min", logLabel: "Log", baseline: 0, target: 1200.5, isPublic: true } });
  const bad = (over: Partial<Parameters<typeof checkCustomDomainForm>[0]>) =>
    checkCustomDomainForm({ name: "A", unit: "", logLabel: "Log", baseline: "0", target: "10", isPublic: false, ...over });
  assert.equal(bad({ name: "  " }).ok, false);
  assert.equal(bad({ name: "x".repeat(25) }).ok, false);
  assert.equal(bad({ unit: "u".repeat(13) }).ok, false);
  assert.equal(bad({ logLabel: "l".repeat(41) }).ok, false);
  assert.equal(bad({ baseline: "abc" }).ok, false);
  assert.equal(bad({ target: "" }).ok, false);
  assert.equal(bad({ baseline: "-5", target: "-1" }).ok, true, "negative numbers are allowed (a debt to clear)");
  assert.match((bad({ name: "" }) as { message: string }).message, /name/i);
});

test("the log form: a number and an optional note of at most 200 characters", () => {
  assert.deepEqual(checkCustomLogForm("12.5", " calm "), { ok: true, value: 12.5, note: "calm" });
  assert.deepEqual(checkCustomLogForm("-3", ""), { ok: true, value: -3, note: undefined });
  assert.equal(checkCustomLogForm("", "").ok, false);
  assert.equal(checkCustomLogForm("ten", "").ok, false);
  assert.equal(checkCustomLogForm("1", "n".repeat(201)).ok, false);
});

test("a custom log request carries the clientId, the value and a note, to the domain's own path", () => {
  const now = new Date("2026-03-10T08:00:00Z");
  const entry = buildCustomLogRequest(ID, { value: 15, note: "  deep work " }, "cl-1", now);
  assert.deepEqual(entry, {
    clientId: "cl-1",
    method: "POST",
    path: `/api/custom-domains/${ID}/logs`,
    body: { clientId: "cl-1", value: 15, note: "deep work", occurredAt: "2026-03-10T08:00:00.000Z" },
  });
  assert.equal("note" in (buildCustomLogRequest(ID, { value: 1 }, "cl-2", now).body as object), false);
});

test("custom logs go through the outbox, and only they count as the domain's pending entries", async () => {
  const queued: unknown[] = [];
  await enqueueCustomLog({ enqueue: async (e) => void queued.push(e) }, ID, { value: 4 }, "cl-3");
  assert.equal(queued.length, 1);

  const items: OutboxItem[] = [
    { ...(queued[0] as OutboxItem), userId: "u1" },
    { clientId: "other", method: "POST", path: `/api/custom-domains/22222222-2222-4222-8222-222222222222/logs`, body: { clientId: "other", value: 1 }, userId: "u1" },
    { clientId: "ranked", method: "POST", path: "/api/logs", body: { clientId: "ranked" }, userId: "u1" },
    { clientId: "junk", method: "POST", path: `/api/custom-domains/${ID}/logs`, body: { nope: true }, userId: "u1" },
  ];
  const pending = pendingCustomLogs(items, ID);
  assert.deepEqual(pending.map((p) => [p.clientId, p.value]), [["cl-3", 4]]);
  assert.equal(pending[0]!.pending, true);
});

test("progress: baseline to target, from the latest value, in the domain's unit", () => {
  assert.deepEqual(progressLine(domain), { fraction: 0.25, line: "15 min of 60 min  ·  from 0" });
  assert.deepEqual(progressLine({ ...domain, latestValue: null }), { fraction: 0, line: "No entry yet  ·  0 to 60 min" });
  assert.deepEqual(progressLine({ ...domain, unit: "", latestValue: 60 }), { fraction: 1, line: "60 of 60  ·  from 0" });
  assert.equal(progressLine({ ...domain, baseline: 100, target: 60, latestValue: 80 }).fraction, 0.5);
});

test("the limit line and whether another can be made", () => {
  assert.deepEqual(customLimitLine({ items: [domain], limit: 3, isPro: false }), { line: "1 of 3 custom domains.", canCreate: true, proHint: false });
  assert.deepEqual(customLimitLine({ items: [domain, domain, domain], limit: 3, isPro: false }), {
    line: "3 of 3 custom domains.",
    canCreate: false,
    proHint: true,
  });
  assert.deepEqual(customLimitLine({ items: new Array(20).fill(domain), limit: 20, isPro: true }), { line: "20 of 20 custom domains.", canCreate: false, proHint: false });
});

test("create / update / archive are sent after the outbox with the clientId as the idempotency key", async () => {
  const detail = { domain, logs: [] };
  const { api, calls } = fakeApi(detail);
  const r = await createCustomDomain(api, synced, { name: "Language", unit: "min", logLabel: "Study", baseline: 0, target: 60, isPublic: false }, "k1");
  assert.equal(r.ok, true);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.path, "/api/custom-domains");
  assert.equal(calls[0]!.opts.idempotencyKey, "k1");
  assert.equal(calls[0]!.opts.body.clientId, "k1");

  await updateCustomDomain(api, synced, ID, { target: 90 }, "k2");
  assert.equal(calls[1]!.method, "PATCH");
  assert.equal(calls[1]!.path, `/api/custom-domains/${ID}`);
  assert.deepEqual(calls[1]!.opts.body, { target: 90, clientId: "k2" });

  await archiveCustomDomain(api, synced, ID, "k3");
  assert.equal(calls[2]!.method, "DELETE");
  assert.equal(calls[2]!.path, `/api/custom-domains/${ID}`);
  assert.equal(calls[2]!.opts.idempotencyKey, "k3");

  const blocked = await createCustomDomain(api, stuck, { name: "X", unit: "", logLabel: "Log", baseline: 0, target: 1, isPublic: false }, "k4");
  assert.deepEqual(blocked, { ok: false, reason: "sync_pending" });
  assert.equal(calls.length, 3, "nothing is sent while queued entries are stuck");
});

test("errors: 402 pro_required is the PRO lock, then SYSTEM-voice lines per code", () => {
  assert.equal(isProRequired(httpError(402, "pro_required")), true);
  assert.match(describeCustomError(httpError(402, "pro_required")), /PRO/);
  assert.match(describeCustomError(httpError(409, "custom_limit")), /20/);
  assert.match(describeCustomError(httpError(409, "name_taken")), /name/i);
  assert.match(describeCustomError(httpError(409, "archived")), /archived/i);
  assert.match(describeCustomError(httpError(422, "retroactive_limit")), /48/);
  assert.match(describeCustomError(httpError(404, "not_found")), /not found/i);
  assert.match(describeCustomError(new ApiError({ kind: "network", message: "x" })), /connection/i);
  assert.match(describeCustomError(httpError(500)), /unavailable/i);
});
