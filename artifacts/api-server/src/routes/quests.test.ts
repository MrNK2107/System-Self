import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { notices, questChains, quests, scoreEvents } from "@workspace/db";
import {
  ChainStartResponseSchema,
  ChainTemplatesResponseSchema,
  QuestCompleteResponseSchema,
  QuestListResponseSchema,
  QuestRefuseResponseSchema,
  SessionProofResponseSchema,
} from "@workspace/contracts";
import { createQuests } from "../services/quests";
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

async function mkQuest(
  userId: string,
  over: { expiresAt?: Date; domain?: string; title?: string; type?: "daily" | "weekly" | "arc"; bonus?: boolean } = {},
) {
  const [q] = await createQuests(db!, userId, [
    {
      type: over.type ?? "daily",
      title: over.title ?? "Do the thing",
      description: "desc",
      domain: over.domain ?? "MIND",
      expiresAt: over.expiresAt ?? new Date(Date.now() + 3600_000),
      ...(over.bonus ? { bonus: true } : {}),
    },
  ]);
  return q!;
}

const deltas = (body: { results: { domain: string; actualDelta: number }[] }) =>
  body.results.map((r) => [r.domain, r.actualDelta]);

test("complete a normal MIND quest credits MIND, +0.8 DISCIPLINE and the clean day; again is 409", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id); // "Do the thing", MIND, no minutes -> 45 min -> normal
  assert.equal(q.difficulty, "normal");
  const before = (await score(id, "DISCIPLINE")).score;
  const res = await request(a).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  assert.equal(res.status, 200);
  assertContract(QuestCompleteResponseSchema, res.body);
  assert.equal(res.body.quest.status, "complete");
  // MIND 3.5 * headroom(24)=0.610 = 2.1; DISCIPLINE 0.8 * headroom(12)=0.795 = 0.6;
  // it was the only daily, so the clean day: 1.2 * headroom(12.6)=0.785 = 0.9
  assert.deepEqual(deltas(res.body), [
    ["MIND", 2.1],
    ["DISCIPLINE", 0.6],
    ["DISCIPLINE", 0.9],
  ]);
  assert.equal(res.body.results[0].streak, 1);
  assert.equal(res.body.results[1].streak, 1);
  const again = await request(a).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "not_active");
  assert.equal((await score(id, "DISCIPLINE")).score, before + 1.5);
});

test("completing a normal SOCIAL quest credits SOCIAL and +0.8 DISCIPLINE", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, { domain: "SOCIAL", title: "Call one person" }); // 1 -> normal
  await mkQuest(id); // another daily still open: no clean day
  assert.equal(q.difficulty, "normal");
  const res = await request(a).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  assert.equal(res.status, 200);
  assertContract(QuestCompleteResponseSchema, res.body);
  assert.equal(res.body.quest.difficulty, "normal");
  // SOCIAL 3.5 * headroom(28)=0.553 = 1.94 -> 1.9; DISCIPLINE 0.8 * headroom(12)=0.795 = 0.64 -> 0.6
  assert.deepEqual(deltas(res.body), [
    ["SOCIAL", 1.9],
    ["DISCIPLINE", 0.6],
  ]);
  assert.equal((await score(id, "SOCIAL")).score, 29.9);
  assert.equal((await score(id, "DISCIPLINE")).score, 12.6);
  const evs = await db!.select().from(scoreEvents).where(and(eq(scoreEvents.userId, id), eq(scoreEvents.refId, q.id)));
  assert.deepEqual(evs.map((e) => [e.domain, e.reason, e.delta]).sort(), [
    ["DISCIPLINE", "quest_complete", 0.8],
    ["SOCIAL", "quest_complete", 3.5],
  ]);
});

test("a workout quest can't be tapped complete: it needs a live session (409 proof_required)", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, { domain: "BODY", title: "Train for 30 minutes" });
  const res = await request(a).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "proof_required");
  const [row] = await db!.select().from(quests).where(eq(quests.id, q.id));
  assert.equal(row!.status, "active");
});

test("daily cap: after a log uses WEALTH's 0.5 log cap, a hard WEALTH quest still adds up to the 4 cap", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const log = await request(a).post("/api/logs").set(auth(token)).send({ clientId: "cap1", domain: "WEALTH", logType: "generic" });
  assert.equal(log.body.results[0].actualDelta, 0.5);
  const extra = await request(a).post("/api/logs").set(auth(token)).send({ clientId: "cap2", domain: "WEALTH", logType: "generic" });
  assert.equal(extra.body.results[0].actualDelta, 0, "a second log the same day adds nothing");
  const q = await mkQuest(id, { domain: "WEALTH", title: "Three week savings arc", type: "arc" }); // arcs are hard
  assert.equal(q.difficulty, "hard");
  const res = await request(a).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  assert.equal(res.status, 200);
  // 5.5 * headroom(16.5)=0.723 = 3.98, clipped to what is left of the 4 cap: 4 - 0.5 = 3.5
  assert.deepEqual(deltas(res.body)[0], ["WEALTH", 3.5]);
  assert.equal((await score(id, "WEALTH")).score, 20);
});

test("the clean day bonus is given once, when the last daily is completed, and not again", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q1 = await mkQuest(id);
  const q2 = await mkQuest(id);
  await mkQuest(id, { bonus: true }); // an open bonus daily does not block the clean day
  const r1 = await request(a).post(`/api/quests/${q1.id}/complete`).set(auth(token)).send({});
  assert.equal(r1.status, 200);
  assert.equal(r1.body.results.length, 2, "q2 is still open: no clean day yet");
  const r2 = await request(a).post(`/api/quests/${q2.id}/complete`).set(auth(token)).send({});
  assert.equal(r2.status, 200);
  // DISCIPLINE 12 -> +0.6 (q1) = 12.6 -> +0.6 (q2: 0.8 * headroom(12.6)=0.785 = 0.63) = 13.2 -> clean 1.2 * headroom(13.2)=0.775 = 0.9
  assert.deepEqual(deltas(r2.body).slice(1), [
    ["DISCIPLINE", 0.6],
    ["DISCIPLINE", 0.9],
  ]);
  // A daily added later the same day and completed does not pay the clean day twice.
  const q3 = await mkQuest(id);
  const r3 = await request(a).post(`/api/quests/${q3.id}/complete`).set(auth(token)).send({});
  assert.equal(r3.status, 200);
  assert.equal(r3.body.results.length, 2);
  const clean = await db!.select().from(scoreEvents).where(and(eq(scoreEvents.userId, id), eq(scoreEvents.reason, "clean_day")));
  assert.equal(clean.length, 1);
  assert.equal(clean[0]!.actualDelta, 0.9);
});

test("expired or unknown quest is not completable", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const expired = await mkQuest(id, { expiresAt: new Date(Date.now() - 1000) });
  const r = await request(a).post(`/api/quests/${expired.id}/complete`).set(auth(token)).send({});
  assert.equal(r.status, 409);
  assert.equal((await request(a).post("/api/quests/not-a-uuid/complete").set(auth(token)).send({})).status, 404);
  assert.equal(
    (await request(a).post("/api/quests/00000000-0000-4000-8000-000000000000/refuse").set(auth(token)).send({ reason: "r" })).status,
    404,
  );
});

test("refuse: 1st free, 2nd -1.5, 3rd 409 refusal_limit", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const qs = [await mkQuest(id), await mkQuest(id), await mkQuest(id)];
  const before = (await score(id, "DISCIPLINE")).score;
  const r1 = await request(a).post(`/api/quests/${qs[0]!.id}/refuse`).set(auth(token)).send({ reason: "too tired" });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.penalty, 0);
  assert.equal(r1.body.quest.status, "refused");
  assert.equal(r1.body.quest.refusalReason, "too tired");
  const r2 = await request(a).post(`/api/quests/${qs[1]!.id}/refuse`).set(auth(token)).send({ reason: "r2" });
  assert.equal(r2.status, 200);
  assertContract(QuestRefuseResponseSchema, r2.body);
  assert.deepEqual(r2.body.notices, []);
  assert.equal(r2.body.penalty, 1.5);
  assert.equal(r2.body.results[0].actualDelta, -1.5);
  const r3 = await request(a).post(`/api/quests/${qs[2]!.id}/refuse`).set(auth(token)).send({ reason: "r3" });
  assert.equal(r3.status, 409);
  assert.equal(r3.body.code, "refusal_limit");
  const s = await score(id, "DISCIPLINE");
  assert.equal(s.score, before - 1.5);
  assert.equal(s.streak, 0); // refusal never touches streaks
  const [still] = await db!.select().from(quests).where(eq(quests.id, qs[2]!.id));
  assert.equal(still!.status, "active");
});

test("GET /quests returns active and recently resolved", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q1 = await mkQuest(id);
  const q2 = await mkQuest(id);
  await request(a).post(`/api/quests/${q1.id}/complete`).set(auth(token)).send({});
  const res = await request(a).get("/api/quests").set(auth(token));
  assert.equal(res.status, 200);
  assertContract(QuestListResponseSchema, res.body);
  assert.deepEqual(res.body.active.map((q: { id: string }) => q.id), [q2.id]);
  assert.deepEqual(res.body.recent.map((q: { id: string }) => q.id), [q1.id]);
});

test("chain: start -> step-0 quest; complete steps; chain_complete notice at the end", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const tpl = await request(a).get("/api/chains/templates").set(auth(token));
  assert.equal(tpl.status, 200);
  assertContract(ChainTemplatesResponseSchema, tpl.body);
  assert.equal(tpl.body.templates.length, 4);
  assert.equal(tpl.body.templates[0].templateKey, "physical_protocol");
  assert.deepEqual(tpl.body.active, []);

  const start = await request(a).post("/api/chains").set(auth(token)).send({ templateKey: "physical_protocol" });
  assert.equal(start.status, 201);
  assertContract(ChainStartResponseSchema, start.body);
  assert.equal(start.body.quest.title, "[PHYSICAL PROTOCOL] BASELINE ASSESSMENT");
  assert.equal(start.body.quest.type, "arc");
  assert.equal(start.body.quest.chainStep, 0);
  assert.equal(start.body.quest.chainTotal, 3);
  const dup = await request(a).post("/api/chains").set(auth(token)).send({ templateKey: "physical_protocol" });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "chain_active");
  assert.equal((await request(a).post("/api/chains").set(auth(token)).send({ templateKey: "bogus" })).status, 400);

  const exp = new Date(start.body.quest.expiresAt).getTime() - Date.now();
  assert.ok(Math.abs(exp - 14 * 86400_000) < 60_000);

  let questId = start.body.quest.id as string;
  for (let step = 0; step < 3; step++) {
    // Physical Protocol steps are BODY workouts: proven by a live session, not a tap (spec 8.2).
    const done = await request(a)
      .post(`/api/quests/${questId}/session`)
      .set(auth(token))
      .send({
        summary: {
          kind: "workout",
          startedAt: new Date(Date.now() - 70 * 60_000).toISOString(),
          endedAt: new Date().toISOString(),
          activeMinutes: 65,
          steps: 5000,
          placeId: null,
          placeShare: 0,
          mocked: false,
        },
      });
    assert.equal(done.status, 200);
    assert.equal(done.body.completed, true);
    assertContract(SessionProofResponseSchema, done.body);
    const chainRows = await db!.select().from(questChains).where(eq(questChains.userId, id));
    if (step < 2) {
      assert.equal(chainRows[0]!.currentStep, step + 1);
      const act = await request(a).get("/api/quests").set(auth(token));
      const next = act.body.active.find((q: { chainStep: number }) => q.chainStep === step + 1);
      assert.ok(next, `step ${step + 1} quest exists`);
      questId = next.id;
      const t = await request(a).get("/api/chains/templates").set(auth(token));
      assert.deepEqual(t.body.active, [{ templateKey: "physical_protocol", currentStep: step + 1 }]);
    } else {
      assert.equal(chainRows[0]!.status, "complete");
      assert.ok(chainRows[0]!.completedAt);
      const n = done.body.notices.find((x: { kind: string }) => x.kind === "chain_complete");
      assert.deepEqual(n.payload, { name: "PHYSICAL PROTOCOL", templateKey: "physical_protocol" });
      const rows = await db!.select().from(notices).where(and(eq(notices.userId, id), eq(notices.kind, "chain_complete")));
      assert.equal(rows.length, 1);
    }
  }
  // a finished chain can be started again
  const again = await request(a).post("/api/chains").set(auth(token)).send({ templateKey: "physical_protocol" });
  assert.equal(again.status, 201);
});

test("refusing a chain-step quest abandons the chain and frees the template", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const start = await request(a).post("/api/chains").set(auth(token)).send({ templateKey: "mind_sharpening" });
  assert.equal(start.status, 201);
  const ref = await request(a).post(`/api/quests/${start.body.quest.id}/refuse`).set(auth(token)).send({ reason: "r" });
  assert.equal(ref.status, 200);
  const [chain] = await db!.select().from(questChains).where(eq(questChains.userId, id));
  assert.equal(chain!.status, "abandoned");
  const again = await request(a).post("/api/chains").set(auth(token)).send({ templateKey: "mind_sharpening" });
  assert.equal(again.status, 201);
});
