import test, { after, beforeEach } from "node:test";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import request from "supertest";
import pino from "pino";
import { createApp } from "./app-factory";
import type { Mailer } from "./lib/mailer";
import { resolveRequestId } from "./lib/request-id";
import { registry } from "./lib/metrics";
import { auth, db, setup, skip } from "./routes/game-test-helpers";
import { generateOrTemplate, generateWithFallback } from "./lib/ai";

const mailer: Mailer = { async send() {} };
after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});
const TOKEN = "metrics-test-token-123";

test("/metrics is 404 when METRICS_TOKEN is unset", async () => {
  const res = await request(createApp({ db: null, mailer, metricsToken: null })).get("/metrics");
  assert.equal(res.status, 404);
});

test("/metrics rejects a missing or wrong token and serves Prometheus text for the right one", async () => {
  const app = createApp({ db: null, mailer, metricsToken: TOKEN });
  assert.equal((await request(app).get("/metrics")).status, 401);
  assert.equal((await request(app).get("/metrics").set("Authorization", "Bearer nope")).status, 401);
  assert.equal((await request(app).get("/metrics").set("Authorization", `Bearer ${TOKEN}x`)).status, 401);
  const ok = await request(app).get("/metrics").set("Authorization", `Bearer ${TOKEN}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers["content-type"] ?? "", /text\/plain/);
  assert.match(ok.text, /# TYPE process_cpu_user_seconds_total counter/);
});

test("route label is the pattern, never the raw id", { skip }, async () => {
  const app = createApp({ db, mailer, metricsToken: TOKEN });
  const { token } = await setup(app);
  const id = "123e4567-e89b-42d3-a456-426614174000";
  await request(app).post(`/api/quests/${id}/complete`).set(auth(token)).send({});
  await request(app).get("/api/does/not/exist/9f8e7d6c-1111-4222-8333-444455556666");
  const text = (await request(app).get("/metrics").set("Authorization", `Bearer ${TOKEN}`)).text;
  assert.match(text, /http_request_duration_seconds_count\{[^}]*route="\/api\/quests\/:id\/complete"/);
  assert.match(text, /route="unmatched"/);
  assert.ok(!text.includes(id), "no uuid in metrics");
  assert.ok(!text.includes("9f8e7d6c"), "no unmatched path in metrics");
  assert.ok(!/route="\/metrics"/.test(text) && !/route="\/api\/healthz"/.test(text));
});

test("resolveRequestId accepts valid ids and replaces invalid ones", () => {
  assert.equal(resolveRequestId("abc-123-DEF"), "abc-123-DEF");
  assert.equal(resolveRequestId("a".repeat(64)), "a".repeat(64));
  for (const bad of ["a".repeat(65), "bad id", "bad;id", "", undefined, ["x", "y"]]) {
    const id = resolveRequestId(bad as string | undefined);
    assert.match(id, /^[0-9a-f-]{36}$/);
  }
});

test("request id is echoed, replaced when invalid, and in the log context", async () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const app = createApp({ db: null, mailer, logger: pino({ level: "info" }, stream) });
  const ok = await request(app).get("/api/healthz").set("x-request-id", "client-req-1");
  assert.equal(ok.headers["x-request-id"], "client-req-1");
  const bad = await request(app).get("/api/healthz").set("x-request-id", "a".repeat(65));
  assert.notEqual(bad.headers["x-request-id"], "a".repeat(65));
  assert.match(String(bad.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
  const bad2 = await request(app).get("/api/healthz").set("x-request-id", "bad id!");
  assert.match(String(bad2.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
  const logged = lines.map((l) => JSON.parse(l) as { req?: { id?: string } });
  assert.ok(logged.some((l) => l.req?.id === "client-req-1"));
});

async function counter(name: string, labels: Record<string, string> = {}): Promise<number> {
  const metric = await registry.getSingleMetricAsString(name);
  const want = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
  for (const line of metric.split("\n")) {
    if (line.startsWith("#") || !line.startsWith(name)) continue;
    if (want.every((w) => line.includes(w))) return Number(line.split(" ").pop());
  }
  return 0;
}

test("AI outcome and fallback counters increment with a fake model", async () => {
  process.env.GEMINI_API_KEY ??= "x";
  const opts = { systemInstruction: "s", prompt: "p", maxOutputTokens: 10, temperature: 0 };
  const { env } = await import("./lib/env");
  const prevKey = env.GEMINI_API_KEY;
  (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = "test-key";
  try {
    const okBefore = await counter("ai_calls_total", { outcome: "ok" });
    await generateWithFallback(opts, async () => "hello");
    assert.equal(await counter("ai_calls_total", { outcome: "ok" }), okBefore + 1);

    const invalidBefore = await counter("ai_calls_total", { outcome: "invalid" });
    await assert.rejects(generateWithFallback(opts, async () => ""));
    assert.ok((await counter("ai_calls_total", { outcome: "invalid" })) > invalidBefore);

    const timeoutBefore = await counter("ai_calls_total", { outcome: "timeout" });
    await assert.rejects(generateWithFallback(opts, async () => { throw new Error("request timed out"); }));
    assert.ok((await counter("ai_calls_total", { outcome: "timeout" })) > timeoutBefore);

    const errBefore = await counter("ai_calls_total", { outcome: "error" });
    const fbBefore = await counter("ai_fallbacks_total");
    const r = await generateOrTemplate(opts, async () => { throw new Error("boom"); });
    assert.equal(r.model, "template");
    assert.ok((await counter("ai_calls_total", { outcome: "error" })) > errBefore);
    assert.equal(await counter("ai_fallbacks_total"), fbBefore + 1);
  } finally {
    (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = prevKey;
  }
});

test("log redaction covers auth headers at any depth, api keys, tokens and axios-style err.config.headers", async () => {
  const { LOG_REDACT } = await import("./lib/logger");
  const lines: string[] = [];
  const sink = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
  const log = pino({ redact: LOG_REDACT }, sink);
  log.info({
    req: { headers: { authorization: "Bearer sekret-1", cookie: "sid=sekret-2" } },
    upstream: { headers: { authorization: "Bearer sekret-3", Authorization: "Bearer sekret-4", "set-cookie": "sekret-5" } },
    client: { apiKey: "sekret-6", token: "sekret-7", accessToken: "sekret-8", refreshToken: "sekret-9" },
    err: { message: "boom", config: { headers: { Authorization: "Bearer sekret-10" } } },
    res: { headers: { "set-cookie": "sekret-11" } },
  }, "redaction");
  const out = lines.join("");
  assert.doesNotMatch(out, /sekret/);
  assert.match(out, /"message":"boom"/);
});
