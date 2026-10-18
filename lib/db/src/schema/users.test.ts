import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { emailCodes, refreshTokens, users } from "./users";
import { questCompletionEvents, systemMessages } from "./system_ai";

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

test("deleting a user cascades system_messages and quest_completion_events", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const [u] = await db.insert(users).values({ ...base, email: "d@x.com", username: "dd" }).returning();
  await db.insert(systemMessages).values({
    userId: u!.id,
    messageType: "morning_briefing",
    rank: "E",
    trajectory: "up",
    shadowActive: false,
    shadowGap: 0,
    dayNumber: 1,
    message: "m",
    model: "x",
    promptVersion: "v",
    attempts: 1,
  });
  await db.insert(questCompletionEvents).values({
    userId: u!.id,
    questId: "q1",
    status: "complete",
    domain: "BODY",
    questType: "daily",
    idempotencyKey: "key-12345",
  });
  assert.equal((await db.select().from(systemMessages)).length, 1);
  await db.delete(users).where(eq(users.id, u!.id));
  assert.equal((await db.select().from(systemMessages)).length, 0);
  assert.equal((await db.select().from(questCompletionEvents)).length, 0);
});
