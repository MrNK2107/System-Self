import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { users } from "./users";
import { duoCheckins, duoInvites, duoMembers, duos } from "./duos";

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

test("duos: one membership per user, no self duo, valid kinds and statuses, cascade on user delete", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const [a, b, c] = [await mkUser(db, "a"), await mkUser(db, "b"), await mkUser(db, "c")];

  await assert.rejects(db.insert(duos).values({ userA: a, userB: a }), (e) => code(e) === "23514");
  const [d1] = await db.insert(duos).values({ userA: a, userB: b }).returning();
  const [d2] = await db.insert(duos).values({ userA: b, userB: c }).returning();
  await db.insert(duoMembers).values([
    { userId: a, duoId: d1!.id },
    { userId: b, duoId: d1!.id },
  ]);
  await assert.rejects(db.insert(duoMembers).values({ userId: b, duoId: d2!.id }), (e) => code(e) === "23505");

  await assert.rejects(db.insert(duoCheckins).values({ duoId: d1!.id, userId: a, kind: "bogus" }), (e) => code(e) === "23514");
  await db.insert(duoCheckins).values({ duoId: d1!.id, userId: a, kind: "going_now" });
  await assert.rejects(db.insert(duoInvites).values({ fromId: a, toId: a }), (e) => code(e) === "23514");
  await db.insert(duoInvites).values({ fromId: a, toId: c });
  await assert.rejects(db.insert(duoInvites).values({ fromId: a, toId: c }), (e) => code(e) === "23505", "one open invite per pair");
  await assert.rejects(db.insert(duoInvites).values({ fromId: c, toId: a, status: "bogus" }), (e) => code(e) === "23514");

  await db.delete(users).where(eq(users.id, b));
  assert.equal((await db.select().from(duos).where(eq(duos.id, d1!.id))).length, 0);
  assert.equal((await db.select().from(duoMembers)).length, 0);
  assert.equal((await db.select().from(duoCheckins)).length, 0);
});
