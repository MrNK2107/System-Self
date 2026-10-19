import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { users } from "./users";
import { namedChallenges } from "./challenges";
import { quests } from "./game";

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

test("named_challenges: valid days and status, distinct players; a deleted account keeps the row with a null side", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "a");
  const b = await mkUser(db, "b");
  const base = { challengerId: a, opponentId: b, domain: "MIND", days: 7, respondBy: new Date() };
  const [c] = await db.insert(namedChallenges).values(base).returning();
  assert.equal(c!.status, "pending");
  assert.equal(c!.winnerId, null);
  assert.equal(c!.startDate, null);
  await assert.rejects(db.insert(namedChallenges).values({ ...base, days: 5 }), (e: any) => code(e) === "23514");
  await assert.rejects(db.insert(namedChallenges).values({ ...base, status: "won" }), (e: any) => code(e) === "23514");
  await assert.rejects(db.insert(namedChallenges).values({ ...base, opponentId: a }), (e: any) => code(e) === "23514");
  await db.delete(users).where(eq(users.id, b));
  const [after] = await db.select().from(namedChallenges).where(eq(namedChallenges.id, c!.id));
  assert.equal(after!.opponentId, null);
  assert.equal(after!.challengerId, a);
});

test("quests.shame_mode defaults to false", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "a");
  const [q] = await db.insert(quests).values({ userId: a, type: "daily", title: "t", description: "d", domain: "MIND", expiresAt: new Date() }).returning();
  assert.equal(q!.shameMode, false);
});
