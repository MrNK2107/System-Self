import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { users } from "./users";
import { userReports } from "./social";
import { ghostRivals, rivalAssignments, rivalChallenges, rivalTaunts } from "./rivals";

after(() => closeTestDb());

const code = (e: any) => e.cause?.code ?? e.code;
type TestDb = NonNullable<ReturnType<typeof getTestDb>>;

async function mkUser(db: TestDb, name: string) {
  const [u] = await db
    .insert(users)
    .values({ email: `${name}@x.com`, passwordHash: "h", username: name, birthYear: 1990, termsAcceptedAt: new Date() })
    .returning();
  return u!.id;
}

const later = new Date(Date.now() + 86_400_000);

test("rival assignments: exactly one of rival user / ghost, slot 1..3, one row per slot", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "a");
  const b = await mkUser(db, "b");
  const [g] = await db
    .insert(ghostRivals)
    .values({ ownerId: a, codename: "RIVAL // ASH-1", rank: "E", scores: {}, trajectory: "up" })
    .returning();
  const base = { userId: a, codename: "RIVAL // ASH-1", expiresAt: later };
  await assert.rejects(db.insert(rivalAssignments).values({ ...base, slot: 1 }), (e: any) => code(e) === "23514");
  await assert.rejects(
    db.insert(rivalAssignments).values({ ...base, slot: 1, rivalUserId: b, ghostId: g!.id }),
    (e: any) => code(e) === "23514",
  );
  await assert.rejects(db.insert(rivalAssignments).values({ ...base, slot: 4, rivalUserId: b }), (e: any) => code(e) === "23514");
  await db.insert(rivalAssignments).values({ ...base, slot: 1, ghostId: g!.id });
  await assert.rejects(db.insert(rivalAssignments).values({ ...base, slot: 1, rivalUserId: b }), (e: any) => code(e) === "23505");
  await db.insert(rivalAssignments).values({ ...base, slot: 2, rivalUserId: b });
  // deleting the rival user drops their slot; deleting the ghost drops its slot
  await db.delete(users).where(eq(users.id, b));
  await db.delete(ghostRivals).where(eq(ghostRivals.id, g!.id));
  assert.equal((await db.select().from(rivalAssignments)).length, 0);
});

test("one open challenge per assignment; history survives the assignment", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "a");
  const b = await mkUser(db, "b");
  const [asg] = await db
    .insert(rivalAssignments)
    .values({ userId: a, slot: 1, rivalUserId: b, codename: "RIVAL // ASH-1", expiresAt: later })
    .returning();
  const ch = {
    userId: a,
    assignmentId: asg!.id,
    codename: "RIVAL // ASH-1",
    domain: "MIND",
    startDate: "2026-01-01",
    endDate: "2026-01-07",
    userStart: 10,
    rivalStart: 12,
  };
  const [first] = await db.insert(rivalChallenges).values(ch).returning();
  await assert.rejects(db.insert(rivalChallenges).values(ch), (e: any) => code(e) === "23505");
  await db.update(rivalChallenges).set({ outcome: "win" }).where(eq(rivalChallenges.id, first!.id));
  await db.insert(rivalChallenges).values(ch);
  await db.insert(rivalTaunts).values({ userId: a, assignmentId: asg!.id, codename: "RIVAL // ASH-1", message: "m", localDate: "2026-01-01" });
  await assert.rejects(
    db.insert(rivalTaunts).values({ userId: a, assignmentId: asg!.id, codename: "RIVAL // ASH-1", message: "m", localDate: "2026-01-01" }),
    (e: any) => code(e) === "23505",
  );
  await db.delete(rivalAssignments).where(eq(rivalAssignments.id, asg!.id));
  const left = await db.select().from(rivalChallenges);
  assert.equal(left.length, 2);
  assert.ok(left.every((c) => c.assignmentId === null));
  assert.equal((await db.select().from(rivalTaunts))[0]!.assignmentId, null);
});

test("user_reports: one open report per reporter and subject", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "a");
  const b = await mkUser(db, "b");
  const [r] = await db.insert(userReports).values({ reporterId: a, subjectId: b, reason: "x" }).returning();
  await assert.rejects(db.insert(userReports).values({ reporterId: a, subjectId: b, reason: "y" }), (e: any) => code(e) === "23505");
  await db.update(userReports).set({ resolvedAt: new Date() }).where(eq(userReports.id, r!.id));
  await db.insert(userReports).values({ reporterId: a, subjectId: b, reason: "y" });
});
