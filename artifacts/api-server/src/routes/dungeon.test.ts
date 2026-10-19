import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { gymCrowdReports } from "@workspace/db";
import { BriefingResponseSchema, CrowdReportResponseSchema, QuietHoursResponseSchema } from "@workspace/contracts";
import { app, assertContract, assertStoredNoticesMatchContract, auth, db, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

// 2026-10-19 is a Monday. Asia/Kolkata is UTC+5:30, so 06:30Z is 12:00 local.
const MON_NOON = () => new Date("2026-10-19T06:30:00Z");
// 19:00Z Monday is 00:30 local Tuesday.
const TUE_AFTER_MIDNIGHT = () => new Date("2026-10-19T19:00:00Z");

test("briefing uses the plan day on MON and BEGINNER_DAY on TUE (default plan)", { skip }, async () => {
  const a = app({ now: MON_NOON });
  const { token } = await setup(a);
  const mon = await request(a).get("/api/gym/briefing").set(auth(token));
  assert.equal(mon.status, 200);
  assertContract(BriefingResponseSchema, mon.body);
  assert.equal(mon.body.date, "2026-10-19");
  assert.equal(mon.body.source, "plan");
  assert.deepEqual(mon.body.blocks.map((b: { exerciseId: string }) => b.exerciseId), ["ex_squat", "ex_bench", "ex_row"]);
  const bench = mon.body.blocks[1];
  assert.equal(bench.name, "Bench Press");
  assert.deepEqual(bench.fallbacks, [
    { exerciseId: "ex_db_press", name: "Dumbbell Bench Press" },
    { exerciseId: "ex_pushup", name: "Push-up" },
  ]);
  assert.ok(bench.howTo.length > 0);
  // 3 x (45+120) + 3 x (45+120) + 3 x (45+90) = 1395 s
  assert.equal(mon.body.estimatedMinutes, 23);

  const tue = await request(a).get("/api/gym/briefing?date=2026-10-20").set(auth(token));
  assert.equal(tue.status, 200);
  assertContract(BriefingResponseSchema, tue.body);
  assert.equal(tue.body.source, "beginner");
  assert.deepEqual(tue.body.blocks.map((b: { exerciseId: string }) => b.exerciseId), [
    "ex_goblet_squat", "ex_db_press", "ex_db_row", "ex_dead_bug",
  ]);
  assert.equal(tue.body.estimatedMinutes, 24);
  for (const b of tue.body.blocks) assert.ok(b.fallbacks.length >= 1);
});

test("briefing defaults to the user's local date and rejects bad dates", { skip }, async () => {
  const a = app({ now: TUE_AFTER_MIDNIGHT });
  const { token } = await setup(a);
  const res = await request(a).get("/api/gym/briefing").set(auth(token));
  assert.equal(res.body.date, "2026-10-20");
  assert.equal(res.body.source, "beginner");
  assert.equal((await request(a).get("/api/gym/briefing?date=2026-13-45").set(auth(token))).status, 400);
  assert.equal((await request(a).get("/api/gym/briefing?date=tomorrow").set(auth(token))).status, 400);
  assert.equal((await request(a).get("/api/gym/briefing")).status, 401);
});

test("crowd report stores local weekday and hour, is idempotent on clientId, validates level", { skip }, async () => {
  const a = app({ now: TUE_AFTER_MIDNIGHT });
  const { token, id } = await setup(a);
  const post = (body: object) => request(a).post("/api/gym/crowd").set(auth(token)).send(body);
  const r = await post({ level: "quiet", clientId: "c1" });
  assert.equal(r.status, 201);
  assertContract(CrowdReportResponseSchema, r.body);
  assert.deepEqual(r.body, { ok: true, weekday: 2, hour: 0 });
  const again = await post({ level: "quiet", clientId: "c1" });
  assert.equal(again.status, 200); // idempotent replay of the stored response
  assert.deepEqual(again.body, r.body);
  const rows = await db!.select().from(gymCrowdReports);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.userId, id);
  assert.equal(rows[0]!.weekday, 2);
  assert.equal(rows[0]!.hour, 0);
  assert.equal((await post({ level: "empty" })).status, 400);
  assert.equal((await post({ level: "normal", sessionId: "00000000-0000-4000-8000-000000000000" })).status, 404);
});

test("quiet hours needs 3 reports", { skip }, async () => {
  const a = app({ now: MON_NOON });
  const { token } = await setup(a);
  const get = () => request(a).get("/api/gym/quiet-hours").set(auth(token));
  const empty = await get();
  assertContract(QuietHoursResponseSchema, empty.body);
  assert.deepEqual(empty.body, { suggestions: [], needed: 3 });
  await request(a).post("/api/gym/crowd").set(auth(token)).send({ level: "quiet", clientId: "a" });
  await request(a).post("/api/gym/crowd").set(auth(token)).send({ level: "quiet", clientId: "b" });
  assert.deepEqual((await get()).body, { suggestions: [], needed: 1 });
});

test("quiet hours ranks quiet share and is per user", { skip }, async () => {
  const a = app({ now: MON_NOON });
  const { token, id } = await setup(a);
  const other = await setup(a, { email: "bob@example.com", username: "bob_1" });
  await db!.insert(gymCrowdReports).values([
    { userId: id, level: "quiet", weekday: 2, hour: 7 },
    { userId: id, level: "quiet", weekday: 2, hour: 7 },
    { userId: id, level: "quiet", weekday: 3, hour: 18 },
    { userId: id, level: "packed", weekday: 3, hour: 18 },
    { userId: id, level: "packed", weekday: 5, hour: 17 },
    { userId: other.id, level: "quiet", weekday: 6, hour: 10 },
  ]);
  const res = await request(a).get("/api/gym/quiet-hours").set(auth(token));
  assertContract(QuietHoursResponseSchema, res.body);
  assert.deepEqual(res.body, {
    suggestions: [
      { weekday: 2, hour: 7, quietShare: 1 },
      { weekday: 3, hour: 18, quietShare: 0.5 },
    ],
    needed: 0,
  });
});
