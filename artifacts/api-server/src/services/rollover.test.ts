import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, asc, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import {
  achievements,
  dailySnapshots,
  domainScores,
  idempotencyKeys,
  logs,
  notices,
  profiles,
  questChains,
  quests,
  scoreEvents,
  shadowSelves,
  userDayState,
} from "@workspace/db";
import { RANKED_DOMAINS, addDays, endOfLocalDay, hiddenScore, localDate } from "@workspace/engine";
import { app, auth, db, score, setup, skip, TZ } from "../routes/game-test-helpers";
import { createQuests } from "./quests";
import { claimDueUsers, ensureRolledOver, rolloverDate } from "./rollover";
import { withUserLock } from "./user-lock";
import { runLoop, runWorkerTick } from "../jobs/run-loop";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

// Fixed onboarding day (Asia/Kolkata). Initial scores from the helper's ratings:
// BODY 20, MIND 24, WEALTH 16, SOCIAL 28, DISCIPLINE 12 (hidden 19 → tier E).
const D0 = "2026-01-01";
const at = (date: string, hhmm = "12:00") => new Date(`${date}T${hhmm}:00+05:30`);

/** Onboards a user via the routes, then pins their onboarding day to D0. */
async function onboardAtD0(who: { email?: string; username?: string } = {}) {
  const { token, id } = await setup(app(), who);
  await db!.update(profiles).set({ onboardedAt: at(D0, "09:00"), rankSince: at(D0, "09:00") }).where(eq(profiles.userId, id));
  await db!.update(dailySnapshots).set({ localDate: D0 }).where(eq(dailySnapshots.userId, id));
  await db!.update(userDayState).set({ nextRolloverAt: endOfLocalDay(D0, TZ) }).where(eq(userDayState.userId, id));
  return { token, id };
}

async function addLog(userId: string, date: string, domain = "BODY") {
  await db!.insert(logs).values({
    userId,
    clientId: `log-${date}-${domain}-${Math.random()}`,
    domain,
    logType: "x",
    occurredAt: at(date),
    localDate: date,
  });
}

async function setScores(userId: string, value: number) {
  await db!.update(domainScores).set({ score: value }).where(eq(domainScores.userId, userId));
}

async function seedSnapshots(userId: string, dates: string[], hidden: number, rank = "E") {
  for (const d of dates) {
    await db!
      .insert(dailySnapshots)
      .values({ userId, localDate: d, scores: {}, hidden, rank })
      .onConflictDoUpdate({ target: [dailySnapshots.userId, dailySnapshots.localDate], set: { hidden, rank } });
  }
}

const range = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

const eventsOf = (userId: string, reason: string) =>
  db!
    .select()
    .from(scoreEvents)
    .where(and(eq(scoreEvents.userId, userId), eq(scoreEvents.reason, reason)))
    .orderBy(asc(scoreEvents.id));

const noticesOf = (userId: string, kind: string) =>
  db!.select().from(notices).where(and(eq(notices.userId, userId), eq(notices.kind, kind)));

async function dailyQuest(userId: string, expiresAt: Date, extra: { chainId?: string; chainStep?: number } = {}) {
  const [q] = await createQuests(db!, userId, [
    { type: "daily", title: "Daily", description: "d", domain: "MIND", expiresAt, ...extra },
  ]);
  return q!;
}

test("daily quest expired at rollover → failed, −0.8 DISCIPLINE, quest_failed notice", { skip }, async () => {
  const { id } = await onboardAtD0();
  const q = await dailyQuest(id, at(D0, "20:00"));
  const later = await dailyQuest(id, at(addDays(D0, 3)));
  await ensureRolledOver(db!, id, at(addDays(D0, 1)));

  const [failed] = await db!.select().from(quests).where(eq(quests.id, q.id));
  assert.equal(failed!.status, "failed");
  assert.equal(failed!.resolvedLocalDate, D0);
  const [still] = await db!.select().from(quests).where(eq(quests.id, later.id));
  assert.equal(still!.status, "active");
  assert.equal((await score(id, "DISCIPLINE")).score, 11.2);
  const ev = await eventsOf(id, "quest_failed");
  assert.equal(ev.length, 1);
  assert.equal(ev[0]!.delta, -0.8);
  assert.equal(ev[0]!.refId, q.id);
  const n = await noticesOf(id, "quest_failed");
  assert.equal(n.length, 1);
  assert.equal((n[0]!.payload as { questId: string }).questId, q.id);
});

test("chain-step quest failing at rollover abandons its chain", { skip }, async () => {
  const { id } = await onboardAtD0();
  const [chain] = await db!
    .insert(questChains)
    .values({ userId: id, templateKey: "physical_protocol", name: "PHYSICAL PROTOCOL", domain: "BODY", totalSteps: 3 })
    .returning();
  await dailyQuest(id, at(D0, "20:00"), { chainId: chain!.id, chainStep: 0 });
  await ensureRolledOver(db!, id, at(addDays(D0, 1)));
  const [row] = await db!.select().from(questChains).where(eq(questChains.id, chain!.id));
  assert.equal(row!.status, "abandoned");
});

test("streak break penalty includes DISCIPLINE when it broke", { skip }, async () => {
  const { id } = await onboardAtD0();
  const prev = addDays(D0, -1);
  await db!
    .update(domainScores)
    .set({ streak: 3, lastLogDate: prev })
    .where(and(eq(domainScores.userId, id), eq(domainScores.domain, "BODY")));
  await db!
    .update(domainScores)
    .set({ streak: 2, lastLogDate: prev })
    .where(and(eq(domainScores.userId, id), eq(domainScores.domain, "DISCIPLINE")));
  await ensureRolledOver(db!, id, at(addDays(D0, 1)));

  assert.equal((await score(id, "BODY")).streak, 0);
  assert.equal((await score(id, "DISCIPLINE")).streak, 0);
  assert.equal((await score(id, "DISCIPLINE")).score, 8); // 12 − min(6, 2·2)
  const ev = await eventsOf(id, "streak_break");
  assert.equal(ev.length, 1);
  assert.equal(ev[0]!.domain, "DISCIPLINE");
  assert.equal(ev[0]!.delta, -4);
  const n = await noticesOf(id, "streak_break");
  assert.deepEqual(n[0]!.payload, { domains: ["BODY", "DISCIPLINE"], penalty: 4 });
});

test("decay: 1 inactive day → none, 2nd → −0.3 per domain, 5th → −0.6", { skip }, async () => {
  const { id } = await onboardAtD0();
  await addLog(id, D0);
  await ensureRolledOver(db!, id, at(addDays(D0, 6))); // rolls D0..D0+5

  const ev = await eventsOf(id, "decay");
  const byDate = new Map<string, number[]>();
  for (const e of ev) byDate.set(e.localDate, [...(byDate.get(e.localDate) ?? []), e.delta]);
  assert.equal(byDate.has(D0), false); // logged
  assert.equal(byDate.has(addDays(D0, 1)), false); // k = 1
  for (const k of [2, 3, 4]) assert.deepEqual(byDate.get(addDays(D0, k)), [-0.3, -0.3, -0.3, -0.3, -0.3]);
  assert.deepEqual(byDate.get(addDays(D0, 5)), [-0.6, -0.6, -0.6, -0.6, -0.6]);
  assert.deepEqual(
    ev.slice(0, 5).map((e) => e.domain),
    [...RANKED_DOMAINS],
  );
});

test("rollover is idempotent for the same date", { skip }, async () => {
  const { id } = await onboardAtD0();
  await dailyQuest(id, at(D0, "20:00"));
  const now = at(addDays(D0, 1));
  const first = await withUserLock(db!, id, (tx) => rolloverDate(tx, id, D0, now));
  assert.ok(first.some((n) => n.kind === "quest_failed"));
  const countAll = async () => ({
    events: (await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, id))).length,
    notices: (await db!.select().from(notices).where(eq(notices.userId, id))).length,
    snapshots: (await db!.select().from(dailySnapshots).where(eq(dailySnapshots.userId, id))).length,
    discipline: (await score(id, "DISCIPLINE")).score,
  });
  const before = await countAll();
  const second = await withUserLock(db!, id, (tx) => rolloverDate(tx, id, D0, now));
  assert.deepEqual(second, []);
  await ensureRolledOver(db!, id, now);
  assert.deepEqual(await countAll(), before);
  const [uds] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.equal(uds!.lastRolledDate, D0);
});

test("14 snapshots in tier D → promotion E→D with rank_change notice and rank_d achievement", { skip }, async () => {
  const { id } = await onboardAtD0();
  await setScores(id, 30); // hidden 30 → tier D
  await seedSnapshots(id, range(addDays(D0, -13), 13), 30);
  const now = at(addDays(D0, 1));
  await ensureRolledOver(db!, id, now);

  const [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "D");
  assert.equal(p!.rankSince.getTime(), now.getTime());
  assert.match(p!.codename, /^VECTOR \/\/ /);
  const rc = await noticesOf(id, "rank_change");
  assert.equal(rc.length, 1);
  assert.deepEqual(rc[0]!.payload, { from: "E", to: "D", kind: "promotion" });
  const ach = await db!.select().from(achievements).where(eq(achievements.userId, id));
  assert.ok(ach.some((a) => a.achievementId === "rank_d"));
  const an = await noticesOf(id, "achievement");
  assert.ok(an.some((n) => (n.payload as { id: string }).id === "rank_d"));
  const [snap] = await db!
    .select()
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.userId, id), eq(dailySnapshots.localDate, D0)));
  assert.equal(snap!.hidden, 30);
  assert.equal(snap!.rank, "E");
});

test("rank freeze blocks demotion (and decay); without it the rank drops", { skip }, async () => {
  const { id } = await onboardAtD0();
  await db!.update(profiles).set({ rank: "C", rankFreezeUntil: addDays(D0, 1) }).where(eq(profiles.userId, id));
  await setScores(id, 30); // hidden 30 < floor(C) = 41
  await seedSnapshots(id, range(addDays(D0, -6), 6), 30, "C");

  // D0 and D0+1 (k = 2, would decay) roll under the freeze.
  await ensureRolledOver(db!, id, at(addDays(D0, 2)));
  let [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "C");
  assert.equal((await noticesOf(id, "rank_change")).length, 0);
  assert.equal((await eventsOf(id, "decay")).length, 0);

  // Freeze over: D0+2 decays and the last 7 snapshots are all below the floor → demotion.
  await ensureRolledOver(db!, id, at(addDays(D0, 3)));
  [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "D");
  assert.match(p!.codename, /^VECTOR \/\/ /);
  assert.equal((await eventsOf(id, "decay")).length, 5);
  const rc = await noticesOf(id, "rank_change");
  assert.deepEqual(rc[0]!.payload, { from: "C", to: "D", kind: "demotion" });
});

test("shadow activates after 5 inactive days", { skip }, async () => {
  const { id } = await onboardAtD0();
  await ensureRolledOver(db!, id, at(addDays(D0, 4))); // D0..D0+3: k up to 4
  assert.equal((await db!.select().from(shadowSelves).where(eq(shadowSelves.userId, id))).length, 0);

  const now = at(addDays(D0, 5));
  await ensureRolledOver(db!, id, now); // D0+4: k = 5
  const [sh] = await db!.select().from(shadowSelves).where(eq(shadowSelves.userId, id));
  assert.equal(sh!.active, true);
  assert.equal(sh!.codename, "SHADOW // ALICE_1");
  assert.equal(sh!.activatedAt!.getTime(), now.getTime());
  const n = await noticesOf(id, "shadow_activated");
  assert.equal(n.length, 1);
  assert.equal(typeof (n[0]!.payload as { gap: number }).gap, "number");
});

test("active shadow resolves once every domain is at or above it", { skip }, async () => {
  const { id } = await onboardAtD0();
  const zero = Object.fromEntries(RANKED_DOMAINS.map((d) => [d, 0]));
  await db!.insert(shadowSelves).values({
    userId: id,
    active: true,
    codename: "SHADOW // ALICE_1",
    initialScores: zero,
    gainRates: zero,
    activatedAt: at(D0, "10:00"),
  });
  const now = at(addDays(D0, 1));
  await ensureRolledOver(db!, id, now);
  const [sh] = await db!.select().from(shadowSelves).where(eq(shadowSelves.userId, id));
  assert.equal(sh!.active, false);
  assert.equal(sh!.resolvedAt!.getTime(), now.getTime());
  assert.equal((await noticesOf(id, "shadow_resolved")).length, 1);
});

test("snapshot hidden score uses the 30-day completion multiplier", { skip }, async () => {
  const { id } = await onboardAtD0();
  for (let i = 0; i < 5; i++) {
    const q = await dailyQuest(id, at(addDays(D0, 5)));
    await db!.update(quests).set({ status: "complete", resolvedLocalDate: addDays(D0, -i) }).where(eq(quests.id, q.id));
  }
  await ensureRolledOver(db!, id, at(addDays(D0, 1)));
  const [snap] = await db!
    .select()
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.userId, id), eq(dailySnapshots.localDate, D0)));
  const base = { BODY: 20, MIND: 24, WEALTH: 16, SOCIAL: 28, DISCIPLINE: 12 };
  assert.equal(snap!.hidden, hiddenScore(base, 1.1));
  assert.deepEqual(snap!.scores, base);
});

test("catch-up after 10 days processes 10 dates in order", { skip }, async () => {
  const { id } = await onboardAtD0();
  const now = at(addDays(D0, 10));
  await ensureRolledOver(db!, id, now);

  const snaps = await db!
    .select()
    .from(dailySnapshots)
    .where(eq(dailySnapshots.userId, id))
    .orderBy(asc(dailySnapshots.localDate));
  assert.deepEqual(
    snaps.map((s) => s.localDate),
    range(D0, 10),
  );
  const decay = await eventsOf(id, "decay");
  const dates = decay.map((e) => e.localDate);
  assert.deepEqual(dates, [...dates].sort()); // applied in date order
  assert.equal(new Set(dates).size, 9); // D0+1 .. D0+9 (D0 is k = 1)
  const [uds] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.equal(uds!.lastRolledDate, addDays(D0, 9));
  assert.equal(uds!.nextRolloverAt.getTime(), endOfLocalDay(addDays(D0, 10), TZ).getTime());
});

test("catch-up over 30 days collapses older days into one decay step", { skip }, async () => {
  const { id } = await onboardAtD0();
  await ensureRolledOver(db!, id, at(addDays(D0, 40))); // 40 missed dates: D0..D0+39
  const snaps = await db!.select().from(dailySnapshots).where(eq(dailySnapshots.userId, id));
  assert.equal(snaps.length, 31); // onboarding snapshot + the 30 most recent dates
  const collapsed = (await eventsOf(id, "decay")).filter((e) => e.localDate === addDays(D0, 9));
  assert.deepEqual(
    collapsed.map((e) => e.delta),
    [-0.6, -0.6, -0.6, -0.6, -0.6],
  );
  const [uds] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.equal(uds!.lastRolledDate, addDays(D0, 39));
});

test("two concurrent runWorkerTick calls never process the same user twice", { skip }, async () => {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { id } = await onboardAtD0({ email: `u${i}@example.com`, username: `user_${i}` });
    await dailyQuest(id, at(D0, "20:00"));
    ids.push(id);
  }
  const now = at(addDays(D0, 1));
  const [a, b] = await Promise.all([runWorkerTick(db!, now), runWorkerTick(db!, now)]);
  assert.equal(a.processed + b.processed, 3);
  for (const id of ids) {
    assert.equal((await eventsOf(id, "quest_failed")).length, 1);
    const [uds] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
    assert.equal(uds!.lastRolledDate, D0);
    assert.equal(uds!.nextRolloverAt.getTime(), endOfLocalDay(addDays(D0, 1), TZ).getTime());
  }
  // Nothing is due any more.
  assert.deepEqual(await claimDueUsers(db!, 10, now), []);
});

test("runWorkerTick prunes idempotency keys older than 7 days", { skip }, async () => {
  const { id } = await onboardAtD0();
  const now = at(addDays(D0, 1));
  await db!.insert(idempotencyKeys).values([
    { userId: id, key: "old", createdAt: new Date(now.getTime() - 8 * 86_400_000) },
    { userId: id, key: "fresh", createdAt: new Date(now.getTime() - 86_400_000) },
  ]);
  await runWorkerTick(db!, now);
  const keys = (await db!.select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, id))).map((k) => k.key);
  assert.deepEqual(keys, ["fresh"]);
});

test("PATCH /auth/me timezone recomputes nextRolloverAt", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const res = await request(a).patch("/api/auth/me").set(auth(token)).send({ timezone: "America/New_York" });
  assert.equal(res.status, 200);
  const [uds] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  const expected = endOfLocalDay(localDate(new Date(), "America/New_York"), "America/New_York");
  assert.equal(uds!.nextRolloverAt.getTime(), expected.getTime());
});

test("aborted worker: tick releases unprocessed claims and runLoop exits without waiting a full tick", { skip }, async () => {
  const { id } = await onboardAtD0();
  const now = at(addDays(D0, 1));
  const aborted = AbortSignal.abort();
  assert.deepEqual(await runWorkerTick(db!, now, aborted), { processed: 0 });
  assert.deepEqual(await claimDueUsers(db!, 10, now), [id]); // released, so claimable again

  const controller = new AbortController();
  const started = Date.now();
  const loop = runLoop(db!, { tickMs: 60_000, signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await loop;
  assert.ok(Date.now() - started < 5_000);
});
