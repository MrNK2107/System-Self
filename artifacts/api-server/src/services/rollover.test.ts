import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, asc, eq, sql } from "drizzle-orm";
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
  rankFreezes,
  quests,
  scoreEvents,
  shadowSelves,
  userDayState,
} from "@workspace/db";
import { RANKED_DOMAINS, addDays, endOfLocalDay, hiddenScore, localDate } from "@workspace/engine";
import { app, auth, db, score, setup, skip, TZ, assertStoredNoticesMatchContract } from "../routes/game-test-helpers";
import { createQuests } from "./quests";
import { claimDueUsers, ensureRolledOver, ensureRolledOverIfDue, rolloverDate } from "./rollover";
import { withUserLock } from "./user-lock";
import { runLoop, runWorkerTick } from "../jobs/run-loop";
import { signAccessToken } from "../lib/auth/tokens";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

// Fixed onboarding day (Asia/Kolkata). Initial scores from the helper's ratings:
// BODY 20, MIND 24, WEALTH 16, SOCIAL 28, DISCIPLINE 12 (hidden 19 → tier E).
const D0 = "2026-01-01";
const at = (date: string, hhmm = "12:00") => new Date(`${date}T${hhmm}:00+05:30`);

/**
 * Onboards a user via the routes, then pins their onboarding day to D0. rankSince is set well before D0
 * so seeded history before D0 counts towards rank windows (they only use snapshots after rankSince's date).
 */
async function onboardAtD0(who: { email?: string; username?: string } = {}) {
  const { token, id } = await setup(app(), who);
  await db!
    .update(profiles)
    .set({ onboardedAt: at(D0, "09:00"), rankSince: at(addDays(D0, -30)) })
    .where(eq(profiles.userId, id));
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
  assert.deepEqual(n[0]!.payload, {
    domains: [
      { domain: "BODY", lostStreak: 3 },
      { domain: "DISCIPLINE", lostStreak: 2 },
    ],
    penalty: 4,
  });
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
  assert.equal(p!.rankSince.getTime(), endOfLocalDay(D0, TZ).getTime() - 1); // last instant of D0
  assert.match(p!.codename, /^VECTOR \/\/ /);
  const rc = await noticesOf(id, "rank_change");
  assert.equal(rc.length, 1);
  assert.deepEqual(rc[0]!.payload, { from: "E", to: "D", kind: "promotion", newCodename: p!.codename });
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
  await db!.insert(rankFreezes).values({ userId: id, startedOn: D0, untilOn: addDays(D0, 1), month: D0.slice(0, 7), reason: "t" });
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
  assert.equal((await eventsOf(id, "decay")).length, 0); // the ramp paused: D0+2 reads 1 inactive day, not 3
  const rc = await noticesOf(id, "rank_change");
  assert.deepEqual(rc[0]!.payload, { from: "C", to: "D", kind: "demotion", newCodename: p!.codename });
});

test("a user frozen through 7 below-threshold days is not demoted; the window pauses, it does not reset", { skip }, async () => {
  const { id } = await onboardAtD0();
  const until = addDays(D0, 6);
  await db!.update(profiles).set({ rank: "C", rankFreezeUntil: until }).where(eq(profiles.userId, id));
  await db!.insert(rankFreezes).values({ userId: id, startedOn: D0, untilOn: until, month: D0.slice(0, 7), reason: "t" });
  await setScores(id, 30);

  // D0..D0+6 all roll frozen and below the floor; D0+7 is the first unfrozen day.
  await ensureRolledOver(db!, id, at(addDays(D0, 7)));
  let [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "C");
  await ensureRolledOver(db!, id, at(addDays(D0, 8))); // rolls D0+7: one counted day only
  [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "C");
  assert.equal((await noticesOf(id, "rank_change")).length, 0);

  // The counted days resume (paused, not reset): 7 counted unfrozen days below the floor demote.
  await ensureRolledOver(db!, id, at(addDays(D0, 13)));
  [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "C"); // D0+7..D0+12 = 6 counted days
  await ensureRolledOver(db!, id, at(addDays(D0, 14)));
  [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "D");
});

test("promotion is paused by a freeze too: an idle frozen user near the floor is not promoted during or because of it", { skip }, async () => {
  const { id } = await onboardAtD0();
  await db!.update(profiles).set({ rank: "D" }).where(eq(profiles.userId, id));
  await setScores(id, 45); // hidden 45: tier C, above D
  await seedSnapshots(id, range(addDays(D0, -13), 13), 45, "D"); // 13 of the 14 days promotion needs
  const until = addDays(D0, 6);
  await db!.insert(rankFreezes).values({ userId: id, startedOn: D0, untilOn: until, month: D0.slice(0, 7), reason: "t" });

  await ensureRolledOver(db!, id, at(addDays(D0, 7))); // rolls D0..D0+6, all frozen
  let [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "D");
  assert.equal((await noticesOf(id, "rank_change")).length, 0);

  // The window resumes after the freeze: the 14th counted day is D0+7.
  await ensureRolledOver(db!, id, at(addDays(D0, 8)));
  [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "C");
});

test("the decay ramp pauses during a freeze and resumes where it stopped", { skip }, async () => {
  const { id } = await onboardAtD0();
  await db!.insert(rankFreezes).values({ userId: id, startedOn: addDays(D0, 2), untilOn: addDays(D0, 4), month: D0.slice(0, 7), reason: "t" });
  await ensureRolledOver(db!, id, at(addDays(D0, 6))); // rolls D0..D0+5
  const decays = await eventsOf(id, "decay");
  assert.deepEqual([...new Set(decays.map((e) => e.localDate))].sort(), [addDays(D0, 1), addDays(D0, 5)]);
  // D0+5 has 6 inactive days, 3 of them frozen: the ramp reads 3 (0.3), not 6 (0.6).
  assert.deepEqual(decays.filter((e) => e.localDate === addDays(D0, 5)).map((e) => e.delta), [-0.3, -0.3, -0.3, -0.3, -0.3]);
});

test("a pre-freeze below-floor run resumes after the freeze ends (paused, not reset)", { skip }, async () => {
  const { id } = await onboardAtD0();
  await db!.update(profiles).set({ rank: "C" }).where(eq(profiles.userId, id));
  await setScores(id, 30);
  await seedSnapshots(id, range(addDays(D0, -3), 3), 30, "C"); // 3 below-floor days before the freeze
  await db!.insert(rankFreezes).values({ userId: id, startedOn: D0, untilOn: addDays(D0, 6), month: D0.slice(0, 7), reason: "t" });
  await ensureRolledOver(db!, id, at(addDays(D0, 10))); // through D0+9: 3 + 3 counted days
  let [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "C");
  await ensureRolledOver(db!, id, at(addDays(D0, 11))); // D0+10: the 7th counted day
  [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.rank, "D");
});

test("a freeze covering the collapse date skips the collapsed decay step; one elsewhere in the span does not", { skip }, async () => {
  const covered = await onboardAtD0({ email: "c1@example.com", username: "cover_1" });
  await db!.insert(rankFreezes).values({ userId: covered.id, startedOn: addDays(D0, 5), untilOn: addDays(D0, 11), month: D0.slice(0, 7), reason: "t" });
  const apart = await onboardAtD0({ email: "c2@example.com", username: "apart_1" });
  await db!.insert(rankFreezes).values({ userId: apart.id, startedOn: addDays(D0, 2), untilOn: addDays(D0, 4), month: D0.slice(0, 7), reason: "t" });
  await ensureRolledOver(db!, covered.id, at(addDays(D0, 40)));
  await ensureRolledOver(db!, apart.id, at(addDays(D0, 40)));
  const collapseDate = addDays(D0, 9);
  assert.equal((await eventsOf(covered.id, "decay")).filter((e) => e.localDate === collapseDate).length, 0);
  assert.equal((await eventsOf(apart.id, "decay")).filter((e) => e.localDate === collapseDate).length, 5);
  // Frozen days after the collapse never decay.
  assert.equal((await eventsOf(covered.id, "decay")).filter((e) => e.localDate > collapseDate && e.localDate <= addDays(D0, 11)).length, 0);
});

test("shadow activates after 5 inactive days, at the end of that date during a catch-up", { skip }, async () => {
  const { id } = await onboardAtD0();
  await ensureRolledOver(db!, id, at(addDays(D0, 4))); // D0..D0+3: k up to 4
  assert.equal((await db!.select().from(shadowSelves).where(eq(shadowSelves.userId, id))).length, 0);

  await ensureRolledOver(db!, id, at(addDays(D0, 8))); // D0+4 (k = 5) .. D0+7 in one catch-up
  const [sh] = await db!.select().from(shadowSelves).where(eq(shadowSelves.userId, id));
  assert.equal(sh!.active, true);
  assert.equal(sh!.codename, "SHADOW // ALICE_1");
  assert.equal(sh!.activatedAt!.getTime(), endOfLocalDay(addDays(D0, 4), TZ).getTime());
  const n = await noticesOf(id, "shadow_activated");
  assert.equal(n.length, 1);
  assert.equal(typeof (n[0]!.payload as { gap: number }).gap, "number");
  assert.equal((n[0]!.payload as { codename: string }).codename, "SHADOW // ALICE_1");
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
  assert.equal(sh!.resolvedAt!.getTime(), endOfLocalDay(D0, TZ).getTime());
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

test("completion multiplier 0.85 for 2 of 5 completed; a quest resolved on D-30 is outside the window", { skip }, async () => {
  const { id } = await onboardAtD0();
  const outcomes: [string, string][] = [
    ["complete", D0],
    ["complete", addDays(D0, -29)], // oldest day inside [D-29, D]
    ["failed", addDays(D0, -1)],
    ["refused", addDays(D0, -2)],
    ["failed", addDays(D0, -3)],
    ["complete", addDays(D0, -30)], // excluded; counting it would give 3/6 = 0.5 -> 1.0
  ];
  for (const [status, date] of outcomes) {
    const q = await dailyQuest(id, at(addDays(D0, 5)));
    await db!.update(quests).set({ status, resolvedLocalDate: date }).where(eq(quests.id, q.id));
  }
  await ensureRolledOver(db!, id, at(addDays(D0, 1)));
  const [snap] = await db!
    .select()
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.userId, id), eq(dailySnapshots.localDate, D0)));
  const base = { BODY: 20, MIND: 24, WEALTH: 16, SOCIAL: 28, DISCIPLINE: 12 };
  assert.equal(snap!.hidden, hiddenScore(base, 0.85));
});

test("rank windows restart after a promotion: hidden 60 from E -> D on day 14, C only 14 days later", { skip }, async () => {
  const { id } = await onboardAtD0();
  await setScores(id, 60); // tier B every day
  for (const d of range(D0, 28)) await addLog(id, d); // active every day: no decay, no shadow
  const rankOf = async () => (await db!.select().from(profiles).where(eq(profiles.userId, id)))[0]!.rank;

  await ensureRolledOver(db!, id, at(addDays(D0, 13))); // D0..D0+12: 13 snapshots
  assert.equal(await rankOf(), "E");
  await ensureRolledOver(db!, id, at(addDays(D0, 14))); // D0+13: 14th snapshot
  assert.equal(await rankOf(), "D");
  await ensureRolledOver(db!, id, at(addDays(D0, 15))); // D0+14: must not cascade to C
  assert.equal(await rankOf(), "D");
  await ensureRolledOver(db!, id, at(addDays(D0, 27))); // through D0+26: 13 snapshots since the promotion
  assert.equal(await rankOf(), "D");
  await ensureRolledOver(db!, id, at(addDays(D0, 28))); // D0+27: 14th
  assert.equal(await rankOf(), "C");
  const rc = (await noticesOf(id, "rank_change")).map((n) => {
    const { newCodename, ...rest } = n.payload as { newCodename: string };
    assert.ok(newCodename.includes(" // "), newCodename);
    return rest;
  });
  assert.deepEqual(rc, [
    { from: "E", to: "D", kind: "promotion" },
    { from: "D", to: "C", kind: "promotion" },
  ]);
});

test("user_day_state without a profile is pushed back a day instead of re-leased", { skip }, async () => {
  const reg = await request(app()).post("/api/auth/register").send({
    email: "np@example.com",
    password: "correct horse battery",
    username: "no_profile",
    birthYear: 1990,
    acceptTerms: true,
    timezone: TZ,
  });
  assert.equal(reg.status, 201);
  const id = reg.body.user.id as string;
  const now = at(addDays(D0, 1));
  await db!.insert(userDayState).values({ userId: id, nextRolloverAt: endOfLocalDay(D0, TZ) });
  const { processed } = await runWorkerTick(db!, now);
  assert.equal(processed, 1);
  const [uds] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.equal(uds!.nextRolloverAt.getTime(), now.getTime() + 86_400_000);
  assert.equal(uds!.lastRolledDate, null);
});

test("POST /logs catches up missed dates first: streak break applied, earlier snapshots exclude the new log", { skip }, async (t) => {
  const a = app();
  const { id } = await setup(a);
  // Noon local, so yesterday is past its rollover grace window whatever the real clock says.
  t.mock.timers.enable({ apis: ["Date"], now: at(addDays(localDate(new Date(), TZ), 1)) });
  const { token } = await signAccessToken({ id, role: "user", tokenVersion: 0 });
  const today = localDate(new Date(), TZ);
  const d0 = addDays(today, -4);
  await db!.update(profiles).set({ onboardedAt: at(d0, "09:00") }).where(eq(profiles.userId, id));
  await db!.update(userDayState).set({ lastRolledDate: d0 }).where(eq(userDayState.userId, id));
  await db!
    .update(domainScores)
    .set({ streak: 2, lastLogDate: d0 })
    .where(and(eq(domainScores.userId, id), eq(domainScores.domain, "BODY")));
  await addLog(id, d0);

  const res = await request(a).post("/api/logs").set(auth(token)).send({ clientId: "late", domain: "BODY", logType: "generic" });
  t.mock.timers.reset();
  assert.equal(res.status, 201);
  assert.equal(res.body.results[0].streak, 1); // broken on d0+1, restarted today

  const breaks = await eventsOf(id, "streak_break");
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0]!.localDate, addDays(d0, 1));
  const snaps = await db!
    .select()
    .from(dailySnapshots)
    .where(eq(dailySnapshots.userId, id))
    .orderBy(asc(dailySnapshots.localDate));
  assert.deepEqual(
    snaps.map((s) => s.localDate).filter((d) => d > d0 && d < today),
    range(addDays(d0, 1), 3),
  );
  const lastSnap = snaps.find((s) => s.localDate === addDays(today, -1))!.scores as Record<string, number>;
  assert.equal(Math.round((lastSnap.BODY! + 2.5) * 10) / 10, (await score(id, "BODY")).score);
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
  assert.equal(uds!.nextRolloverAt.getTime(), endOfLocalDay(addDays(D0, 10), TZ).getTime() + GRACE_MS);
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
    assert.equal(uds!.nextRolloverAt.getTime(), endOfLocalDay(addDays(D0, 1), TZ).getTime() + GRACE_MS);
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

test("PATCH /auth/me timezone recomputes nextRolloverAt", { skip }, async (t) => {
  const a = app();
  // Fixed instant: 2026-10-20 15:00Z = 20:30 Kolkata / 11:00 New York (same local date, far from midnight).
  // Onboarded at that instant too, so the result does not depend on the real clock.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-20T15:00:00Z") });
  const { id, token } = await setup(a);
  const res = await request(a).patch("/api/auth/me").set(auth(token)).send({ timezone: "America/New_York" });
  t.mock.timers.reset();
  assert.equal(res.status, 200);
  const [uds] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.equal(uds!.nextRolloverAt.toISOString(), "2026-10-21T06:00:00.000Z"); // NY midnight (EDT) + 2h grace
});

test("aborted worker: tick releases unprocessed claims and runLoop exits without waiting a full tick", { skip }, async () => {
  const { id } = await onboardAtD0();
  const now = at(addDays(D0, 1));
  const aborted = AbortSignal.abort();
  assert.deepEqual(await runWorkerTick(db!, now, aborted), { processed: 0, claimed: 1 });
  assert.deepEqual(await claimDueUsers(db!, 10, now), [id]); // released, so claimable again

  const controller = new AbortController();
  const started = Date.now();
  const loop = runLoop(db!, { tickMs: 60_000, signal: controller.signal, clock: () => now });
  setTimeout(() => controller.abort(), 50);
  await loop;
  assert.ok(Date.now() - started < 5_000);
});

test("runLoop aborted during a tick finishes that tick (claims released) and then exits", { skip }, async () => {
  const { id } = await onboardAtD0();
  const now = at(addDays(D0, 1));
  const controller = new AbortController();
  let ticks = 0;
  // The abort lands as the tick starts (the clock is read once per tick).
  const clock = () => {
    ticks++;
    controller.abort();
    return now;
  };
  await runLoop(db!, { tickMs: 60_000, signal: controller.signal, clock });
  assert.equal(ticks, 1, "exactly one tick ran, then the loop exited");
  assert.deepEqual(await claimDueUsers(db!, 10, now), [id], "unprocessed claim was released");
});

test("runLoop re-ticks immediately after a full batch instead of sleeping", { skip }, async () => {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push((await onboardAtD0({ email: `b${i}@example.com`, username: `batch_${i}` })).id);
  const now = at(addDays(D0, 1));
  const controller = new AbortController();
  const loop = runLoop(db!, { tickMs: 60_000, signal: controller.signal, batchSize: 1, clock: () => now });
  const deadline = Date.now() + 10_000;
  const rolled = async () =>
    (await db!.select().from(userDayState)).filter((u) => ids.includes(u.userId) && u.lastRolledDate === D0).length;
  while ((await rolled()) < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  controller.abort();
  await loop;
  assert.equal(await rolled(), 3, "all 3 users rolled within one tick interval (batch size 1)");
});

// --- rollover grace (2h after local midnight) ------------------------------------------------

const GRACE_MS = 2 * 3600_000;
const dayStateOf = async (userId: string) =>
  (await db!.select().from(userDayState).where(eq(userDayState.userId, userId)))[0]!;

test("rollover grace: a worker tick at 00:30 does not roll the previous date; one at 02:01 does", { skip }, async () => {
  const { id } = await onboardAtD0();
  const d1 = addDays(D0, 1);
  await runWorkerTick(db!, at(d1, "00:30"));
  let uds = await dayStateOf(id);
  assert.equal(uds.lastRolledDate, null);
  assert.equal(uds.nextRolloverAt.getTime(), endOfLocalDay(D0, TZ).getTime() + GRACE_MS);
  assert.deepEqual(await claimDueUsers(db!, 10, at(d1, "01:59")), []);

  await runWorkerTick(db!, at(d1, "02:01"));
  uds = await dayStateOf(id);
  assert.equal(uds.lastRolledDate, D0);
  assert.equal(uds.nextRolloverAt.getTime(), endOfLocalDay(d1, TZ).getTime() + GRACE_MS);
});

/** onboardAtD0 + D0 rolled, BODY on a 2-day streak ending D0, and a token valid at the mocked clock. */
async function streakUserRolledThroughD0() {
  const { id } = await onboardAtD0();
  await db!
    .update(domainScores)
    .set({ streak: 2, lastLogDate: D0 })
    .where(and(eq(domainScores.userId, id), eq(domainScores.domain, "BODY")));
  await addLog(id, D0);
  await ensureRolledOver(db!, id, at(addDays(D0, 1)));
  assert.equal((await dayStateOf(id)).lastRolledDate, D0);
  return id;
}

test("offline log from 23:50 the day before, synced at 00:05: no streak break, streak +1", { skip }, async (t) => {
  const id = await streakUserRolledThroughD0();
  const d1 = addDays(D0, 1);
  t.mock.timers.enable({ apis: ["Date"], now: at(addDays(D0, 2), "00:05") });
  const { token } = await signAccessToken({ id, role: "user", tokenVersion: 0 });
  const res = await request(app())
    .post("/api/logs")
    .set(auth(token))
    .send({ clientId: "offline", domain: "BODY", logType: "generic", occurredAt: `${d1}T23:50:00+05:30` });
  t.mock.timers.reset();
  assert.equal(res.status, 201);
  assert.equal(res.body.log.localDate, d1);
  assert.equal(res.body.results[0].streak, 3);
  assert.equal((await eventsOf(id, "streak_break")).length, 0);
  assert.equal((await dayStateOf(id)).lastRolledDate, D0); // d1 is still inside its grace window
});

test("POST /logs rolls dates before the log's date, applies it, then rolls the rest", { skip }, async (t) => {
  const id = await streakUserRolledThroughD0();
  const d1 = addDays(D0, 1);
  // 02:30 on d1+1: d1 is due but not rolled yet (no worker ran); the log belongs to d1.
  t.mock.timers.enable({ apis: ["Date"], now: at(addDays(D0, 2), "02:30") });
  const { token } = await signAccessToken({ id, role: "user", tokenVersion: 0 });
  const res = await request(app())
    .post("/api/logs")
    .set(auth(token))
    .send({ clientId: "offline-2", domain: "BODY", logType: "generic", occurredAt: `${d1}T23:50:00+05:30` });
  t.mock.timers.reset();
  assert.equal(res.status, 201);
  assert.equal(res.body.results[0].streak, 3);
  assert.equal((await eventsOf(id, "streak_break")).length, 0);
  assert.equal((await eventsOf(id, "decay")).length, 0);
  assert.equal((await dayStateOf(id)).lastRolledDate, d1);
  const [snap] = await db!
    .select()
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.userId, id), eq(dailySnapshots.localDate, d1)));
  assert.equal((snap!.scores as Record<string, number>).BODY, (await score(id, "BODY")).score); // includes the log
});

test("PATCH /auth/me timezone first rolls the dates already due in the old zone", { skip }, async (t) => {
  const { id } = await onboardAtD0();
  const q = await dailyQuest(id, at(D0, "20:00"));
  // 12:00 Kolkata on D0+1 is 01:30 in New York, where D0 would not be rollable until 02:00.
  t.mock.timers.enable({ apis: ["Date"], now: at(addDays(D0, 1)) });
  const { token } = await signAccessToken({ id, role: "user", tokenVersion: 0 });
  const res = await request(app()).patch("/api/auth/me").set(auth(token)).send({ timezone: "America/New_York" });
  t.mock.timers.reset();
  assert.equal(res.status, 200);
  const uds = await dayStateOf(id);
  assert.equal(uds.lastRolledDate, D0);
  const [failed] = await db!.select().from(quests).where(eq(quests.id, q.id));
  assert.equal(failed!.status, "failed");
  assert.equal(failed!.resolvedLocalDate, D0);
  assert.equal(uds.nextRolloverAt.getTime(), endOfLocalDay(addDays(D0, 1), "America/New_York").getTime() + GRACE_MS);
});

test("ensureRolledOver writes nothing when nothing is due and the schedule is unchanged", { skip }, async () => {
  const { id } = await onboardAtD0();
  const now = at(addDays(D0, 1));
  await ensureRolledOver(db!, id, now);
  const version = async () =>
    (await db!.execute(sql`select xmin::text as v from user_day_state where user_id = ${id}`)).rows[0]!.v;
  const before = await version();
  await ensureRolledOver(db!, id, now);
  await ensureRolledOver(db!, id, at(addDays(D0, 1), "20:00"));
  assert.equal(await version(), before);
});

test("ensureRolledOverIfDue: nothing due -> no locked catch-up at all; due -> the same catch-up as ensureRolledOver", { skip }, async () => {
  const { id } = await onboardAtD0();
  // A stored lease the full catch-up would rewrite: left alone proves the fast path never ran it.
  const lease = new Date(at(D0).getTime() + 5 * 60_000);
  await db!.update(userDayState).set({ nextRolloverAt: lease }).where(eq(userDayState.userId, id));
  await ensureRolledOverIfDue(db!, id, at(D0, "23:00"));
  // D0 ends at midnight; its grace runs to 02:00 on D0+1, so at 01:59 it is still not due.
  await ensureRolledOverIfDue(db!, id, at(addDays(D0, 1), "01:59"));
  let [day] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.equal(day!.lastRolledDate, null);
  assert.equal(day!.nextRolloverAt.getTime(), lease.getTime());

  // Past the grace window D0 is due: rolled, and the schedule moves to D0+1's due instant.
  await ensureRolledOverIfDue(db!, id, at(addDays(D0, 1), "02:01"));
  [day] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.equal(day!.lastRolledDate, D0);
  assert.equal(day!.nextRolloverAt.getTime(), new Date(endOfLocalDay(addDays(D0, 1), TZ).getTime() + 2 * 3600_000).getTime());
  const snaps = await db!.select().from(dailySnapshots).where(eq(dailySnapshots.userId, id));
  assert.deepEqual(snaps.map((s) => s.localDate).sort(), [D0]);

  // A multi-day gap catches up every due date, like ensureRolledOver.
  await ensureRolledOverIfDue(db!, id, at(addDays(D0, 4), "12:00"));
  [day] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.equal(day!.lastRolledDate, addDays(D0, 3));
});

test("ensureRolledOverIfDue without a profile falls back to ensureRolledOver (which backs the schedule off)", { skip }, async () => {
  const { id } = await onboardAtD0();
  await db!.delete(profiles).where(eq(profiles.userId, id));
  const now = at(addDays(D0, 3));
  await ensureRolledOverIfDue(db!, id, now);
  const [day] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.equal(day!.nextRolloverAt.getTime(), now.getTime() + 86_400_000);
});

// --- activity inside the grace window rolls the previous dates first -------------------------

/** onboardAtD0, D0 rolled, BODY on a 5-day streak whose last log is D0; D0+1 has no activity. */
async function streakUserMissingD1() {
  const { id } = await onboardAtD0();
  await db!
    .update(domainScores)
    .set({ streak: 5, lastLogDate: D0 })
    .where(and(eq(domainScores.userId, id), eq(domainScores.domain, "BODY")));
  await addLog(id, D0);
  await ensureRolledOver(db!, id, at(addDays(D0, 1)));
  return id;
}

test("a log at 01:00 (inside the grace window) first rolls the missed day: streak break and penalty", { skip }, async (t) => {
  const id = await streakUserMissingD1();
  const d1 = addDays(D0, 1);
  const d2 = addDays(D0, 2);
  const disciplineBefore = (await score(id, "DISCIPLINE")).score;
  t.mock.timers.enable({ apis: ["Date"], now: at(d2, "01:00") });
  const { token } = await signAccessToken({ id, role: "user", tokenVersion: 0 });
  const res = await request(app()).post("/api/logs").set(auth(token)).send({ clientId: "early", domain: "BODY", logType: "generic" });
  t.mock.timers.reset();
  assert.equal(res.status, 201);
  assert.equal(res.body.log.localDate, d2);
  assert.equal(res.body.results[0].streak, 1);
  const breaks = await eventsOf(id, "streak_break");
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0]!.localDate, d1);
  assert.equal((await score(id, "DISCIPLINE")).score, disciplineBefore - 2);
  const n = await noticesOf(id, "streak_break");
  assert.deepEqual(n[0]!.payload, { domains: [{ domain: "BODY", lostStreak: 5 }], penalty: 2 });
  assert.equal((await dayStateOf(id)).lastRolledDate, d1);
  const [snap] = await db!
    .select()
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.userId, id), eq(dailySnapshots.localDate, d1)));
  const body = (await score(id, "BODY")).score;
  assert.equal(Math.round(((snap!.scores as Record<string, number>).BODY! + 2.5) * 10) / 10, body); // excludes the d2 log
});

test("a quest completed at 01:00 first rolls the missed day", { skip }, async (t) => {
  const id = await streakUserMissingD1();
  const d1 = addDays(D0, 1);
  const d2 = addDays(D0, 2);
  const q = await dailyQuest(id, at(d2, "20:00"));
  t.mock.timers.enable({ apis: ["Date"], now: at(d2, "01:00") });
  const { token } = await signAccessToken({ id, role: "user", tokenVersion: 0 });
  const res = await request(app()).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  t.mock.timers.reset();
  assert.equal(res.status, 200);
  assert.equal((await dayStateOf(id)).lastRolledDate, d1);
  const breaks = await eventsOf(id, "streak_break");
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0]!.localDate, d1);
});
