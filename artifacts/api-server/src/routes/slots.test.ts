import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { domainScores, quests, scoreEvents } from "@workspace/db";
import { eq } from "drizzle-orm";
import { QuestListResponseSchema, QuestSlotResponseSchema } from "@workspace/contracts";
import { createQuests, slotStateOf } from "../services/quests";
import { buildMessagePrompt, buildUserContext } from "../services/ai-context";
import { addDays, localDate } from "@workspace/engine";
import { TZ, app, assertContract, assertStoredNoticesMatchContract, auth, db, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

async function mkQuest(userId: string, domain = "BODY", type: "daily" | "weekly" | "arc" = "daily") {
  const [q] = await createQuests(db!, userId, [
    { type, title: "Lift", description: "desc", domain, expiresAt: new Date(Date.now() + 3600_000) },
  ]);
  return q!;
}

const patchSlot = (a: ReturnType<typeof app>, token: string, id: string, body: unknown) =>
  request(a).patch(`/api/quests/${id}/slot`).set(auth(token)).send(body as object);

test("slot set and cleared", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id);
  const set = await patchSlot(a, token, q.id, { slotStart: "17:30", slotEnd: "18:30" });
  assert.equal(set.status, 200);
  assertContract(QuestSlotResponseSchema, set.body);
  assert.equal(set.body.quest.slotStart, "17:30");
  assert.equal(set.body.quest.slotEnd, "18:30");
  const [row] = await db!.select().from(quests).where(eq(quests.id, q.id));
  assert.equal(row!.slotStart, "17:30");
  const cleared = await patchSlot(a, token, q.id, { slotStart: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.quest.slotStart, null);
  assert.equal(cleared.body.quest.slotEnd, null);
  assert.equal(cleared.body.quest.slotState, "none");
});

test("invalid windows are 400", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id);
  for (const body of [
    { slotStart: "18:30", slotEnd: "17:30" },
    { slotStart: "17:30", slotEnd: "17:30" },
    { slotStart: "10:00", slotEnd: "14:15" },
    { slotStart: "25:00", slotEnd: "26:00" },
    { slotStart: "17:30" },
  ]) {
    const r = await patchSlot(a, token, q.id, body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  const ok = await patchSlot(a, token, q.id, { slotStart: "10:00", slotEnd: "14:00" });
  assert.equal(ok.status, 200);
});

test("resolved quest -> 409 not_active, slot stays unset", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id);
  const done = await request(a).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  assert.equal(done.status, 200);
  const r = await patchSlot(a, token, q.id, { slotStart: "17:30", slotEnd: "18:30" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "not_active");
  const [row] = await db!.select().from(quests).where(eq(quests.id, q.id));
  assert.equal(row!.slotStart, null);
});

test("another user's or unknown quest is 404", { skip }, async () => {
  const a = app();
  const alice = await setup(a);
  const bob = await setup(a, { email: "bob@example.com", username: "bob_1" });
  const q = await mkQuest(alice.id);
  assert.equal((await patchSlot(a, bob.token, q.id, { slotStart: "17:30", slotEnd: "18:00" })).status, 404);
  assert.equal((await patchSlot(a, bob.token, "nope", { slotStart: "17:30", slotEnd: "18:00" })).status, 404);
});

test("GET /quests reports slotState from the server (wiring; boundaries are unit-tested)", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id);
  const read = async () => {
    const res = await request(a).get("/api/quests").set(auth(token));
    assert.equal(res.status, 200);
    assertContract(QuestListResponseSchema, res.body);
    return res.body.active.find((x: { id: string }) => x.id === q.id).slotState as string;
  };
  assert.equal(await read(), "none");
  await patchSlot(a, token, q.id, { slotStart: "00:00", slotEnd: "04:00" });
  assert.equal(await read(), slotStateOf({ slotStart: "00:00", slotEnd: "04:00" }, new Date(), TZ));
  await patchSlot(a, token, q.id, { slotStart: null });
  assert.equal(await read(), "none");
});

test("weekly and arc quests take no slot -> 409 slot_daily_only", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  for (const type of ["weekly", "arc"] as const) {
    const q = await mkQuest(id, "BODY", type);
    const r = await patchSlot(a, token, q.id, { slotStart: "17:30", slotEnd: "18:30" });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "slot_daily_only");
  }
});

test("setting and clearing a slot leaves expiresAt and every score unchanged", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id);
  const snapshot = async () => ({
    expiresAt: (await db!.select().from(quests).where(eq(quests.id, q.id)))[0]!.expiresAt.getTime(),
    scores: (await db!.select().from(domainScores).where(eq(domainScores.userId, id)))
      .map((s) => [s.domain, s.score, s.streak])
      .sort(),
    events: (await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, id))).length,
  });
  const before = await snapshot();
  assert.equal((await patchSlot(a, token, q.id, { slotStart: "17:30", slotEnd: "18:30" })).status, 200);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await patchSlot(a, token, q.id, { slotStart: null })).status, 200);
  assert.deepEqual(await snapshot(), before);
});

test("AI context: locked slot only for active BODY quests", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const body = await mkQuest(id);
  const mind = await mkQuest(id, "MIND");
  await patchSlot(a, token, body.id, { slotStart: "17:30", slotEnd: "18:30" });
  await patchSlot(a, token, mind.id, { slotStart: "09:00", slotEnd: "10:00" });
  const ctx = (await buildUserContext(db!, id, new Date()))!;
  assert.deepEqual(ctx.lockedSlots, ["17:30–18:30"]);
  assert.ok(buildMessagePrompt("morning_briefing", ctx).prompt.includes("Locked slot: 17:30–18:30"));
  await request(a).post(`/api/quests/${body.id}/complete`).set(auth(token)).send({});
  assert.deepEqual((await buildUserContext(db!, id, new Date()))!.lockedSlots, []);
});

test("AI context: deferral count and quoted reasons share the 7-day window and need a reason", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  const today = localDate(new Date(), TZ);
  const mk = async (resolvedLocalDate: string, refusalReason: string | null) => {
    const q = await mkQuest(id);
    await db!.update(quests).set({ status: "refused", resolvedAt: new Date(), resolvedLocalDate, refusalReason }).where(eq(quests.id, q.id));
  };
  await mk(today, "too tired");
  await mk(addDays(today, -6), "late shift");
  await mk(addDays(today, -7), "too old");
  await mk(today, null);
  const ctx = (await buildUserContext(db!, id, new Date()))!;
  assert.equal(ctx.deferralsThisWeek, 2);
  assert.deepEqual([...ctx.recentRefusals].sort(), ["late shift", "too tired"]);
});

test("slot PATCH and refuse read the injected clock", { skip }, async () => {
  // Three days ago: a quest still active then has long expired by the real clock.
  const pinned = new Date(Date.now() - 3 * 86_400_000);
  const a = app({ now: () => pinned });
  const { token, id } = await setup(a);
  const mk = async (title: string) =>
    (await createQuests(db!, id, [{ type: "daily", title, description: "d", domain: "MIND", expiresAt: new Date(pinned.getTime() + 3600_000) }]))[0]!;
  const slotted = await patchSlot(a, token, (await mk("Slot")).id, { slotStart: "17:30", slotEnd: "18:30" });
  assert.equal(slotted.status, 200, JSON.stringify(slotted.body));
  const refused = await request(a).post(`/api/quests/${(await mk("Refuse")).id}/refuse`).set(auth(token)).send({ reason: "busy" });
  assert.equal(refused.status, 200, JSON.stringify(refused.body));
  assert.equal(refused.body.quest.resolvedAt, pinned.toISOString());
});
