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

test("health probes are exempt from the global rate limiter", async () => {
  const a = createApp({ db: null, mailer });
  for (let i = 0; i < env.RATE_LIMIT_MAX + 5; i++) {
    assert.equal((await request(a).get("/api/healthz")).status, 200, `healthz ${i + 1}`);
    assert.equal((await request(a).get("/api/readyz")).status, 503, `readyz ${i + 1}`);
  }
});
