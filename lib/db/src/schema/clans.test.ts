import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { users } from "./users";
import { clanMembers, clans } from "./clans";

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

test("clans: unique lower name and invite code, valid tag/status/description; one clan per user; one leader per clan", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "a");
  const b = await mkUser(db, "b");
  const [c] = await db.insert(clans).values({ name: "Iron", nameLower: "iron", tag: "IRON", inviteCode: "AAAA1111", createdBy: a }).returning();
  assert.equal(c!.status, "forming");
  assert.equal(c!.clanScore, 0);
  assert.equal(c!.clanRank, null);
  await assert.rejects(db.insert(clans).values({ name: "IRON", nameLower: "iron", tag: "IR", inviteCode: "BBBB2222" }), (e: any) => code(e) === "23505");
  await assert.rejects(db.insert(clans).values({ name: "X1", nameLower: "x1", tag: "IR", inviteCode: "AAAA1111" }), (e: any) => code(e) === "23505");
  await assert.rejects(db.insert(clans).values({ name: "X2", nameLower: "x2", tag: "ir", inviteCode: "CCCC3333" }), (e: any) => code(e) === "23514");
  await assert.rejects(db.insert(clans).values({ name: "X3", nameLower: "x3", tag: "IR", inviteCode: "DDDD4444", status: "big" }), (e: any) => code(e) === "23514");
  await assert.rejects(
    db.insert(clans).values({ name: "X4", nameLower: "x4", tag: "IR", inviteCode: "EEEE5555", description: "x".repeat(201) }),
    (e: any) => code(e) === "23514",
  );
  const [c2] = await db.insert(clans).values({ name: "Owls", nameLower: "owls", tag: "OWL", inviteCode: "FFFF6666" }).returning();

  await db.insert(clanMembers).values({ userId: a, clanId: c!.id, role: "leader" });
  await assert.rejects(db.insert(clanMembers).values({ userId: a, clanId: c2!.id, role: "member" }), (e: any) => code(e) === "23505");
  await assert.rejects(db.insert(clanMembers).values({ userId: b, clanId: c!.id, role: "leader" }), (e: any) => code(e) === "23505");
  await assert.rejects(db.insert(clanMembers).values({ userId: b, clanId: c!.id, role: "boss" }), (e: any) => code(e) === "23514");
  await db.insert(clanMembers).values({ userId: b, clanId: c!.id, role: "member" });

  // a deleted user leaves the clan; a deleted clan takes its members
  await db.delete(users).where(eq(users.id, b));
  assert.equal((await db.select().from(clanMembers)).length, 1);
  await db.delete(clans).where(eq(clans.id, c!.id));
  assert.equal((await db.select().from(clanMembers)).length, 0);
});
