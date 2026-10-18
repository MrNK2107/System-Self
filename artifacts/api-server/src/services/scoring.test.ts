import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "@workspace/db/testing";
import { domainScores, logs, notices, scoreEvents, userDayState, users } from "@workspace/db";
import { RANKED_DOMAINS } from "@workspace/engine";
import { applyChanges } from "./scoring";
import { withUserLock } from "./user-lock";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";

after(async () => {
  await closeTestDb();
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

test("applyChanges BODY +2.5 with streak 3 -> 3.3 and a score_events row", { skip }, async () => {
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
      [{ domain: "BODY", delta: 2.5, bonus: true, activity: true, reason: "log", refId: "log-1" }],
      { localDate: "2026-01-10", now: new Date("2026-01-10T10:00:00Z") },
    ),
  );
  assert.equal(out.results[0]!.actualDelta, 3.3);
  assert.equal(out.results[0]!.score, 43.3);
  assert.equal(out.results[0]!.streak, 4);
  const row = await bodyScore(userId);
  assert.equal(row.score, 43.3);
  assert.equal(row.streak, 4);
  assert.equal(row.lastLogDate, "2026-01-10");
  const events = await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, userId));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.reason, "log");
  assert.equal(events[0]!.refId, "log-1");
  assert.equal(events[0]!.delta, 2.5);
  assert.equal(events[0]!.actualDelta, 3.3);
  assert.equal(events[0]!.localDate, "2026-01-10");
  const [state] = await db!.select().from(userDayState).where(eq(userDayState.userId, userId));
  assert.equal(state!.lastActivityDate, "2026-01-10");
  // first_log achievement notice
  const ns = await db!.select().from(notices).where(eq(notices.userId, userId));
  assert.ok(out.notices.length >= 1);
  assert.ok(ns.some((n) => n.kind === "achievement"));
});

test("applyChanges crossing 60 writes a milestone notice", { skip }, async () => {
  const userId = await seedUser({ body: 58 });
  const out = await withUserLock(db!, userId, (tx) =>
    applyChanges(tx, userId, [{ domain: "BODY", delta: 2.5, bonus: false, activity: true, reason: "log" }], {
      localDate: "2026-01-10",
      now: new Date("2026-01-10T10:00:00Z"),
    }),
  );
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
  const sum = a.results[0]!.actualDelta + b.results[0]!.actualDelta;
  assert.equal(sum, 5);
  assert.equal((await bodyScore(userId)).score, 45);
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
