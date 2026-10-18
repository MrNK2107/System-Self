import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { notices, questChains, quests } from "@workspace/db";
import {
  ChainStartResponseSchema,
  ChainTemplatesResponseSchema,
  QuestCompleteResponseSchema,
  QuestListResponseSchema,
  QuestRefuseResponseSchema,
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

async function mkQuest(userId: string, over: { expiresAt?: Date } = {}) {
  const [q] = await createQuests(db!, userId, [
    {
      type: "daily",
      title: "Do the thing",
      description: "desc",
      domain: "MIND",
      expiresAt: over.expiresAt ?? new Date(Date.now() + 3600_000),
    },
  ]);
  return q!;
}

test("complete quest gives +3 DISCIPLINE; again is 409", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id);
  const before = (await score(id, "DISCIPLINE")).score;
  const res = await request(a).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  assert.equal(res.status, 200);
  assertContract(QuestCompleteResponseSchema, res.body);
  assert.equal(res.body.quest.status, "complete");
  assert.equal(res.body.results[0].domain, "DISCIPLINE");
  assert.equal(res.body.results[0].actualDelta, 3);
  assert.equal(res.body.results[0].streak, 1);
  const again = await request(a).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "not_active");
  assert.equal((await score(id, "DISCIPLINE")).score, before + 3);
});

test("expired or unknown quest is not completable", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const expired = await mkQuest(id, { expiresAt: new Date(Date.now() - 1000) });
  const r = await request(a).post(`/api/quests/${expired.id}/complete`).set(auth(token)).send({});
  assert.equal(r.status, 409);
  assert.equal((await request(a).post("/api/quests/not-a-uuid/complete").set(auth(token)).send({})).status, 404);
  assert.equal(
    (await request(a).post("/api/quests/00000000-0000-4000-8000-000000000000/refuse").set(auth(token)).send({})).status,
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
  const r2 = await request(a).post(`/api/quests/${qs[1]!.id}/refuse`).set(auth(token)).send({});
  assert.equal(r2.status, 200);
  assertContract(QuestRefuseResponseSchema, r2.body);
  assert.equal(r2.body.penalty, 1.5);
  assert.equal(r2.body.results[0].actualDelta, -1.5);
  const r3 = await request(a).post(`/api/quests/${qs[2]!.id}/refuse`).set(auth(token)).send({});
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
    const done = await request(a).post(`/api/quests/${questId}/complete`).set(auth(token)).send({});
    assert.equal(done.status, 200);
    assertContract(QuestCompleteResponseSchema, done.body);
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
  const ref = await request(a).post(`/api/quests/${start.body.quest.id}/refuse`).set(auth(token)).send({});
  assert.equal(ref.status, 200);
  const [chain] = await db!.select().from(questChains).where(eq(questChains.userId, id));
  assert.equal(chain!.status, "abandoned");
  const again = await request(a).post("/api/chains").set(auth(token)).send({ templateKey: "mind_sharpening" });
  assert.equal(again.status, 201);
});
