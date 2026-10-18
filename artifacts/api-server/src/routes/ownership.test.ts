import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { closeTestDb, getTestDb, resetDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";
import { questCompletionEvents, quests, users } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import { CompletionSummarySchema } from "@workspace/contracts";
import { createApp } from "../app-factory";
import { signAccessToken } from "../lib/auth/tokens";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";

after(async () => {
  await closeTestDb();
});

let tokenA = "";
let tokenB = "";
let nameA = "";
let idA = "";
let idB = "";

beforeEach(async () => {
  if (!db) return;
  await resetDb(db);
  const base = { passwordHash: "h", birthYear: 1990, termsAcceptedAt: new Date() };
  const [a] = await db.insert(users).values({ ...base, email: "a@x.com", username: "user_a" }).returning();
  const [b] = await db.insert(users).values({ ...base, email: "b@x.com", username: "user_b" }).returning();
  nameA = a!.username;
  idA = a!.id;
  idB = b!.id;
  tokenA = (await signAccessToken({ id: a!.id, role: "user", tokenVersion: a!.tokenVersion })).token;
  tokenB = (await signAccessToken({ id: b!.id, role: "user", tokenVersion: b!.tokenVersion })).token;
});

/** A quest of `userId` resolved with `status` on local date `date` (or still active when status is "active"). */
async function quest(userId: string, status: string, date: string | null, domain = "BODY") {
  await db!.insert(quests).values({
    userId,
    type: "daily",
    title: "q",
    description: "d",
    domain,
    status,
    expiresAt: new Date(Date.now() + 3600_000),
    resolvedLocalDate: date,
    resolvedAt: date ? new Date() : null,
  });
}

test("completion summary counts the requester's resolved quests in the last `days` local days", { skip }, async () => {
  const app = createApp({ db });
  const today = localDate(new Date(), "UTC"); // users default to UTC
  await quest(idA, "complete", today, "BODY");
  await quest(idA, "failed", today, "MIND");
  await quest(idA, "refused", addDays(today, -3), "BODY");
  await quest(idA, "complete", addDays(today, -13), "BODY"); // oldest day inside a 14-day window
  await quest(idA, "complete", addDays(today, -14), "BODY"); // outside
  await quest(idA, "active", null);
  await quest(idB, "complete", today);

  const res = await request(app).get("/api/system/completions/summary").set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 200);
  const body = CompletionSummarySchema.parse(res.body);
  assert.deepEqual(body, res.body);
  assert.equal(body.windowDays, 14);
  assert.equal(body.attempts, 4);
  assert.equal(body.completed, 2);
  assert.equal(body.completionRate, 50);
  assert.equal("username" in res.body, false);
  assert.deepEqual(body.byDomain, [
    { domain: "BODY", status: "complete", count: 2 },
    { domain: "BODY", status: "refused", count: 1 },
    { domain: "MIND", status: "failed", count: 1 },
  ]);
  assert.deepEqual(body.daily, [
    { day: addDays(today, -13), status: "complete", count: 1 },
    { day: addDays(today, -3), status: "refused", count: 1 },
    { day: today, status: "complete", count: 1 },
    { day: today, status: "failed", count: 1 },
  ]);
  const week = await request(app).get("/api/system/completions/summary?days=1").set("Authorization", `Bearer ${tokenA}`);
  assert.equal(week.body.attempts, 2);
});

test("A's quests are not visible to B, even with A's username as a query param", { skip }, async () => {
  const app = createApp({ db });
  await quest(idA, "complete", localDate(new Date(), "UTC"));
  const mine = await request(app).get("/api/system/completions/summary").set("Authorization", `Bearer ${tokenA}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.attempts, 1);

  const theirs = await request(app).get("/api/system/completions/summary").set("Authorization", `Bearer ${tokenB}`);
  assert.equal(theirs.status, 200);
  assert.equal(theirs.body.attempts, 0);

  const spoof = await request(app)
    .get(`/api/system/completions/summary?username=${nameA}`)
    .set("Authorization", `Bearer ${tokenB}`);
  assert.equal(spoof.status, 200);
  assert.equal(spoof.body.attempts, 0);
});

test("idempotency is scoped per user", { skip }, async () => {
  const app = createApp({ db });
  const body = { questId: "q-1", status: "complete", domain: "BODY", questType: "daily", idempotencyKey: "same-key-123" };
  const a = await request(app).post("/api/system/quest-completion").set("Authorization", `Bearer ${tokenA}`).send(body);
  const b = await request(app).post("/api/system/quest-completion").set("Authorization", `Bearer ${tokenB}`).send(body);
  const a2 = await request(app).post("/api/system/quest-completion").set("Authorization", `Bearer ${tokenA}`).send(body);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a2.status, 200);
  assert.equal(a2.body.deduplicated, true);
});

test("body username cannot decide ownership of a posted completion", { skip }, async () => {
  const app = createApp({ db });
  const post = await request(app)
    .post("/api/system/quest-completion")
    .set("Authorization", `Bearer ${tokenB}`)
    .send({ username: nameA, questId: "q-9", status: "complete", domain: "MIND", questType: "daily" });
  assert.equal(post.status, 201);
  const rows = await db!.select().from(questCompletionEvents);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.userId, idB);
  assert.equal((await db!.select().from(questCompletionEvents).where(eq(questCompletionEvents.userId, idA))).length, 0);
});
