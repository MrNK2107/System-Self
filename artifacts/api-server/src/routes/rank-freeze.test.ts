import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { dailySnapshots, idempotencyKeys, profiles, quests, rankFreezes } from "@workspace/db";
import {
  FREEZE_ACTIVE_CODE,
  FREEZE_COOLDOWN_CODE,
  FREEZE_USED_CODE,
  ProRequiredSchema,
  QuestTrendSchema,
  RankFreezeResponseSchema,
  RankFreezeStatusSchema,
  ScoreHistorySchema,
} from "@workspace/contracts";
import { addDays } from "@workspace/engine";
import { app, assertContract, auth, db, setup, skip } from "./game-test-helpers";
import { grantEntitlement } from "../services/entitlements";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const at = (iso: string) => new Date(iso);
let clock = at("2026-03-10T08:00:00Z"); // 13:30 in Asia/Kolkata
const a = () => app({ now: () => clock });

let n = 0;
async function mk(isPro: boolean) {
  const username = `u_fz${n++}`;
  const { token, id } = await setup(a(), { email: `${username}@example.com`, username });
  if (isPro) await grantEntitlement(db!, id, "pro", null, clock);
  return { token, id };
}
type U = Awaited<ReturnType<typeof mk>>;

const freeze = (u: U, reason = "travelling", key?: string) => {
  const r = request(a()).post("/api/rank-freeze").set(auth(u.token));
  if (key) r.set("Idempotency-Key", key);
  return r.send({ reason });
};
const status = (u: U) => request(a()).get("/api/rank-freeze").set(auth(u.token));
const setClock = (iso: string) => {
  clock = at(iso);
};

test("free user: POST is 402 pro_required and writes nothing", { skip }, async () => {
  setClock("2026-03-10T08:00:00Z");
  const u = await mk(false);
  const res = await freeze(u);
  assert.equal(res.status, 402);
  assertContract(ProRequiredSchema, res.body);
  assert.equal((await db!.select().from(rankFreezes)).length, 0);
});

test("PRO: freeze covers 7 local days inclusive of today; status reflects it; reason is trimmed", { skip }, async () => {
  setClock("2026-03-10T08:00:00Z");
  const u = await mk(true);
  const before = await status(u);
  assert.equal(before.status, 200);
  assertContract(RankFreezeStatusSchema, before.body);
  assert.deepEqual(before.body, { active: false, until: null, usedThisMonth: false, availableFrom: null });

  const res = await freeze(u, "  trip abroad  ");
  assert.equal(res.status, 200);
  assertContract(RankFreezeResponseSchema, res.body);
  assert.deepEqual(res.body, { until: "2026-03-16" });
  const [row] = await db!.select().from(rankFreezes).where(eq(rankFreezes.userId, u.id));
  assert.equal(row!.reason, "trip abroad");
  assert.equal(row!.startedOn, "2026-03-10");

  const now = await status(u);
  assert.deepEqual(now.body, { active: true, until: "2026-03-16", usedThisMonth: true, availableFrom: "2026-04-01" });
});

test("reason is required and at most 120 characters", { skip }, async () => {
  setClock("2026-03-10T08:00:00Z");
  const u = await mk(true);
  assert.equal((await freeze(u, "   ")).status, 400);
  assert.equal((await freeze(u, "x".repeat(121))).status, 400);
  assert.equal((await request(a()).post("/api/rank-freeze").set(auth(u.token)).send({})).status, 400);
  assert.equal((await freeze(u, "x".repeat(120))).status, 200);
});

test("Review Focus 4: a second freeze in the same local month is 409 freeze_used; while active it is freeze_active", { skip }, async () => {
  setClock("2026-03-10T08:00:00Z");
  const u = await mk(true);
  assert.equal((await freeze(u)).status, 200);
  const during = await freeze(u, "again");
  assert.equal(during.status, 409);
  assert.equal(during.body.code, FREEZE_ACTIVE_CODE);

  setClock("2026-03-20T08:00:00Z"); // over, same month
  const used = await freeze(u, "again");
  assert.equal(used.status, 409);
  assert.equal(used.body.code, FREEZE_USED_CODE);
  assert.equal((await db!.select().from(rankFreezes)).length, 1);
  const st = await status(u);
  assert.deepEqual(st.body, { active: false, until: null, usedThisMonth: true, availableFrom: "2026-04-01" });
});

test("Review Focus 4: a freeze started on the 30th into next month counts for its start month; the 6th is allowed", { skip }, async () => {
  setClock("2026-03-30T08:00:00Z");
  const u = await mk(true);
  const first = await freeze(u);
  assert.deepEqual(first.body, { until: "2026-04-05" });

  setClock("2026-04-03T08:00:00Z"); // still frozen, and April is not yet used
  const during = await freeze(u, "again");
  assert.equal(during.status, 409);
  assert.equal(during.body.code, FREEZE_ACTIVE_CODE);
  const st = await status(u);
  assert.deepEqual(st.body, { active: true, until: "2026-04-05", usedThisMonth: false, availableFrom: "2026-04-13" });

  // April is unused but a freeze may not stack straight onto the last one: 7 unfrozen days must separate them.
  setClock("2026-04-06T08:00:00Z");
  const stacked = await freeze(u, "april");
  assert.equal(stacked.status, 409);
  assert.equal(stacked.body.code, FREEZE_COOLDOWN_CODE);
  setClock("2026-04-12T08:00:00Z");
  assert.equal((await freeze(u, "april")).body.code, FREEZE_COOLDOWN_CODE);
  setClock("2026-04-13T08:00:00Z");
  const next = await freeze(u, "april");
  assert.equal(next.status, 200);
  assert.deepEqual(next.body, { until: "2026-04-19" });
});

// GET availableFrom is the earliest day a POST succeeds: it works that day and fails the day before.
async function probeAvailable(startClock: string, laterClock: string, expectFrom: string, expectCode: string) {
  setClock(startClock);
  const u = await mk(true);
  assert.equal((await freeze(u)).status, 200);
  setClock(laterClock);
  const st = await status(u);
  assert.equal(st.body.availableFrom, expectFrom);
  setClock(`${addDays(expectFrom, -1)}T08:00:00Z`);
  const early = await freeze(u, "early");
  assert.equal(early.status, 409);
  assert.equal(early.body.code, expectCode);
  setClock(`${expectFrom}T08:00:00Z`);
  const ok = await freeze(u, "on time");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
}

test("availableFrom is honoured by POST: month used", { skip }, async () => {
  await probeAvailable("2026-03-10T08:00:00Z", "2026-03-20T08:00:00Z", "2026-04-01", FREEZE_USED_CODE);
});

test("availableFrom is honoured by POST: cooldown after a freeze that ran into the next month", { skip }, async () => {
  await probeAvailable("2026-03-30T08:00:00Z", "2026-04-03T08:00:00Z", "2026-04-13", FREEZE_COOLDOWN_CODE);
});

test("availableFrom is honoured by POST: cooldown wins over an unused month", { skip }, async () => {
  await probeAvailable("2026-03-25T08:00:00Z", "2026-04-02T08:00:00Z", "2026-04-08", FREEZE_COOLDOWN_CODE);
});

test("POST before onboarding finishes is 409 not_onboarded and writes nothing", { skip }, async () => {
  setClock("2026-03-10T08:00:00Z");
  const u = await mk(true);
  await db!.delete(profiles).where(eq(profiles.userId, u.id));
  const res = await freeze(u);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "not_onboarded");
  assert.equal((await db!.select().from(rankFreezes)).length, 0);
});

test("the local month decides: 23:00 UTC on 31 March is already 1 April in Asia/Kolkata", { skip }, async () => {
  setClock("2026-03-10T08:00:00Z");
  const u = await mk(true);
  assert.equal((await freeze(u)).status, 200);
  setClock("2026-03-31T23:00:00Z"); // 2026-04-01 04:30 local
  const res = await freeze(u, "new month");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { until: "2026-04-07" });
});

test("idempotent replay: same key returns the stored result, one row, and replays after PRO lapses", { skip }, async () => {
  setClock("2026-03-10T08:00:00Z");
  const u = await mk(true);
  const first = await freeze(u, "trip", "fz-key-1");
  assert.equal(first.status, 200);
  const again = await freeze(u, "trip", "fz-key-1");
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
  assert.equal((await db!.select().from(rankFreezes)).length, 1);
  assert.equal((await db!.select().from(idempotencyKeys)).length, 1);

  await grantEntitlement(db!, u.id, "free", null, clock);
  const lapsed = await freeze(u, "trip", "fz-key-1");
  assert.equal(lapsed.status, 200);
  assert.deepEqual(lapsed.body, first.body);
  assert.equal((await freeze(u, "trip", "fz-key-2")).status, 402);
});

async function seedHistory(userId: string, days: number, endDate: string) {
  for (let i = 0; i < days; i++) {
    await db!.insert(dailySnapshots).values({
      userId,
      localDate: addDays(endDate, -i),
      scores: { BODY: 20 + i, MIND: 30, WEALTH: 10, SOCIAL: 5, DISCIPLINE: 40 },
      hidden: 77.7,
      rank: "C",
    });
  }
}
const scores = (u: U, q: string) => request(a()).get(`/api/history/scores${q}`).set(auth(u.token));
const trend = (u: U, q: string) => request(a()).get(`/api/history/quests${q}`).set(auth(u.token));

test("history scores: free requesting 90 days gets 14 (200); PRO gets 90; hidden is absent everywhere", { skip }, async () => {
  setClock("2026-03-10T08:00:00Z");
  const free = await mk(false);
  const pro = await mk(true);
  await seedHistory(free.id, 40, "2026-03-10");
  await seedHistory(pro.id, 40, "2026-03-10");

  const f = await scores(free, "?days=90");
  assert.equal(f.status, 200);
  assertContract(ScoreHistorySchema, f.body);
  assert.equal(f.body.days, 14);
  assert.equal(f.body.from, "2026-02-25");
  assert.equal(f.body.to, "2026-03-10");
  assert.equal(f.body.items.length, 14);
  assert.equal(f.body.items[0].date, "2026-02-25"); // ascending
  assert.equal(f.body.items[13].date, "2026-03-10");
  assert.deepEqual(Object.keys(f.body.items[0]).sort(), ["date", "rank", "scores"]);
  assert.doesNotMatch(JSON.stringify(f.body), /hidden/i);

  const p90 = await scores(pro, "?days=90");
  assert.equal(p90.status, 200);
  assert.equal(p90.body.days, 90);
  assert.equal(p90.body.items.length, 40);
  assert.doesNotMatch(JSON.stringify(p90.body), /hidden/i);
  assert.equal((await scores(pro, "?days=365")).body.days, 365);
});

test("history: days must be an integer 1..365", { skip }, async () => {
  setClock("2026-03-10T08:00:00Z");
  const u = await mk(true);
  for (const bad of ["0", "366", "abc", "1.5", "-3", ""]) {
    assert.equal((await scores(u, `?days=${bad}`)).status, 400, `scores days=${bad}`);
    assert.equal((await trend(u, `?days=${bad}`)).status, 400, `quests days=${bad}`);
  }
  assert.equal((await scores(u, "")).status, 200);
  assert.equal((await scores(u, "?days=1")).status, 200);
});

test("quest trend excludes bonus quests and is clamped for free users", { skip }, async () => {
  setClock("2026-03-10T08:00:00Z");
  const free = await mk(false);
  const exp = at("2026-03-10T10:00:00Z");
  const row = (status: string, day: string, bonus: boolean) => ({
    userId: free.id, type: "daily", title: "t", description: "d", domain: "BODY", status, expiresAt: exp, resolvedLocalDate: day, bonus,
  });
  await db!.insert(quests).values([
    row("complete", "2026-03-10", false),
    row("failed", "2026-03-10", false),
    row("complete", "2026-03-10", true),
    row("complete", "2026-03-10", true),
    row("failed", "2026-03-09", true),
    row("complete", "2026-01-01", false), // outside the free window
  ]);
  const res = await trend(free, "?days=90");
  assert.equal(res.status, 200);
  assertContract(QuestTrendSchema, res.body);
  assert.equal(res.body.days, 14);
  assert.deepEqual(res.body.items, [{ date: "2026-03-10", completed: 1, resolved: 2 }]);
});
