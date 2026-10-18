import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { dailySnapshots, debriefs, generatedQuestBatches, logs, profiles, quests, scoreEvents, systemMessages } from "@workspace/db";
import { RANKED_DOMAINS, addDays, debriefVerdict, endOfLocalDay, localDate, type RankedDomain } from "@workspace/engine";
import { env } from "../lib/env";
import { createQuests } from "../services/quests";
import { app, auth, db, score, setup, skip, TZ } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const today = () => localDate(new Date(), TZ);
const typesOf = (active: { type: string }[]) => active.map((q) => q.type).sort();

/** The fake model is only consulted when a key is configured; tests set a dummy one for the call. */
async function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const saved = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = "test-key";
  try {
    return await fn();
  } finally {
    env.GEMINI_API_KEY = saved;
  }
}

test("generate returns 3 dailies + 1 weekly + 1 arc on an empty board, with local-day expiries", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const res = await request(a).post("/api/quests/generate").set(auth(token)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.generated, true);
  assert.deepEqual(typesOf(res.body.active), ["arc", "daily", "daily", "daily", "weekly"]);
  const t = today();
  const expiry = (type: string) =>
    res.body.active.find((q: { type: string }) => q.type === type).expiresAt as string;
  assert.equal(expiry("daily"), endOfLocalDay(t, TZ).toISOString());
  assert.equal(expiry("weekly"), endOfLocalDay(addDays(t, 6), TZ).toISOString());
  assert.equal(expiry("arc"), endOfLocalDay(addDays(t, 20), TZ).toISOString());
  const batches = await db!.select().from(generatedQuestBatches);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]!.model, "template"); // no GEMINI_API_KEY in tests
  assert.equal(batches[0]!.localDate, t);
});

test("generate twice on the same day: the second returns generated:false and the same board", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const first = await request(a).post("/api/quests/generate").set(auth(token)).send({});
  const second = await request(a).post("/api/quests/generate").set(auth(token)).send({});
  assert.equal(second.status, 200);
  assert.equal(second.body.generated, false);
  assert.deepEqual(
    second.body.active.map((q: { id: string }) => q.id).sort(),
    first.body.active.map((q: { id: string }) => q.id).sort(),
  );
  assert.equal((await db!.select().from(quests).where(eq(quests.userId, id))).length, 5);
});

test("generate replays an Idempotency-Key and tops up only what is missing on a later day", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const h = { ...auth(token), "Idempotency-Key": "gen-1" };
  const first = await request(a).post("/api/quests/generate").set(h).send({});
  const replay = await request(a).post("/api/quests/generate").set(h).send({});
  assert.deepEqual(replay.body, first.body);
  assert.equal((await db!.select().from(quests).where(eq(quests.userId, id))).length, 5);
  // Simulate the next day: today's batch belongs to yesterday and one daily is gone.
  await db!.update(generatedQuestBatches).set({ localDate: addDays(today(), -1) });
  const [daily] = await db!.select().from(quests).where(and(eq(quests.userId, id), eq(quests.type, "daily")));
  await db!
    .update(quests)
    .set({ status: "failed", resolvedAt: new Date(), resolvedLocalDate: today() })
    .where(eq(quests.id, daily!.id));
  const next = await request(a).post("/api/quests/generate").set(auth(token)).send({});
  assert.equal(next.body.generated, true);
  assert.deepEqual(typesOf(next.body.active), ["arc", "daily", "daily", "daily", "weekly"]);
  assert.equal((await db!.select().from(quests).where(eq(quests.userId, id))).length, 6);
});

const fakeQuests = JSON.stringify({
  quests: [
    { title: "Fake one", description: "d", domain: "SOCIAL", type: "daily" },
    { title: "Fake two", description: "d", domain: "MIND", type: "daily" },
    { title: "Fake three", description: "d", domain: "BODY", type: "daily" },
    { title: "Fake weekly", description: "d", domain: "WEALTH", type: "weekly" },
    { title: "Fake arc", description: "d", domain: "DISCIPLINE", type: "arc" },
  ],
});

test("generate uses a valid fake-model JSON response (and builds the prompt server-side)", { skip }, async () => {
  const prompts: string[] = [];
  const a = app({
    ai: {
      call: async (_model, o) => {
        prompts.push(o.prompt);
        return "```json\n" + fakeQuests + "\n```";
      },
    },
  });
  const { token } = await setup(a);
  const res = await withKey(() => request(a).post("/api/quests/generate").set(auth(token)).send({}));
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.active.map((q: { title: string }) => q.title).sort(),
    ["Fake arc", "Fake one", "Fake three", "Fake two", "Fake weekly"],
  );
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]!, /SOCIAL/);
  assert.match(prompts[0]!, /Build a disciplined life/);
  const [batch] = await db!.select().from(generatedQuestBatches);
  assert.equal(batch!.model, env.GEMINI_MODEL);
});

test("generate falls back to templates when the fake model returns invalid output", { skip }, async () => {
  const a = app({ ai: { call: async () => JSON.stringify({ quests: [{ title: "", domain: "NOPE", type: "daily" }] }) } });
  const { token } = await setup(a);
  const res = await withKey(() => request(a).post("/api/quests/generate").set(auth(token)).send({}));
  assert.equal(res.status, 200);
  assert.deepEqual(typesOf(res.body.active), ["arc", "daily", "daily", "daily", "weekly"]);
  const [batch] = await db!.select().from(generatedQuestBatches);
  assert.equal(batch!.model, "template");
});

test("messages: morning_briefing is cached per day (same text, one AI call)", { skip }, async () => {
  let calls = 0;
  const a = app({ ai: { call: async () => `Call ${++calls}. Execute.` } });
  const { token, id } = await setup(a);
  const send = () => request(a).post("/api/messages").set(auth(token)).send({ type: "morning_briefing" });
  const first = await withKey(send);
  const second = await withKey(send);
  assert.equal(first.status, 200);
  assert.equal(first.body.message, "Call 1. Execute.");
  assert.equal(second.body.message, first.body.message);
  assert.equal(calls, 1);
  assert.ok(first.body.meta.promptVersion);
  const rows = await db!.select().from(systemMessages).where(eq(systemMessages.userId, id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.localDate, today());
});

test("messages (template mode): morning_briefing cached; other types stored each call", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const m1 = await request(a).post("/api/messages").set(auth(token)).send({ type: "morning_briefing" });
  const m2 = await request(a).post("/api/messages").set(auth(token)).send({ type: "morning_briefing" });
  assert.equal(m1.status, 200);
  assert.equal(m1.body.message, m2.body.message);
  assert.equal(m1.body.meta.model, "template");
  const s1 = await request(a)
    .post("/api/messages")
    .set(auth(token))
    .send({ type: "shadow_self", extraContext: "x".repeat(500) });
  assert.equal(s1.status, 200);
  assert.ok(s1.body.message.length > 0);
  const w = await request(a).post("/api/messages").set(auth(token)).send({ type: "weekly_debrief" });
  assert.equal(w.status, 200);
  assert.equal((await db!.select().from(systemMessages).where(eq(systemMessages.userId, id))).length, 3);
});

test("messages: unknown type and oversized extraContext are 400; unauthenticated is 401", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  assert.equal((await request(a).post("/api/messages").set(auth(token)).send({ type: "nope" })).status, 400);
  assert.equal(
    (await request(a).post("/api/messages").set(auth(token)).send({ type: "milestone", extraContext: "x".repeat(501) })).status,
    400,
  );
  assert.equal((await request(a).post("/api/messages").send({ type: "milestone" })).status, 401);
});

async function setNightly(userId: string, nightlyTime: string) {
  await db!.update(profiles).set({ nightlyTime }).where(eq(profiles.userId, userId));
}

test("debrief: unavailable before nightlyTime, available after, verdict matches debriefVerdict; ack -> 204", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  await setNightly(id, "23:59");
  const early = await request(a).get("/api/debrief/today").set(auth(token));
  assert.equal(early.status, 200);
  assert.equal(early.body.available, false);
  assert.ok(Date.parse(early.body.availableAt) > Date.now());

  await request(a).post("/api/logs").set(auth(token)).send({ clientId: "d1", domain: "BODY", logType: "workout" });
  const [q] = await createQuests(db!, id, [
    { type: "daily", title: "t", description: "d", domain: "MIND", expiresAt: new Date(Date.now() + 3600_000) },
  ]);
  await request(a).post(`/api/quests/${q!.id}/complete`).set(auth(token)).send({});

  await setNightly(id, "00:00");
  const res = await request(a).get("/api/debrief/today").set(auth(token));
  assert.equal(res.body.available, true);
  const d = res.body.debrief;
  assert.equal(d.date, today());
  assert.equal(d.questCompleted, 1);
  assert.equal(d.questTotal, 1);
  assert.equal(d.acknowledged, false);
  const [snap] = await db!.select().from(dailySnapshots).where(eq(dailySnapshots.userId, id));
  const start = snap!.scores as Record<RankedDomain, number>;
  for (const dom of RANKED_DOMAINS) {
    const expected = (await score(id, dom)).score - start[dom];
    assert.ok(Math.abs(d.deltas[dom] - expected) < 0.051, `${dom} delta ${d.deltas[dom]} vs ${expected}`);
  }
  assert.equal(d.deltas.BODY, 2.5);
  assert.equal(d.verdict, debriefVerdict(d.deltas, 1));
  assert.ok(d.text.length > 0);

  const again = await request(a).get("/api/debrief/today").set(auth(token));
  assert.equal(again.body.debrief.text, d.text);
  assert.equal((await db!.select().from(debriefs).where(eq(debriefs.userId, id))).length, 1);

  const ack = await request(a).post(`/api/debrief/${today()}/ack`).set(auth(token)).send({});
  assert.equal(ack.status, 204);
  const acked = await request(a).get("/api/debrief/today").set(auth(token));
  assert.equal(acked.body.debrief.acknowledged, true);
  assert.equal((await request(a).post("/api/debrief/not-a-date/ack").set(auth(token)).send({})).status, 400);
  assert.equal((await request(a).post("/api/debrief/2000-01-01/ack").set(auth(token)).send({})).status, 404);
});

test("recap counts only the last 7 local days", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const t = today();
  const old = addDays(t, -10);
  const recent = addDays(t, -3);
  const ev = (date: string, domain: string, actualDelta: number) => ({
    userId: id,
    domain,
    delta: actualDelta,
    actualDelta,
    reason: "log",
    localDate: date,
  });
  await db!
    .insert(scoreEvents)
    .values([ev(old, "BODY", 9), ev(recent, "BODY", 2.5), ev(recent, "MIND", 1), ev(t, "BODY", 2.5), ev(t, "DISCIPLINE", -2)]);
  const lg = (clientId: string, date: string, forbidden = false) => ({
    userId: id,
    clientId,
    domain: "BODY",
    logType: "workout",
    forbidden,
    occurredAt: new Date(),
    localDate: date,
  });
  await db!.insert(logs).values([lg("o1", old), lg("r1", recent), lg("r2", recent, true), lg("r3", t)]);
  const mk = async (status: string, date: string) => {
    const [q] = await createQuests(db!, id, [
      { type: "daily", title: status, description: "d", domain: "MIND", expiresAt: new Date(Date.now() + 3600_000) },
    ]);
    await db!.update(quests).set({ status, resolvedAt: new Date(), resolvedLocalDate: date }).where(eq(quests.id, q!.id));
  };
  await mk("complete", old);
  await mk("complete", recent);
  await mk("failed", recent);
  await mk("refused", t);

  const res = await request(a).get("/api/recap/weekly").set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.weekStart, addDays(t, -6));
  assert.equal(res.body.domainDeltas.BODY, 5);
  assert.equal(res.body.domainDeltas.MIND, 1);
  assert.equal(res.body.domainDeltas.DISCIPLINE, -2);
  assert.equal(res.body.domainDeltas.SOCIAL, 0);
  assert.equal(res.body.questsCompleted, 1);
  assert.equal(res.body.questsFailed, 1);
  assert.equal(res.body.questsRefused, 1);
  assert.equal(res.body.logsCount, 3);
  assert.equal(res.body.forbiddenLogs, 1);
  assert.equal(res.body.peakDomain, "BODY");
  assert.equal(res.body.chainsCompleted, 0);
  assert.equal(typeof res.body.achievementsUnlocked, "number");

  const deb = await request(a).get("/api/recap/weekly/debrief").set(auth(token));
  assert.equal(deb.status, 200);
  assert.ok(deb.body.debrief.length > 0);
});
