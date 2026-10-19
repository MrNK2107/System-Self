import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { achievements, analyticsEvents, domainScores, clanMembers, clans, comebacks, dailySnapshots, notices, quests, scoreEvents, userDayState } from "@workspace/db";
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
import { raidMetrics } from "../services/raids";
import { clanMembersView } from "../services/clans";
import { evaluateComeback } from "../services/comeback";
import { withUserLock } from "../services/user-lock";

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
  assert.equal((failed[0]!.payload as { bonus?: boolean }).bonus, true, "the app can tell a bonus expiry from a penalty");
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

// ---- regression: every other ranking input -------------------------------------------------------------

const row = (id: string, over: Record<string, unknown>) => ({
  userId: id, type: "daily", title: "B", description: "d", domain: "MIND", expiresAt: clock, resolvedAt: clock,
  resolvedLocalDate: localDate(clock, TZ), bonus: true, ...over,
});

test("bonus quests do not move the clan member %, the raid discipline metric, achievements or the comeback checklist", { skip }, async () => {
  const { token, id } = await pro();
  const today = localDate(clock, TZ);
  const [clan] = await db!.insert(clans).values({ name: "C1", nameLower: "c1", tag: "TST", inviteCode: "INV00001" }).returning();
  await db!.insert(clanMembers).values({ userId: id, clanId: clan!.id, role: "leader", joinedAt: new Date(clock.getTime() - 5 * 86_400_000) });
  const span = { start: new Date(clock.getTime() - 86_400_000), end: new Date(clock.getTime() + 86_400_000) };
  const rate = async () => (await clanMembersView(db!, clan!.id, id, clock)).find((m) => m.isSelf)!.questCompletionRate30d;
  const raid = async () => (await raidMetrics(db!, [clan!.id], "discipline", span)).get(clan!.id);

  await db!.insert(quests).values([
    row(id, { status: "complete" }), row(id, { status: "failed" }), row(id, { status: "failed" }), row(id, { status: "refused", refusalReason: "x" }),
  ]);
  assert.equal(await rate(), null, "clan member % ignores bonus rows");
  assert.equal(await raid(), 0, "raid discipline ignores bonus rows");
  await db!.insert(quests).values(row(id, { bonus: false, status: "complete" }));
  assert.equal(await rate(), 100);
  assert.equal(await raid(), 100);

  // achievements: 9 completed bonus quests plus 1 regular completion is not "quest_10"
  await db!.insert(quests).values(Array.from({ length: 9 }, () => row(id, { status: "complete" })));
  const [active] = await db!.insert(quests).values(row(id, { bonus: false, status: "active", resolvedAt: null, resolvedLocalDate: null, expiresAt: new Date(clock.getTime() + 3600_000) })).returning();
  const done = await request(a()).post(`/api/quests/${active!.id}/complete`).set(auth(token)).send({});
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const unlocked = (await db!.select().from(achievements).where(eq(achievements.userId, id))).map((x) => x.achievementId);
  assert.ok(!unlocked.includes("quest_10"), unlocked.join());

  // comeback checklist: an open bonus daily does not block "complete today's quests", a bonus completion does not satisfy it
  const comeback = async () => {
    await db!.delete(comebacks).where(eq(comebacks.userId, id));
    await db!.insert(comebacks).values({ userId: id, startedOn: today, gapDays: 3 });
    const r = await withUserLock(db!, id, (tx) => evaluateComeback(tx, id, clock));
    return r.active?.checklist.find((c) => c.key === "quests_today")?.done;
  };
  await db!.delete(quests).where(eq(quests.userId, id));
  await db!.insert(quests).values(row(id, { status: "complete" }));
  assert.equal(await comeback(), false, "only a bonus completion");
  await db!.insert(quests).values(row(id, { bonus: false, status: "complete" }));
  await db!.insert(quests).values(row(id, { status: "active", resolvedAt: null, resolvedLocalDate: null, expiresAt: new Date(clock.getTime() + 3600_000) }));
  assert.equal(await comeback(), true, "an open bonus daily does not block it");
});

test("the rollover snapshot hidden score ignores bonus quests (twin user comparison)", { skip }, async () => {
  const x = await pro("twin_x");
  const y = await pro("twin_y");
  // Non-zero scores (the hidden score is a weighted sum) and at least 5 resolved quests mostly failed: without the
  // filter the completion rate is 1/7 < 0.5, so the multiplier drops to 0.85 and the hidden score differs.
  for (const u of [x, y]) await db!.update(domainScores).set({ score: 50 }).where(eq(domainScores.userId, u.id));
  await db!.insert(quests).values([
    row(x.id, { status: "complete" }),
    ...Array.from({ length: 5 }, () => row(x.id, { status: "failed" })),
    row(x.id, { status: "refused", refusalReason: "x" }),
  ]);
  const later = new Date(clock.getTime() + 2 * 86_400_000);
  await ensureRolledOver(db!, x.id, later);
  await ensureRolledOver(db!, y.id, later);
  const snap = async (id: string) => (await db!.select().from(dailySnapshots).where(eq(dailySnapshots.userId, id))).sort((p, q) => (p.localDate < q.localDate ? 1 : -1))[0]!;
  const sx = await snap(x.id);
  const sy = await snap(y.id);
  assert.equal(sx.localDate, sy.localDate);
  assert.ok(sy.hidden > 0, "a non-zero hidden score, so the multiplier matters");
  assert.equal(sx.hidden, sy.hidden);
});

test("a floor_session log cannot complete a floor offer through a refused bonus quest id", { skip }, async () => {
  const { token } = await pro();
  const bonusId = (await bonus(token)).body.quest.id as string;
  const refused = await request(a()).post(`/api/quests/${bonusId}/refuse`).set(auth(token)).send({ reason: "no" });
  assert.equal(refused.status, 200);
  const res = await request(a()).post("/api/logs").set(auth(token)).send({
    clientId: "fl-1", domain: "BODY", logType: "floor_session", data: { routineId: "push_floor", minutes: 13, refusedQuestId: bonusId },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await db!.select().from(analyticsEvents).where(eq(analyticsEvents.name, "floor_completed"))).length, 0);
});
