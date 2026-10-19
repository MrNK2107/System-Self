import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { notices, quests, scoreEvents, userDayState } from "@workspace/db";
import { localDate } from "@workspace/engine";
import { QuestCompleteResponseSchema, QuestListResponseSchema, QuestRefuseResponseSchema, QuestSchema } from "@workspace/contracts";
import { app, assertContract, assertStoredNoticesMatchContract, auth, db, score, setup, skip, TZ } from "./game-test-helpers";
import { grantEntitlement } from "../services/entitlements";
import { createQuests } from "../services/quests";
import { ensureRolledOver } from "../services/rollover";
import { buildUserContext } from "../services/ai-context";
import { buildWeeklyRecap } from "../services/recap";
import { computeDebriefFacts } from "../services/debrief";
import { hiddenAndTrajectoryBatch } from "../services/state";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

let clock = new Date();
const a = () => app({ now: () => clock });

async function pro(name = "alice_1") {
  clock = new Date();
  const { token, id } = await setup(a(), { email: `${name}@example.com`, username: name });
  await grantEntitlement(db!, id, "pro", null, clock);
  return { token, id };
}
const bonus = (token: string, key?: string) => {
  const r = request(a()).post("/api/quests/bonus").set(auth(token));
  if (key) r.set("Idempotency-Key", key);
  return r.send({});
};
const events = (id: string) => db!.select().from(scoreEvents).where(eq(scoreEvents.userId, id));

test("bonus quest: free is 402 pro_required and nothing is created", { skip }, async () => {
  clock = new Date();
  const { token, id } = await setup(a());
  const res = await bonus(token);
  assert.equal(res.status, 402);
  assert.equal(res.body.code, "pro_required");
  assert.equal((await db!.select().from(quests).where(eq(quests.userId, id))).length, 0);
});

test("bonus quest: PRO gets a daily flagged bonus; the 4th that local day is 409 bonus_limit; the next day resets", { skip }, async () => {
  const { token, id } = await pro();
  const first = await bonus(token);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const q = assertContract(QuestSchema, first.body.quest);
  assert.equal(q.bonus, true);
  assert.equal(q.type, "daily");
  assert.equal(q.status, "active");
  assert.equal(first.body.remaining, 2);
  assert.equal((await bonus(token)).status, 201);
  assert.equal((await bonus(token)).status, 201);
  const over = await bonus(token);
  assert.equal(over.status, 409);
  assert.equal(over.body.code, "bonus_limit");
  assert.equal((await db!.select().from(quests).where(and(eq(quests.userId, id), eq(quests.bonus, true)))).length, 3);
  const list = assertContract(QuestListResponseSchema, (await request(a()).get("/api/quests").set(auth(token))).body);
  assert.equal(list.active.filter((x) => x.bonus).length, 3);
  // titles of one day's bonus quests are distinct
  assert.equal(new Set(list.active.map((x) => x.title)).size, list.active.length);
  clock = new Date(clock.getTime() + 26 * 3600_000);
  assert.equal((await bonus(token)).status, 201, "a new local day has a fresh allowance");
});

test("bonus quest: idempotent by key, a replay creates nothing and still answers after PRO lapses", { skip }, async () => {
  const { token, id } = await pro();
  const r1 = await bonus(token, "bonus-key-1");
  const r2 = await bonus(token, "bonus-key-1");
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body, r1.body);
  assert.equal((await db!.select().from(quests).where(eq(quests.userId, id))).length, 1);
  await grantEntitlement(db!, id, "free", null, clock);
  const r3 = await bonus(token, "bonus-key-1");
  assert.equal(r3.status, 200);
  assert.equal((await bonus(token, "bonus-key-2")).status, 402);
});

test("bonus quests do not count toward the daily board, and generate still tops up three regular dailies", { skip }, async () => {
  const { token, id } = await pro();
  await bonus(token);
  const gen = await request(a()).post("/api/quests/generate").set(auth(token)).send({});
  assert.equal(gen.status, 200);
  const regular = (gen.body.active as { type: string; bonus: boolean }[]).filter((q) => q.type === "daily" && !q.bonus);
  assert.equal(regular.length, 3);
  assert.equal((await db!.select().from(quests).where(and(eq(quests.userId, id), eq(quests.bonus, true)))).length, 1);
});

test("completing a bonus quest writes no score_events, changes no score or streak, and says so", { skip }, async () => {
  const { token, id } = await pro();
  const q = (await bonus(token)).body.quest;
  const before = await score(id, "DISCIPLINE");
  const eventsBefore = (await events(id)).length;
  const res = await request(a()).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assertContract(QuestCompleteResponseSchema, res.body);
  assert.equal(res.body.quest.status, "complete");
  assert.equal(res.body.quest.bonus, true);
  assert.deepEqual(res.body.results, []);
  assert.equal((await events(id)).length, eventsBefore);
  const after = await score(id, "DISCIPLINE");
  assert.equal(after.score, before.score);
  assert.equal(after.streak, before.streak);
  const [day] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.equal(day?.lastActivityDate ?? null, null, "a bonus completion is not activity");
  assert.equal((await request(a()).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({})).status, 409);
});

test("refusing bonus quests writes no score_events and never uses the weekly refusal allowance", { skip }, async () => {
  const { token, id } = await pro();
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push((await bonus(token)).body.quest.id);
  const eventsBefore = (await events(id)).length;
  for (const qid of ids) {
    const res = await request(a()).post(`/api/quests/${qid}/refuse`).set(auth(token)).send({ reason: "not today" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assertContract(QuestRefuseResponseSchema, res.body);
    assert.equal(res.body.penalty, 0);
    assert.deepEqual(res.body.results, []);
    assert.equal(res.body.quest.bonus, true);
  }
  assert.equal((await events(id)).length, eventsBefore);
  // the real weekly allowance is untouched: the first regular refusal is still free, the second still costs
  const [r1] = await createQuests(db!, id, [{ type: "daily", title: "R1", description: "d", domain: "MIND", expiresAt: new Date(clock.getTime() + 3600_000) }]);
  const free = await request(a()).post(`/api/quests/${r1!.id}/refuse`).set(auth(token)).send({ reason: "r" });
  assert.equal(free.status, 200);
  assert.equal(free.body.penalty, 0);
});

test("a bonus quest that expires fails with no score_events, a zero-penalty notice, and no shame", { skip }, async () => {
  const { token, id } = await pro();
  const q = (await bonus(token)).body.quest as { id: string };
  const later = new Date(clock.getTime() + 3 * 86_400_000);
  await ensureRolledOver(db!, id, later);
  const [row] = await db!.select().from(quests).where(eq(quests.id, q.id));
  assert.equal(row!.status, "failed");
  assert.deepEqual((await events(id)).filter((e) => e.refId === q.id), []);
  assert.equal((await events(id)).filter((e) => e.reason === "quest_failed").length, 0);
  const failed = await db!.select().from(notices).where(and(eq(notices.userId, id), eq(notices.kind, "quest_failed")));
  assert.equal(failed.length, 1);
  assert.equal((failed[0]!.payload as { penalty: number }).penalty, 0);
});

test("shame mode cannot be enabled on a bonus quest", { skip }, async () => {
  const { token } = await pro();
  const q = (await bonus(token)).body.quest as { id: string };
  const res = await request(a()).patch(`/api/quests/${q.id}/shame`).set(auth(token)).send({ enabled: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "bonus_no_shame");
});

test("every ranking input ignores resolved bonus quests", { skip }, async () => {
  const { token, id } = await pro();
  const now = clock;
  const tz = TZ;
  const today = localDate(now, tz);
  const scoreMap = { BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 };
  const hiddenBefore = (await hiddenAndTrajectoryBatch(db!, [{ userId: id, today, scoreMap }])).get(id)!.hidden;
  const base = { userId: id, type: "daily", title: "B", description: "d", domain: "MIND", expiresAt: now, resolvedAt: now, resolvedLocalDate: today, bonus: true };
  await db!.insert(quests).values([
    { ...base, status: "complete" },
    { ...base, status: "failed" },
    { ...base, status: "failed" },
    { ...base, status: "refused", refusalReason: "tired" },
  ]);
  assert.equal((await hiddenAndTrajectoryBatch(db!, [{ userId: id, today, scoreMap }])).get(id)!.hidden, hiddenBefore);
  const ctx = (await buildUserContext(db!, id, now))!;
  assert.equal(ctx.completionRate30, null);
  assert.equal(ctx.deferralsThisWeek, 0);
  assert.deepEqual(ctx.recentRefusals, []);
  const recap = await buildWeeklyRecap(db!, id, today, tz);
  assert.deepEqual([recap.questsCompleted, recap.questsFailed, recap.questsRefused], [0, 0, 0]);
  const facts = await computeDebriefFacts(db!, id, today);
  assert.deepEqual([facts.questCompleted, facts.questTotal], [0, 0]);
  const deferrals = await request(a()).get("/api/adherence/deferrals").set(auth(token));
  assert.equal(deferrals.status, 200);
  assert.deepEqual(deferrals.body.items, []);
});
