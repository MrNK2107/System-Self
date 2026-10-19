import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { AUTH_IDENTITY_RATE_LIMIT_MAX, AUTH_IP_RATE_LIMIT_MAX, createApp } from "./app-factory";
import { signAccessToken } from "./lib/auth/tokens";
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

// --- P8 final review I-6: per-user global limiter, IP+email auth limiter, per-IP auth ceiling ---

const bearer = async (id: string) =>
  `Bearer ${(await signAccessToken({ id, role: "user", tokenVersion: 0 })).token}`;

test("global limiter is per user: two users behind one IP (CGNAT) do not share a budget", async () => {
  const a = createApp({ db: null, mailer, trustProxy: 1 });
  const alice = await bearer("00000000-0000-4000-8000-00000000000a");
  const bob = await bearer("00000000-0000-4000-8000-00000000000b");
  const ip = "198.51.100.7";
  for (let i = 0; i < env.RATE_LIMIT_MAX; i++) {
    assert.equal((await request(a).get("/api/nope").set("X-Forwarded-For", ip).set("Authorization", alice)).status, 404, `alice ${i + 1}`);
  }
  assert.equal((await request(a).get("/api/nope").set("X-Forwarded-For", ip).set("Authorization", alice)).status, 429, "alice is over");
  assert.equal((await request(a).get("/api/nope").set("X-Forwarded-For", ip).set("Authorization", bob)).status, 404, "bob has his own budget");
  // Unauthenticated traffic from that IP has its own (IP) budget too, untouched by alice.
  assert.equal((await request(a).get("/api/nope").set("X-Forwarded-For", ip)).status, 404, "anonymous on the IP bucket");
});

test("global limiter: an invalid or forged bearer token falls back to the IP bucket (no free budget per garbage token)", async () => {
  const a = createApp({ db: null, mailer, trustProxy: 1 });
  const ip = "198.51.100.8";
  for (let i = 0; i < env.RATE_LIMIT_MAX; i++) {
    const res = await request(a).get("/api/nope").set("X-Forwarded-For", ip).set("Authorization", `Bearer forged.${i}.token`);
    assert.equal(res.status, 404, `forged ${i + 1}`);
  }
  assert.equal((await request(a).get("/api/nope").set("X-Forwarded-For", ip).set("Authorization", "Bearer another.forged.token")).status, 429);
  assert.equal((await request(a).get("/api/nope").set("X-Forwarded-For", ip)).status, 429, "same IP bucket as the forged tokens");
});

test("auth limiter keys on IP + normalised email: the same email is limited at 10, another email on that IP is not", async () => {
  const a = createApp({ db: null, mailer, trustProxy: 1 });
  const ip = "198.51.100.9";
  for (let i = 0; i < 10; i++) {
    // Case and whitespace variants are the same account.
    const email = i % 2 ? "  Victim@Example.com " : "victim@example.com";
    const res = await request(a).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email, password: "nope" });
    assert.equal(res.status, 503, `attempt ${i + 1}`);
  }
  const limited = await request(a).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email: "VICTIM@example.com", password: "nope" });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "rate_limited");
  const other = await request(a).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email: "someone@example.com", password: "nope" });
  assert.equal(other.status, 503, "a second user behind the same IP can still sign in");
});

test("auth limiter: one IP spraying many emails hits the per-IP ceiling", async () => {
  assert.equal(AUTH_IDENTITY_RATE_LIMIT_MAX, 10);
  assert.equal(AUTH_IP_RATE_LIMIT_MAX, 100);
  const a = createApp({ db: null, mailer, trustProxy: 1 });
  const ip = "198.51.100.10";
  for (let i = 0; i < AUTH_IP_RATE_LIMIT_MAX; i++) {
    const res = await request(a).post("/api/auth/password/forgot").set("X-Forwarded-For", ip).send({ email: `spray${i}@example.com` });
    assert.equal(res.status, 503, `email ${i + 1}`);
  }
  const limited = await request(a).post("/api/auth/password/forgot").set("X-Forwarded-For", ip).send({ email: "fresh@example.com" });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "rate_limited");
  const otherIp = await request(a).post("/api/auth/password/forgot").set("X-Forwarded-For", "198.51.100.11").send({ email: "fresh@example.com" });
  assert.equal(otherIp.status, 503);
});

// --- P8 fix round 2: the per-IP auth ceiling counts requests the JSON parser rejects ---
test("auth ceiling runs before body parsing: 100 malformed-JSON logins from one IP, the 101st is 429", async () => {
  const a = createApp({ db: null, mailer, trustProxy: 1 });
  const ip = "198.51.100.20";
  for (let i = 0; i < AUTH_IP_RATE_LIMIT_MAX; i++) {
    const res = await request(a).post("/api/auth/login").set("X-Forwarded-For", ip).set("Content-Type", "application/json").send("{nope");
    assert.equal(res.status, 400, `malformed ${i + 1}`);
  }
  const limited = await request(a).post("/api/auth/login").set("X-Forwarded-For", ip).set("Content-Type", "application/json").send("{nope");
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "rate_limited");
});

test("auth ceiling counts oversized (over 100 KB) bodies too: after 100 of them a valid login is 429", async () => {
  const a = createApp({ db: null, mailer, trustProxy: 1 });
  const ip = "198.51.100.21";
  const big = jsonOfSize(101 * 1024);
  for (let i = 0; i < AUTH_IP_RATE_LIMIT_MAX; i++) {
    const res = await request(a).post("/api/auth/register").set("X-Forwarded-For", ip).set("Content-Type", "application/json").send(big);
    assert.equal(res.status, 413, `oversized ${i + 1}`);
  }
  const limited = await request(a).post("/api/auth/register").set("X-Forwarded-For", ip).send({ email: "late@example.com", password: "x" });
  assert.equal(limited.status, 429);
});
