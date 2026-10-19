import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { users } from "./users";
import { peerRatings, peerRatingWeeks } from "./peer-ratings";

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

test("peer ratings: composite key, 1-5, no self rows, week key shape, cascade on user delete", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "pa");
  const b = await mkUser(db, "pb");
  await db.insert(peerRatings).values({ raterId: a, rateeId: b, weekKey: "2026-W42", rating: 4 });
  await db.insert(peerRatings).values({ raterId: a, rateeId: b, weekKey: "2026-W43", rating: 4 });
  await assert.rejects(db.insert(peerRatings).values({ raterId: a, rateeId: b, weekKey: "2026-W42", rating: 5 }), (e) => code(e) === "23505");
  await assert.rejects(db.insert(peerRatings).values({ raterId: a, rateeId: b, weekKey: "2026-W44", rating: 0 }), (e) => code(e) === "23514");
  await assert.rejects(db.insert(peerRatings).values({ raterId: a, rateeId: b, weekKey: "2026-W44", rating: 6 }), (e) => code(e) === "23514");
  await assert.rejects(db.insert(peerRatings).values({ raterId: a, rateeId: a, weekKey: "2026-W44", rating: 3 }), (e) => code(e) === "23514");
  await assert.rejects(db.insert(peerRatings).values({ raterId: a, rateeId: b, weekKey: "2026-42", rating: 3 }), (e) => code(e) === "23514");

  await db.insert(peerRatingWeeks).values({ userId: b, weekKey: "2026-W42", evaluatedOn: "2026-10-18", ratingCount: 3, average: 4.3 });
  await assert.rejects(
    db.insert(peerRatingWeeks).values({ userId: b, weekKey: "2026-W42", evaluatedOn: "2026-10-18", ratingCount: 3, average: 4 }),
    (e) => code(e) === "23505",
    "one evaluation per (user, ISO week)",
  );

  await db.delete(users).where(eq(users.id, a));
  assert.equal((await db.select().from(peerRatings)).length, 0, "ratings given by a deleted account go with it");
  await db.delete(users).where(eq(users.id, b));
  assert.equal((await db.select().from(peerRatingWeeks)).length, 0);
});
