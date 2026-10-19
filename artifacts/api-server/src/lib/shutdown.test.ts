import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import { createApp } from "../app-factory";
import { createShutdown, isShuttingDown, resetShuttingDown } from "./shutdown";

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path, agent: false }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

test("shutdown: in-flight request completes, readyz flips to 503, new connections are refused, pool closes", async () => {
  resetShuttingDown();
  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((r) => (releaseSlow = r));
  let slowStarted!: () => void;
  const started = new Promise<void>((r) => (slowStarted = r));
  let requestDone = false;
  const outer = express();
  outer.get("/slow", async (_req, res) => {
    slowStarted();
    await slowGate;
    res.on("finish", () => (requestDone = true));
    res.json({ done: true });
  });
  outer.use(createApp({ db: null }));
  const server = http.createServer(outer);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  let poolClosedAfterRequest = false;
  const shutdown = createShutdown({
    server,
    closePool: async () => {
      poolClosedAfterRequest = requestDone;
    },
    timeoutMs: 5_000,
  });

  const inflight = get(port, "/slow");
  await started;
  const stopping = shutdown("SIGTERM");
  assert.equal(isShuttingDown(), true);

  // readyz (via the app, as a load balancer's keep-alive probe would reach it) is 503 while draining.
  const ready = await request(outer).get("/api/readyz");
  assert.equal(ready.status, 503);
  assert.equal(ready.body.status, "shutting_down");
  // healthz (liveness) is unaffected.
  assert.equal((await request(outer).get("/api/healthz")).status, 200);

  // The listener is closed: a new connection fails.
  await assert.rejects(get(port, "/api/healthz"));

  releaseSlow();
  const res = await inflight;
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { done: true });
  await stopping;
  assert.equal(poolClosedAfterRequest, true, "pool closes only after the in-flight request finished");
  resetShuttingDown();
});

test("shutdown: a second call returns the same promise, and a stuck request is cut off at the timeout", async () => {
  resetShuttingDown();
  const outer = express();
  outer.get("/hang", () => {
    /* never answers */
  });
  const server = http.createServer(outer);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  let closed = 0;
  const shutdown = createShutdown({ server, closePool: async () => void closed++, timeoutMs: 150 });
  const hung = get(port, "/hang").catch((e: unknown) => e);
  await new Promise((r) => setTimeout(r, 50));
  const a = shutdown("SIGTERM");
  const b = shutdown("SIGINT");
  assert.equal(a, b);
  await a;
  assert.equal(closed, 1);
  assert.ok((await hung) instanceof Error);
  resetShuttingDown();
});
