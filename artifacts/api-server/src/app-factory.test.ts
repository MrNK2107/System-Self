import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "./app-factory";
import { env } from "./lib/env";
import type { Mailer } from "./lib/mailer";

const mailer: Mailer = { async send() {} };
const login = { email: "x@example.com", password: "nope" };

test("TRUST_PROXY=1: different X-Forwarded-For IPs get separate login limiter buckets", async () => {
  const a = createApp({ db: null, mailer, trustProxy: 1 });
  for (let i = 0; i < 10; i++) {
    const res = await request(a).post("/api/auth/login").set("X-Forwarded-For", "203.0.113.1").send(login);
    assert.equal(res.status, 503, `attempt ${i + 1}`);
  }
  const limited = await request(a).post("/api/auth/login").set("X-Forwarded-For", "203.0.113.1").send(login);
  assert.equal(limited.status, 429);
  const other = await request(a).post("/api/auth/login").set("X-Forwarded-For", "203.0.113.2").send(login);
  assert.equal(other.status, 503);
});

test("rateLimitDisabled (load-test switch): no limiter answers 429", async () => {
  const a = createApp({ db: null, mailer, rateLimitDisabled: true });
  for (let i = 0; i < 15; i++) {
    assert.equal((await request(a).post("/api/auth/login").send(login)).status, 503, `login ${i + 1}`);
  }
  for (let i = 0; i < env.RATE_LIMIT_MAX + 5; i++) {
    assert.equal((await request(a).get("/api/nope")).status, 404, `global ${i + 1}`);
  }
});

test("health probes are exempt from the global rate limiter", async () => {
  const a = createApp({ db: null, mailer });
  for (let i = 0; i < env.RATE_LIMIT_MAX + 5; i++) {
    assert.equal((await request(a).get("/api/healthz")).status, 200, `healthz ${i + 1}`);
    assert.equal((await request(a).get("/api/readyz")).status, 503, `readyz ${i + 1}`);
  }
});

test("unknown /api path -> 404 even without a database", async () => {
  const res = await request(createApp({ db: null, mailer })).get("/api/nope");
  assert.equal(res.status, 404);
});

const jsonOfSize = (bytes: number) => {
  const shell = JSON.stringify({ pad: "" });
  return JSON.stringify({ pad: "x".repeat(bytes - shell.length) });
};

test("JSON bodies are limited to 100 KB: 101 KB -> 413 with a JSON error body, 99 KB is parsed", async () => {
  const a = createApp({ db: null, mailer });
  const big = await request(a).post("/api/nope").set("Content-Type", "application/json").send(jsonOfSize(101 * 1024));
  assert.equal(big.status, 413);
  assert.match(big.headers["content-type"] ?? "", /application\/json/);
  assert.deepEqual(big.body, { error: "Request body too large", code: "payload_too_large" });
  const ok = await request(a).post("/api/nope").set("Content-Type", "application/json").send(jsonOfSize(99 * 1024));
  assert.equal(ok.status, 404, "parsed, then no route");
});

test("malformed JSON is a 400 with a JSON body, not a 500", async () => {
  const res = await request(createApp({ db: null, mailer })).post("/api/nope").set("Content-Type", "application/json").send("{nope");
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Malformed JSON body", code: "invalid_json" });
});

test("strict CORS: listed origins get CORS headers, unknown origins 403, no Origin (native apps) allowed", async () => {
  const a = createApp({ db: null, mailer, corsOrigins: ["https://app.systemself.app", "https://admin.systemself.app"] });
  const listed = await request(a).get("/api/healthz").set("Origin", "https://admin.systemself.app");
  assert.equal(listed.status, 200);
  assert.equal(listed.headers["access-control-allow-origin"], "https://admin.systemself.app");
  const unknown = await request(a).get("/api/healthz").set("Origin", "https://evil.example");
  assert.equal(unknown.status, 403);
  assert.deepEqual(unknown.body, { error: "Origin not allowed", code: "cors_origin_rejected" });
  assert.equal(unknown.headers["access-control-allow-origin"], undefined);
  const preflight = await request(a).options("/api/auth/login").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "POST");
  assert.equal(preflight.status, 403);
  const okPreflight = await request(a).options("/api/auth/login").set("Origin", "https://app.systemself.app").set("Access-Control-Request-Method", "POST");
  assert.equal(okPreflight.status, 204);
  const native = await request(a).get("/api/healthz");
  assert.equal(native.status, 200);
});

test("unset CORS_ORIGIN (development only) stays permissive", async () => {
  const res = await request(createApp({ db: null, mailer, corsOrigins: "*" })).get("/api/healthz").set("Origin", "http://localhost:8081");
  assert.equal(res.status, 200);
  assert.equal(res.headers["access-control-allow-origin"], "*");
});

test("helmet headers are set and x-powered-by is not", async () => {
  const res = await request(createApp({ db: null, mailer })).get("/api/healthz");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.ok(res.headers["strict-transport-security"]);
  assert.equal(res.headers["x-powered-by"], undefined);
});

test("JSON-only: form-encoded bodies are not parsed (a 101 KB form body is not a 413, it just has no body)", async () => {
  const res = await request(createApp({ db: null, mailer }))
    .post("/api/nope")
    .set("Content-Type", "application/x-www-form-urlencoded")
    .send(`pad=${"x".repeat(101 * 1024)}`);
  assert.equal(res.status, 404);
});

test("the voice upload path skips the global JSON parser with or without a trailing slash", async () => {
  const a = createApp({ db: null, mailer });
  for (const p of ["/api/logs/voice", "/api/logs/voice/", "/api/logs/Voice"]) {
    const res = await request(a).post(p).set("Content-Type", "application/json").send(jsonOfSize(101 * 1024));
    assert.notEqual(res.status, 413, p);
  }
});
