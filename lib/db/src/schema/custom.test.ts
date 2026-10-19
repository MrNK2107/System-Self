import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { users } from "./users";
import { customDomains, customLogs } from "./custom";

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

test("custom domains: defaults, active names unique per user case-insensitively, score range, cascades", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "ca");
  const b = await mkUser(db, "cb");
  const [d] = await db.insert(customDomains).values({ userId: a, name: "Language", baseline: 0, target: 100 }).returning();
  assert.equal(d!.score, 50);
  assert.equal(d!.streak, 0);
  assert.equal(d!.isPublic, false);
  assert.equal(d!.archivedAt, null);
  assert.equal(d!.unit, "");

  await assert.rejects(db.insert(customDomains).values({ userId: a, name: "language", baseline: 0, target: 1 }), (e) => code(e) === "23505");
  await db.insert(customDomains).values({ userId: b, name: "Language", baseline: 0, target: 1 });
  await assert.rejects(db.insert(customDomains).values({ userId: a, name: "X", baseline: 0, target: 1, score: 101 }), (e) => code(e) === "23514");
  await assert.rejects(db.insert(customDomains).values({ userId: a, name: "x".repeat(25), baseline: 0, target: 1 }), (e) => code(e) === "23514");
  // An archived name is free again.
  await db.update(customDomains).set({ archivedAt: new Date() }).where(eq(customDomains.id, d!.id));
  await db.insert(customDomains).values({ userId: a, name: "LANGUAGE", baseline: 0, target: 1 });

  const row = { userId: a, customDomainId: d!.id, value: 5, occurredAt: new Date(), localDate: "2026-10-19" };
  await db.insert(customLogs).values({ ...row, clientId: "c1" });
  await assert.rejects(db.insert(customLogs).values({ ...row, clientId: "c1" }), (e) => code(e) === "23505", "one log per (user, clientId)");
  await db.delete(customDomains).where(eq(customDomains.id, d!.id));
  assert.equal((await db.select().from(customLogs)).length, 0, "logs go with their domain");
});
