import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { scoreEvents } from "@workspace/db";
import { localDate } from "@workspace/engine";
import { LogListResponseSchema, LogResponseSchema, NoticeListResponseSchema } from "@workspace/contracts";
import { app, auth, db, score, setup, skip, TZ, assertContract, assertStoredNoticesMatchContract } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

test("log BODY gives +2.5, streak 1 and a first_log achievement notice", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const before = (await score(id, "BODY")).score;
  const res = await request(a).post("/api/logs").set(auth(token)).send({ clientId: "c1", domain: "BODY", logType: "workout" });
  assert.equal(res.status, 201);
  assertContract(LogResponseSchema, res.body);
  assert.equal(res.body.log.domain, "BODY");
  assert.equal(res.body.log.isRetroactive, false);
  assert.equal(res.body.results[0].actualDelta, 2.5);
  assert.equal(res.body.results[0].streak, 1);
  assert.ok(
    res.body.notices.some((n: { kind: string; payload: { id: string } }) => n.kind === "achievement" && n.payload.id === "first_log"),
  );
  assert.equal((await score(id, "BODY")).score, before + 2.5);
});

test("replayed clientId returns the same response and does not double-score", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const send = () => request(a).post("/api/logs").set(auth(token)).send({ clientId: "dup", domain: "MIND", logType: "read" });
  const first = await send();
  const before = (await score(id, "MIND")).score;
  const second = await send();
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal((await score(id, "MIND")).score, before);
  const evs = await db!.select().from(scoreEvents).where(and(eq(scoreEvents.userId, id), eq(scoreEvents.reason, "log")));
  assert.equal(evs.length, 1);
});

test("concurrent duplicate clientId applies once", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const before = (await score(id, "MIND")).score;
  const send = () => request(a).post("/api/logs").set(auth(token)).send({ clientId: "race", domain: "MIND", logType: "read" });
  const [r1, r2] = await Promise.all([send(), send()]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 201]);
  assert.equal((await score(id, "MIND")).score, before + 2.5);
});

test("log 49h ago is 422 retroactive_limit", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const res = await request(a)
    .post("/api/logs")
    .set(auth(token))
    .send({ clientId: "old", domain: "BODY", logType: "x", occurredAt: new Date(Date.now() - 49 * 3600_000).toISOString() });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, "retroactive_limit");
});

test("validation: bad domain, oversized data, oversized freeText -> 400; no token -> 401", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const post = (b: object) => request(a).post("/api/logs").set(auth(token)).send(b);
  assert.equal((await post({ clientId: "v1", domain: "CUSTOM", logType: "x" })).status, 400);
  assert.equal((await post({ clientId: "v2", domain: "BODY", logType: "x", data: { blob: "z".repeat(5000) } })).status, 400);
  assert.equal((await post({ clientId: "v3", domain: "BODY", logType: "x", freeText: "z".repeat(2001) })).status, 400);
  assert.equal((await request(a).post("/api/logs").send({ clientId: "v4", domain: "BODY", logType: "x" })).status, 401);
});

test("forbidden log gives +5 to its domain and -2 DISCIPLINE", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const dBefore = (await score(id, "DISCIPLINE")).score;
  const res = await request(a)
    .post("/api/logs")
    .set(auth(token))
    .send({ clientId: "f1", domain: "SOCIAL", logType: "slip", forbidden: true });
  assert.equal(res.status, 201);
  const by = Object.fromEntries(res.body.results.map((r: { domain: string; actualDelta: number }) => [r.domain, r.actualDelta]));
  assert.equal(by.SOCIAL, 5);
  assert.equal(by.DISCIPLINE, -2);
  assert.equal((await score(id, "DISCIPLINE")).score, dBefore - 2);
});

test("two logs at 23:50 and 00:10 Asia/Kolkata give streak 2", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const now = new Date();
  const today = localDate(now, TZ);
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const minutesNow = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
  // Keep both instants within the 48h window and not in the future.
  const [d1, d2] = minutesNow < 60 ? [shift(today, -2), shift(today, -1)] : [shift(today, -1), today];
  const post = (clientId: string, occurredAt: string) =>
    request(a).post("/api/logs").set(auth(token)).send({ clientId, domain: "BODY", logType: "x", occurredAt });
  const r1 = await post("a", `${d1}T23:50:00+05:30`);
  const r2 = await post("b", `${d2}T00:10:00+05:30`);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.equal(r1.body.log.localDate, d1);
  assert.equal(r2.body.log.localDate, d2);
  assert.equal(r1.body.results[0].streak, 1);
  assert.equal(r2.body.results[0].streak, 2);
});

test("GET /logs paginates newest first", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  for (let i = 0; i < 3; i++) {
    const r = await request(a)
      .post("/api/logs")
      .set(auth(token))
      .send({ clientId: `p${i}`, domain: "MIND", logType: "x", occurredAt: new Date(Date.now() - (3 - i) * 1000).toISOString() });
    assert.equal(r.status, 201);
  }
  const p1 = await request(a).get("/api/logs?limit=2").set(auth(token));
  assert.equal(p1.status, 200);
  assertContract(LogListResponseSchema, p1.body);
  assert.deepEqual(p1.body.items.map((l: { clientId: string }) => l.clientId), ["p2", "p1"]);
  assert.ok(p1.body.nextCursor);
  const p2 = await request(a).get(`/api/logs?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`).set(auth(token));
  assert.deepEqual(p2.body.items.map((l: { clientId: string }) => l.clientId), ["p0"]);
  assert.equal(p2.body.nextCursor, null);
  assert.equal((await request(a).get("/api/logs?limit=0").set(auth(token))).status, 400);
});

test("notices seen are not returned again", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  await request(a).post("/api/logs").set(auth(token)).send({ clientId: "n1", domain: "BODY", logType: "x" });
  const list = await request(a).get("/api/notices").set(auth(token));
  assert.equal(list.status, 200);
  assertContract(NoticeListResponseSchema, list.body);
  assert.ok(list.body.items.length >= 1);
  const ids = list.body.items.map((n: { id: string }) => n.id);
  const seen = await request(a).post("/api/notices/seen").set(auth(token)).send({ ids });
  assert.equal(seen.status, 204);
  const after2 = await request(a).get("/api/notices").set(auth(token));
  assert.deepEqual(after2.body.items, []);
});

test("data limit counts UTF-8 bytes, not characters", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  // ~2.1k characters but ~4.2 KB of UTF-8.
  const res = await request(a)
    .post("/api/logs")
    .set(auth(token))
    .send({ clientId: "mb", domain: "BODY", logType: "x", data: { blob: "é".repeat(2100) } });
  assert.equal(res.status, 400);
});
