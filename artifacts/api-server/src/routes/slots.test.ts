import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { quests } from "@workspace/db";
import { eq } from "drizzle-orm";
import { QuestListResponseSchema, QuestSlotResponseSchema } from "@workspace/contracts";
import { createQuests } from "../services/quests";
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

async function mkQuest(userId: string, domain = "BODY") {
  const [q] = await createQuests(db!, userId, [
    { type: "daily", title: "Lift", description: "desc", domain, expiresAt: new Date(Date.now() + 3600_000) },
  ]);
  return q!;
}

const patchSlot = (a: ReturnType<typeof app>, token: string, id: string, body: unknown) =>
  request(a).patch(`/api/quests/${id}/slot`).set(auth(token)).send(body as object);

/** Local minutes since midnight in the test timezone. */
function localMinutes(): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date())
    .split(":")
    .map(Number);
  return h! * 60 + m!;
}
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

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

test("slotState follows the user's local now: missed, open, upcoming, none", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id);
  const state = async () => {
    const res = await request(a).get("/api/quests").set(auth(token));
    assert.equal(res.status, 200);
    assertContract(QuestListResponseSchema, res.body);
    return res.body.active.find((x: { id: string }) => x.id === q.id).slotState as string;
  };
  assert.equal(await state(), "none");
  const now = localMinutes();
  if (now >= 30 && now <= 23 * 60 + 15) {
    await patchSlot(a, token, q.id, { slotStart: hhmm(now - 30), slotEnd: hhmm(now - 10) });
    assert.equal(await state(), "missed");
    await patchSlot(a, token, q.id, { slotStart: hhmm(now - 10), slotEnd: hhmm(now + 10) });
    assert.equal(await state(), "open");
    await patchSlot(a, token, q.id, { slotStart: hhmm(now + 10), slotEnd: hhmm(now + 30) });
    assert.equal(await state(), "upcoming");
  }
  await patchSlot(a, token, q.id, { slotStart: null });
  assert.equal(await state(), "none");
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
