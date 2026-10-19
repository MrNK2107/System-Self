import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { domainScores, idempotencyKeys, logs, notices, scoreEvents } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import { GameStateSchema, LogListResponseSchema, LogResponseSchema, NoticeListResponseSchema } from "@workspace/contracts";
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
  const res = await request(a).post("/api/logs").set(auth(token)).send({ clientId: "c1", domain: "BODY", logType: "workout", data: { kind: "Run", minutes: 30, intensity: 4 } });
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
  const send = () => request(a).post("/api/logs").set(auth(token)).send({ clientId: "dup", domain: "MIND", logType: "reading", data: { pages: 10 } });
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
  const send = () => request(a).post("/api/logs").set(auth(token)).send({ clientId: "race", domain: "MIND", logType: "reading", data: { pages: 10 } });
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
    .send({ clientId: "old", domain: "BODY", logType: "generic", occurredAt: new Date(Date.now() - 49 * 3600_000).toISOString() });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, "retroactive_limit");
});

test("validation: bad domain, oversized data, oversized freeText -> 400; no token -> 401", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const post = (b: object) => request(a).post("/api/logs").set(auth(token)).send(b);
  assert.equal((await post({ clientId: "v1", domain: "CUSTOM", logType: "generic" })).status, 400);
  assert.equal((await post({ clientId: "v2", domain: "BODY", logType: "generic", data: { blob: "z".repeat(5000) } })).status, 400);
  assert.equal((await post({ clientId: "v3", domain: "BODY", logType: "generic", freeText: "z".repeat(2001) })).status, 400);
  assert.equal((await request(a).post("/api/logs").send({ clientId: "v4", domain: "BODY", logType: "generic" })).status, 401);
});

test("forbidden log gives +5 to its domain and -2 DISCIPLINE", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const dBefore = (await score(id, "DISCIPLINE")).score;
  const res = await request(a)
    .post("/api/logs")
    .set(auth(token))
    .send({ clientId: "f1", domain: "SOCIAL", logType: "generic", forbidden: true });
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
    request(a).post("/api/logs").set(auth(token)).send({ clientId, domain: "BODY", logType: "generic", occurredAt });
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
      .send({ clientId: `p${i}`, domain: "MIND", logType: "generic", occurredAt: new Date(Date.now() - (3 - i) * 1000).toISOString() });
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
  await request(a).post("/api/logs").set(auth(token)).send({ clientId: "n1", domain: "BODY", logType: "generic" });
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
    .send({ clientId: "mb", domain: "BODY", logType: "generic", data: { blob: "é".repeat(2100) } });
  assert.equal(res.status, 400);
});

test("GET /state lists unlocked achievements and milestones", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  await db!.update(domainScores).set({ score: 59 }).where(and(eq(domainScores.userId, id), eq(domainScores.domain, "BODY")));
  const log = await request(a).post("/api/logs").set(auth(token)).send({ clientId: "m1", domain: "BODY", logType: "generic" });
  assert.equal(log.status, 201);
  const res = await request(a).get("/api/state").set(auth(token));
  assert.equal(res.status, 200);
  const state = assertContract(GameStateSchema, res.body);
  assert.ok(state.achievements.some((x) => x.id === "first_log" && !Number.isNaN(Date.parse(x.unlockedAt))));
  assert.deepEqual(
    state.milestones.map(({ domain, tier }) => ({ domain, tier })),
    [{ domain: "BODY", tier: 60 }],
  );
});

test("same clientId with a different or absent Idempotency-Key replays the log with 200", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const send = (key?: string) => {
    const r = request(a).post("/api/logs").set(auth(token));
    if (key) r.set("Idempotency-Key", key);
    return r.send({ clientId: "retry", domain: "MIND", logType: "reading", data: { pages: 10 } });
  };
  const first = await send("k-1");
  const second = await send("k-2");
  const third = await send();
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  assert.equal(second.body.log.id, first.body.log.id);
  assert.equal(third.body.log.id, first.body.log.id);
  const evs = await db!.select().from(scoreEvents).where(and(eq(scoreEvents.userId, id), eq(scoreEvents.reason, "log")));
  assert.equal(evs.length, 1);

  // Once the stored response is pruned, the stored log comes back with no new score changes.
  await db!.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, id));
  const late = await send("k-3");
  assert.equal(late.status, 200);
  assertContract(LogResponseSchema, late.body);
  assert.equal(late.body.log.id, first.body.log.id);
  assert.deepEqual([late.body.results, late.body.notices], [[], []]);
  assert.equal((await db!.select().from(scoreEvents).where(and(eq(scoreEvents.userId, id), eq(scoreEvents.reason, "log")))).length, 1);
});

test("GET /notices and GameState return at most 50 unseen notices, oldest first, with hasMore", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const base = Date.parse("2026-01-01T00:00:00Z");
  await db!.insert(notices).values(
    Array.from({ length: 55 }, (_, i) => ({
      userId: id,
      kind: "shadow_resolved",
      payload: { codename: `S${i}` },
      createdAt: new Date(base + i * 1000),
    })),
  );
  const list = await request(a).get("/api/notices").set(auth(token));
  assertContract(NoticeListResponseSchema, list.body);
  assert.equal(list.body.items.length, 50);
  assert.equal(list.body.items[0].payload.codename, "S0");
  assert.equal(list.body.hasMore, true);
  const state = await request(a).get("/api/state").set(auth(token));
  assertContract(GameStateSchema, state.body);
  assert.equal(state.body.unseenNotices.length, 50);
  assert.equal(state.body.unseenNotices[0].payload.codename, "S0");
  assert.equal(state.body.hasMoreNotices, true);

  const seen = () =>
    request(a)
      .post("/api/notices/seen")
      .set(auth(token))
      .set("Idempotency-Key", "seen-1")
      .send({ ids: list.body.items.map((n: { id: string }) => n.id) });
  assert.equal((await seen()).status, 204);
  const replay = await seen(); // a 204 route replays as 200 null
  assert.equal(replay.status, 200);
  assert.equal(replay.body, null);
  const rest = await request(a).get("/api/notices").set(auth(token));
  assert.equal(rest.body.items.length, 5);
  assert.equal(rest.body.hasMore, false);
});

const post = (a: ReturnType<typeof app>, token: string, body: object) => request(a).post("/api/logs").set(auth(token)).send(body);

test("structured logs score by their PRD driver", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const cases: { body: object; domain: string; delta: number }[] = [
    { body: { domain: "BODY", logType: "workout", data: { kind: "Run", minutes: 30, intensity: 5 } }, domain: "BODY", delta: 2.8 },
    { body: { domain: "MIND", logType: "focus", data: { minutes: 45, distraction: 4, subject: "Math" } }, domain: "MIND", delta: 1.1 },
    { body: { domain: "BODY", logType: "meal", data: { description: "Oats", quality: 5 } }, domain: "BODY", delta: 1 },
    { body: { domain: "WEALTH", logType: "expense", data: { amount: 120, category: "food" } }, domain: "WEALTH", delta: 0.5 },
    { body: { domain: "SOCIAL", logType: "interaction", data: { kind: "casual" } }, domain: "SOCIAL", delta: 0.8 },
    { body: { domain: "DISCIPLINE", logType: "routine", data: { label: "Morning" } }, domain: "DISCIPLINE", delta: 3 },
  ];
  for (const [i, c] of cases.entries()) {
    const before = (await score(id, c.domain)).score;
    const res = await post(a, token, { clientId: `d${i}`, ...c.body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertContract(LogResponseSchema, res.body);
    assert.equal(res.body.results[0].actualDelta, c.delta);
    assert.equal((await score(id, c.domain)).score, Math.round((before + c.delta) * 10) / 10);
  }
});

test("sleep 5h at streak 9: -1.0 and the streak still increments", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const today = localDate(new Date(), TZ);
  await db!
    .update(domainScores)
    .set({ score: 50, streak: 9, lastLogDate: addDays(today, -1) })
    .where(and(eq(domainScores.userId, id), eq(domainScores.domain, "BODY")));
  const res = await post(a, token, { clientId: "s5", domain: "BODY", logType: "sleep", data: { hours: 5, quality: 4 } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.results[0].actualDelta, -1);
  assert.equal(res.body.results[0].streak, 10);
  const row = await score(id, "BODY");
  assert.equal(row.score, 49);
  assert.equal(row.streak, 10);
  assert.equal(row.lastLogDate, today);
});

test("invalid data for a type is a 400 with issues and nothing is stored", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const bad: [string, object][] = [
    ["workout intensity 6", { domain: "BODY", logType: "workout", data: { kind: "Run", minutes: 30, intensity: 6 } }],
    ["workout without data", { domain: "BODY", logType: "workout" }],
    ["sleep 7.1 hours", { domain: "BODY", logType: "sleep", data: { hours: 7.1, quality: 3 } }],
    ["sleep 17 hours", { domain: "BODY", logType: "sleep", data: { hours: 17, quality: 3 } }],
    ["expense amount 0", { domain: "WEALTH", logType: "expense", data: { amount: 0, category: "x" } }],
    ["interaction kind", { domain: "SOCIAL", logType: "interaction", data: { kind: "rude" } }],
    ["outreach 51", { domain: "SOCIAL", logType: "outreach", data: { count: 51 } }],
  ];
  for (const [i, [name, body]] of bad.entries()) {
    const res = await post(a, token, { clientId: `bad${i}`, ...body });
    assert.equal(res.status, 400, name);
    assert.equal(res.body.code, "invalid_log_data", name);
    assert.ok(res.body.issues.length >= 1, name);
    assert.ok(res.body.issues.every((x: { path: string; message: string }) => typeof x.path === "string" && x.message), name);
  }
  const stored = await db!.select().from(logs).where(eq(logs.userId, id));
  assert.equal(stored.length, 0);
});

test("a log type the domain does not have is a 400", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  for (const [i, body] of [
    { domain: "BODY", logType: "focus", data: { minutes: 30, distraction: 1, subject: "x" } },
    { domain: "MIND", logType: "workout", data: {} },
    { domain: "BODY", logType: "constructor" },
    { domain: "BODY", logType: "read" },
  ].entries()) {
    const res = await post(a, token, { clientId: `u${i}`, ...body });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "unknown_log_type");
  }
});

test("typed data is stored stripped to its fields; generic keeps its own", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const typed = await post(a, token, { clientId: "t1", domain: "MIND", logType: "reading", data: { pages: 12, extra: "dropped" } });
  assert.equal(typed.status, 201);
  assert.deepEqual(typed.body.log.data, { pages: 12 });
  const generic = await post(a, token, { clientId: "t2", domain: "MIND", logType: "generic", data: { note: "free", intensity: 3 } });
  assert.equal(generic.status, 201);
  assert.deepEqual(generic.body.log.data, { note: "free", intensity: 3 });
});

test("generic and session logs still score the plain base", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const rows = [
    ["WEALTH", "generic", 2],
    ["BODY", "gym_session", 2.5],
    ["MIND", "floor_session", 2.5],
    ["SOCIAL", "home_session", 2],
  ] as const;
  for (const [i, [domain, logType, delta]] of rows.entries()) {
    const before = (await score(id, domain)).score;
    const res = await post(a, token, { clientId: `g${i}`, domain, logType });
    assert.equal(res.status, 201);
    assert.equal(res.body.results[0].actualDelta, Math.round((Math.min(100, before + delta) - before) * 10) / 10);
  }
});
