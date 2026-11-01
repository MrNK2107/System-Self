import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "@workspace/db/testing";
import { achievements, domainScores, logs, notices, scoreEvents, userDayState, users } from "@workspace/db";
import { RANKED_DOMAINS } from "@workspace/engine";
import { applyChanges } from "./scoring";
import { withUserLock } from "./user-lock";
import { assertStoredNoticesMatchContract } from "../routes/game-test-helpers";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

async function seedUser(opts: { body?: number; bodyStreak?: number; lastLogDate?: string | null } = {}) {
  const [u] = await db!
    .insert(users)
    .values({
      email: "s@example.com",
      passwordHash: "x",
      username: "scorer",
      birthYear: 1990,
      termsAcceptedAt: new Date(),
    })
    .returning();
  const userId = u!.id;
  await db!.insert(domainScores).values(
    RANKED_DOMAINS.map((d) => ({
      userId,
      domain: d,
      score: d === "BODY" ? (opts.body ?? 40) : 40,
      streak: d === "BODY" ? (opts.bodyStreak ?? 0) : 0,
      lastLogDate: d === "BODY" ? (opts.lastLogDate ?? null) : null,
    })),
  );
  await db!.insert(userDayState).values({ userId, nextRolloverAt: new Date(Date.now() + 86_400_000) });
  return userId;
}

const bodyScore = async (userId: string) => {
  const [r] = await db!
    .select()
    .from(domainScores)
    .where(and(eq(domainScores.userId, userId), eq(domainScores.domain, "BODY")));
  return r!;
};

test("applyChanges gym BODY +2.5 with streak 3 at 40 -> +1.1 (streak and headroom) and a score_events row", { skip }, async () => {
  const userId = await seedUser({ bodyStreak: 3, lastLogDate: "2026-01-09" });
  // the log row exists before scoring (the logs route inserts it first)
  await db!.insert(logs).values({
    userId,
    clientId: "c1",
    domain: "BODY",
    logType: "workout",
    occurredAt: new Date("2026-01-10T10:00:00Z"),
    localDate: "2026-01-10",
  });
  const out = await withUserLock(db!, userId, (tx) =>
    applyChanges(
      tx,
      userId,
      // gym, not log: a log would be clipped to the 0.5 log cap and hide the multiplier.
      [{ domain: "BODY", delta: 2.5, bonus: true, activity: true, reason: "gym", refId: "log-1" }],
      { localDate: "2026-01-10", now: new Date("2026-01-10T10:00:00Z") },
    ),
  );
  // 2.5 * 1.15 streak(3) * headroom(40)=0.399 = 1.146 -> 1.1
  assert.equal(out.results[0]!.actualDelta, 1.1);
  assert.equal(out.results[0]!.score, 41.1);
  assert.equal(out.results[0]!.streak, 4);
  const row = await bodyScore(userId);
  assert.equal(row.score, 41.1);
  assert.equal(row.streak, 4);
  assert.equal(row.lastLogDate, "2026-01-10");
  const events = await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, userId));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.reason, "gym");
  assert.equal(events[0]!.refId, "log-1");
  assert.equal(events[0]!.delta, 2.5);
  assert.equal(events[0]!.actualDelta, 1.1);
  assert.equal(events[0]!.localDate, "2026-01-10");
  const [state] = await db!.select().from(userDayState).where(eq(userDayState.userId, userId));
  assert.equal(state!.lastActivityDate, "2026-01-10");
  // first_log achievement notice
  const ns = await db!.select().from(notices).where(eq(notices.userId, userId));
  assert.ok(out.notices.length >= 1);
  assert.ok(ns.some((n) => n.kind === "achievement"));
});

test("applyChanges crossing 60 writes a milestone notice", { skip }, async () => {
  // Headroom keeps one change small near 60: start at 59.8. 2.5 * headroom(59.8)=0.194 = 0.48 -> 0.5 -> 60.3
  const userId = await seedUser({ body: 59.8 });
  const out = await withUserLock(db!, userId, (tx) =>
    applyChanges(tx, userId, [{ domain: "BODY", delta: 2.5, bonus: false, activity: true, reason: "log" }], {
      localDate: "2026-01-10",
      now: new Date("2026-01-10T10:00:00Z"),
    }),
  );
  assert.equal(out.results[0]!.score, 60.3);
  assert.ok(out.notices.some((n) => n.kind === "milestone"));
});

test("concurrent applyChanges (Promise.all of 2) on one user sum correctly", { skip }, async () => {
  const userId = await seedUser({ body: 40 });
  const run = () =>
    withUserLock(db!, userId, (tx) =>
      applyChanges(tx, userId, [{ domain: "BODY", delta: 2.5, bonus: false, activity: true, reason: "log" }], {
        localDate: "2026-01-10",
        now: new Date("2026-01-10T10:00:00Z"),
      }),
    );
  const [a, b] = await Promise.all([run(), run()]);
  // 2.5 * headroom(40)=0.399 = 1.0, clipped to the 0.5 log cap; the second sees the cap used up and adds 0.
  // Without the lock both would read an empty day and add 0.5 each.
  const deltas = [a.results[0]!.actualDelta, b.results[0]!.actualDelta].sort();
  assert.deepEqual(deltas, [0, 0.5]);
  assert.equal((await bodyScore(userId)).score, 40.5);
  const events = await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, userId));
  assert.equal(events.length, 2);
});

test("backdated activity does not move lastActivityDate backwards", { skip }, async () => {
  const userId = await seedUser();
  const run = (localDate: string) =>
    withUserLock(db!, userId, (tx) =>
      applyChanges(tx, userId, [{ domain: "BODY", delta: 2.5, bonus: false, activity: true, reason: "log" }], {
        localDate,
        now: new Date("2026-01-10T10:00:00Z"),
      }),
    );
  await run("2026-01-10");
  await run("2026-01-08");
  const [state] = await db!.select().from(userDayState).where(eq(userDayState.userId, userId));
  assert.equal(state!.lastActivityDate, "2026-01-10");
});

test("only non-positive changes skip the achievement and milestone scan", { skip }, async () => {
  const userId = await seedUser({ body: 40 });
  // A log exists, so first_log is unlockable - but a decay step must not be what unlocks it.
  await db!.insert(logs).values({
    userId,
    clientId: "c-decay",
    domain: "BODY",
    logType: "workout",
    occurredAt: new Date("2026-01-10T10:00:00Z"),
    localDate: "2026-01-10",
  });
  const decay = RANKED_DOMAINS.map((domain) => ({ domain, delta: -0.3, bonus: false, activity: false, reason: "decay" as const }));
  const out = await withUserLock(db!, userId, (tx) =>
    applyChanges(tx, userId, decay, { localDate: "2026-01-10", now: new Date("2026-01-10T10:00:00Z") }),
  );
  assert.deepEqual(out.notices, []);
  assert.equal((await db!.select().from(achievements).where(eq(achievements.userId, userId))).length, 0);
});

test("daily cap: logs stop at 0.5 per domain per day, quests still fill to 4, weekly reasons are uncapped", { skip }, async () => {
  // BODY at 0: headroom(0) = 1, so deltas are taken at face value until a cap clips them.
  const userId = await seedUser({ body: 0 });
  const apply = (reason: "log" | "quest_complete" | "gym" | "finance_week", delta: number, localDate = "2026-01-10") =>
    withUserLock(db!, userId, (tx) =>
      applyChanges(tx, userId, [{ domain: "BODY", delta, bonus: false, activity: reason !== "finance_week", reason }], {
        localDate,
        now: new Date(`${localDate}T10:00:00Z`),
      }),
    ).then((o) => o.results[0]!.actualDelta);
  assert.equal(await apply("log", 2.5), 0.5, "first log clipped to the 0.5 log cap");
  assert.equal(await apply("log", 2.5), 0, "the extra log adds nothing the same day");
  assert.equal(await apply("quest_complete", 3.5), 3.5, "a quest still adds: 0.5 + 3.5 = 4 cap");
  assert.equal(await apply("gym", 2.5), 0, "the 4 cap is used up");
  // Not capped, but still headroom-scaled: 2 * headroom(4)=0.929 = 1.86 -> 1.9
  assert.equal(await apply("finance_week", 2), 1.9, "weekly evaluations are not capped");
  assert.equal((await bodyScore(userId)).score, 5.9);
  const events = await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, userId));
  assert.deepEqual(
    events.map((e) => [e.reason, e.delta, e.actualDelta]).sort((x, y) => String(x).localeCompare(String(y))),
    [
      ["finance_week", 2, 1.9],
      ["gym", 2.5, 0],
      ["log", 2.5, 0],
      ["log", 2.5, 0.5],
      ["quest_complete", 3.5, 3.5],
    ],
  );
  // The next local day starts a fresh cap: 2.5 * headroom(5.9)=0.896 = 2.24, clipped to 0.5.
  assert.equal(await apply("log", 2.5, "2026-01-11"), 0.5);
});
