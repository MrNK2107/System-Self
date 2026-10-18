import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { emailCodes, refreshTokens, users } from "./users";

after(() => closeTestDb());

const base = {
  passwordHash: "h",
  birthYear: 1990,
  termsAcceptedAt: new Date(),
};

test("email is unique", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  await db.insert(users).values({ ...base, email: "a@x.com", username: "a" });
  await assert.rejects(
    db.insert(users).values({ ...base, email: "a@x.com", username: "b" }),
    (e: any) => (e.cause?.code ?? e.code) === "23505",
  );
});

test("deleting a user cascades refresh_tokens and email_codes", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const [u] = await db.insert(users).values({ ...base, email: "c@x.com", username: "c" }).returning();
  const expiresAt = new Date(Date.now() + 60_000);
  await db.insert(refreshTokens).values({ userId: u!.id, familyId: crypto.randomUUID(), tokenHash: "t", expiresAt });
  await db.insert(emailCodes).values({ userId: u!.id, purpose: "verify", codeHash: "c", expiresAt });
  await db.delete(users).where(eq(users.id, u!.id));
  assert.equal((await db.select().from(refreshTokens)).length, 0);
  assert.equal((await db.select().from(emailCodes)).length, 0);
});
