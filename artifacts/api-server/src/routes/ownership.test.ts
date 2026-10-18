import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { closeTestDb, getTestDb, resetDb } from "@workspace/db/testing";
import { users } from "@workspace/db";
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

beforeEach(async () => {
  if (!db) return;
  await resetDb(db);
  const base = { passwordHash: "h", birthYear: 1990, termsAcceptedAt: new Date() };
  const [a] = await db.insert(users).values({ ...base, email: "a@x.com", username: "user_a" }).returning();
  const [b] = await db.insert(users).values({ ...base, email: "b@x.com", username: "user_b" }).returning();
  nameA = a!.username;
  tokenA = (await signAccessToken({ id: a!.id, role: "user", tokenVersion: a!.tokenVersion })).token;
  tokenB = (await signAccessToken({ id: b!.id, role: "user", tokenVersion: b!.tokenVersion })).token;
});

test("a quest completion posted by A is not visible to B, even with A's username as a query param", { skip }, async () => {
  const app = createApp({ db });
  const post = await request(app)
    .post("/api/system/quest-completion")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ questId: "q-1", status: "complete", domain: "BODY", questType: "daily" });
  assert.equal(post.status, 201);

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
  const a = await request(app).get("/api/system/completions/summary").set("Authorization", `Bearer ${tokenA}`);
  assert.equal(a.body.attempts, 0);
  const b = await request(app).get("/api/system/completions/summary").set("Authorization", `Bearer ${tokenB}`);
  assert.equal(b.body.attempts, 1);
});
