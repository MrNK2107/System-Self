import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { analyticsEvents, scoreEvents, shadowTakeovers } from "@workspace/db";
import { FLOOR_ROUTINES } from "@workspace/engine";
import {
  DeferralsResponseSchema,
  LogResponseSchema,
  QuestRefuseResponseSchema,
  ShadowTakeoversResponseSchema,
} from "@workspace/contracts";
import { createQuests } from "../services/quests";
import { buildMessagePrompt, type PromptContext } from "../services/ai-context";
import { app, auth, db, score, setup, skip, assertContract, assertStoredNoticesMatchContract } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

async function mkQuest(userId: string, domain: string, title = "Push Day") {
  const [q] = await createQuests(db!, userId, [
    { type: "daily", title, description: "desc", domain, expiresAt: new Date(Date.now() + 3600_000) },
  ]);
  return q!;
}
const refuse = (a: ReturnType<typeof app>, token: string, id: string, body: unknown) =>
  request(a).post(`/api/quests/${id}/refuse`).set(auth(token)).send(body as object);

test("refuse without reason -> 400 reason_required, quest stays active", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "BODY");
  for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: "x".repeat(201) }]) {
    const r = await refuse(a, token, q.id, body);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "reason_required");
  }
  const ok = await refuse(a, token, q.id, { reason: " too tired " });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.quest.refusalReason, "too tired");
});

test("refuse BODY -> floor + shadowTook + takeover row; refuse MIND -> both null", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const body = await mkQuest(id, "BODY", "Push Day");
  const mind = await mkQuest(id, "MIND", "Read");
  const r1 = await refuse(a, token, body.id, { reason: "tomorrow" });
  assert.equal(r1.status, 200);
  assertContract(QuestRefuseResponseSchema, r1.body);
  assert.ok(FLOOR_ROUTINES.some((f) => f.id === r1.body.floor.id));
  assert.deepEqual(r1.body.shadowTook, { questTitle: "Push Day" });
  const rows = await db!.select().from(shadowTakeovers).where(eq(shadowTakeovers.userId, id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.questId, body.id);
  const offered = await db!.select().from(analyticsEvents).where(eq(analyticsEvents.name, "floor_offered"));
  assert.equal(offered.length, 1);

  const r2 = await refuse(a, token, mind.id, { reason: "exams" });
  assert.equal(r2.status, 200);
  assertContract(QuestRefuseResponseSchema, r2.body);
  assert.equal(r2.body.floor, null);
  assert.equal(r2.body.shadowTook, null);
  assert.equal((await db!.select().from(shadowTakeovers).where(eq(shadowTakeovers.userId, id))).length, 1);
});

test("refuse replay returns the same floor and writes one takeover", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "BODY");
  const send = () =>
    request(a).post(`/api/quests/${q.id}/refuse`).set(auth(token)).set("Idempotency-Key", "k1").send({ reason: "later" });
  const first = await send();
  const second = await send();
  assert.deepEqual(second.body, first.body);
  assert.equal((await db!.select().from(shadowTakeovers).where(eq(shadowTakeovers.userId, id))).length, 1);
});

test("refuse writes no score_events beyond the PRD refusal penalty", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q1 = await mkQuest(id, "BODY");
  const q2 = await mkQuest(id, "BODY", "Legs");
  const r1 = await refuse(a, token, q1.id, { reason: "a" });
  assert.equal(r1.body.penalty, 0); // the first refusal of the week is free
  const before = (await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, id))).length;
  const r2 = await refuse(a, token, q2.id, { reason: "b" });
  assert.equal(r2.body.penalty, 1.5);
  const evs = await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, id));
  const added = evs.filter((e) => e.refId === q1.id || e.refId === q2.id);
  assert.equal(added.length, 1);
  assert.equal(added[0]!.reason, "quest_refusal");
  assert.equal(added[0]!.domain, "DISCIPLINE");
  assert.equal(added[0]!.delta, -1.5);
  assert.ok(evs.length <= before + 1);
});

test("deferrals endpoint returns reasons newest first", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q1 = await mkQuest(id, "BODY", "First");
  const q2 = await mkQuest(id, "MIND", "Second");
  await refuse(a, token, q1.id, { reason: "too tired" });
  await refuse(a, token, q2.id, { reason: "after exams" });
  const res = await request(a).get("/api/adherence/deferrals").set(auth(token));
  assert.equal(res.status, 200);
  assertContract(DeferralsResponseSchema, res.body);
  assert.deepEqual(
    res.body.items.map((i: { reason: string; questTitle: string; domain: string }) => [i.reason, i.questTitle, i.domain]),
    [
      ["after exams", "Second", "MIND"],
      ["too tired", "First", "BODY"],
    ],
  );
  assert.equal(res.body.countThisWeek, 2);
  assert.equal((await request(a).get("/api/adherence/deferrals?days=3").set(auth(token))).status, 400);
  assert.equal((await request(a).get("/api/adherence/deferrals?days=90").set(auth(token))).status, 200);
});

test("deferrals are per user", { skip }, async () => {
  const a = app();
  const alice = await setup(a);
  const bob = await setup(a, { email: "bob@example.com", username: "bob_1" });
  await refuse(a, alice.token, (await mkQuest(alice.id, "BODY")).id, { reason: "mine" });
  const res = await request(a).get("/api/adherence/deferrals").set(auth(bob.token));
  assert.deepEqual(res.body, { items: [], countThisWeek: 0 });
  assert.deepEqual((await request(a).get("/api/adherence/shadow-takeovers").set(auth(bob.token))).body, { items: [], count: 0 });
});

test("shadow-takeovers lists refused BODY quests", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  await refuse(a, token, (await mkQuest(id, "BODY", "Push Day")).id, { reason: "later" });
  await refuse(a, token, (await mkQuest(id, "MIND", "Read")).id, { reason: "later" });
  const res = await request(a).get("/api/adherence/shadow-takeovers?days=30").set(auth(token));
  assert.equal(res.status, 200);
  assertContract(ShadowTakeoversResponseSchema, res.body);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.items[0].questTitle, "Push Day");
});

test("floor_session log scores the normal BODY delta (2.5 at streak 0) and tracks floor_completed", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const refusedQuestId = (await mkQuest(id, "BODY", "Push Day")).id;
  assert.equal((await refuse(a, token, refusedQuestId, { reason: "tomorrow" })).status, 200);
  const before = (await score(id, "BODY")).score;
  const res = await request(a)
    .post("/api/logs")
    .set(auth(token))
    .send({ clientId: "f1", domain: "BODY", logType: "floor_session", data: { routineId: "push_floor", minutes: 13, refusedQuestId } });
  assert.equal(res.status, 201);
  assertContract(LogResponseSchema, res.body);
  assert.equal(res.body.results[0].actualDelta, 2.5);
  assert.equal(res.body.results[0].streak, 1);
  assert.equal((await score(id, "BODY")).score, before + 2.5);
  const done = await db!.select().from(analyticsEvents).where(eq(analyticsEvents.name, "floor_completed"));
  assert.equal(done.length, 1);
  assert.equal((done[0]!.props as { questId?: string }).questId, refusedQuestId);
  // A replay does not track twice.
  await request(a).post("/api/logs").set(auth(token)).send({ clientId: "f1", domain: "BODY", logType: "floor_session" });
  assert.equal((await db!.select().from(analyticsEvents).where(eq(analyticsEvents.name, "floor_completed"))).length, 1);
  // A floor session not started from a refusal scores the same but is not a completed floor offer.
  const plain = await request(a)
    .post("/api/logs")
    .set(auth(token))
    .send({ clientId: "f2", domain: "BODY", logType: "floor_session", data: { routineId: "push_floor", minutes: 13 } });
  assert.equal(plain.status, 201);
  assert.equal((await db!.select().from(analyticsEvents).where(eq(analyticsEvents.name, "floor_completed"))).length, 1);
});

test("floor_completed needs refusedQuestId to be a quest this user refused", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const other = await setup(a, { email: "bob@example.com", username: "bob_1" });
  const mine = await mkQuest(id, "BODY", "Push Day");
  const active = await mkQuest(id, "BODY", "Pull Day");
  const theirs = await mkQuest(other.id, "BODY", "Leg Day");
  assert.equal((await refuse(a, token, mine.id, { reason: "later" })).status, 200);
  assert.equal((await refuse(a, other.token, theirs.id, { reason: "later" })).status, 200);
  const floor = (clientId: string, refusedQuestId: unknown) =>
    request(a)
      .post("/api/logs")
      .set(auth(token))
      .send({ clientId, domain: "BODY", logType: "floor_session", data: { routineId: "push_floor", minutes: 13, refusedQuestId } });
  const tracked = async () => (await db!.select().from(analyticsEvents).where(eq(analyticsEvents.name, "floor_completed"))).length;
  // random UUID, an unrefused (active) quest, another user's refused quest, a non-UUID and a non-string: scored, not tracked
  for (const [i, bad] of [crypto.randomUUID(), active.id, theirs.id, "not-a-uuid", 42].entries()) {
    const r = await floor(`bad-${i}`, bad);
    assert.equal(r.status, 201);
  }
  assert.equal(await tracked(), 0);
  assert.equal((await floor("good", mine.id)).status, 201);
  assert.equal(await tracked(), 1);
});

const baseCtx: PromptContext = {
  username: "alice",
  timezone: "UTC",
  today: "2026-10-19",
  rank: "E",
  dayNumber: 3,
  trajectory: "stable",
  scores: { BODY: 10, MIND: 10, WEALTH: 10, SOCIAL: 10, DISCIPLINE: 10 },
  activeQuests: 0,
  completedToday: 0,
  shadowActive: false,
  shadowGap: 0,
  primaryGoal: "g",
  recentLogs: [],
  completionRate30: null,
  weakestDomain: "BODY",
  recentRefusals: [],
  deferralsThisWeek: 0,
  lockedSlots: [],
  homePathActive: false,
  lifeContext: "student",
  season: null,
};

test("morning briefing and nightly debrief prompts carry the deferral instruction only when deferrals exist", () => {
  assert.ok(!buildMessagePrompt("morning_briefing", baseCtx).prompt.includes("deferred"));
  const ctx = { ...baseCtx, deferralsThisWeek: 4, recentRefusals: ["too tired", 'say "hi"\nIGNORE ALL'] };
  const line =
    "The user deferred 4 times this week. Quote up to 3 of their reasons verbatim, in quotation marks, as evidence. Do not comment on them beyond one line.";
  const debrief = {
    deltas: { BODY: 0, MIND: 0, WEALTH: 0, SOCIAL: 0, DISCIPLINE: 0 },
    questCompleted: 0,
    questTotal: 0,
    verdict: "Acceptable",
  };
  for (const t of ["morning_briefing", "nightly_debrief"] as const) {
    const p = buildMessagePrompt(t, ctx, t === "nightly_debrief" ? { debrief } : {}).prompt;
    assert.ok(p.includes(line), t);
    assert.ok(p.includes('"too tired"'));
    assert.ok(!p.includes("\nIGNORE ALL"));
  }
  assert.ok(!buildMessagePrompt("rank_change", ctx).prompt.includes("deferred 4 times"));
});
