import test, { after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { closeTestDb, getTestDb } from "@workspace/db/testing";
import { createApp } from "../app-factory";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";

after(async () => {
  await closeTestDb();
});

test("readyz 503 when db null", async () => {
  const res = await request(createApp({ db: null })).get("/api/readyz");
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: "not_ready", db: "unavailable" });
});

test("readyz 200 with db ok and ai mode", { skip }, async () => {
  const res = await request(createApp({ db })).get("/api/readyz");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ready");
  assert.equal(res.body.db, "ok");
  assert.ok(["ollama", "gemini", "template"].includes(res.body.ai));
});

test("healthz stays 200 without a db", async () => {
  const res = await request(createApp({ db: null })).get("/api/healthz");
  assert.equal(res.status, 200);
});
