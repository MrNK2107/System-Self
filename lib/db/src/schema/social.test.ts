import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { CODENAME_WORDS } from "@workspace/engine";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { users } from "./users";
import { profiles } from "./game";
import { blocks, follows, userReports } from "./social";

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

test("follows and blocks: composite primary key, no self rows, cascade on user delete", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "a");
  const b = await mkUser(db, "b");
  await db.insert(follows).values({ followerId: a, followeeId: b });
  await assert.rejects(db.insert(follows).values({ followerId: a, followeeId: b }), (e: any) => code(e) === "23505");
  await db.insert(follows).values({ followerId: b, followeeId: a });
  await assert.rejects(db.insert(follows).values({ followerId: a, followeeId: a }), (e: any) => code(e) === "23514");
  await db.insert(blocks).values({ blockerId: a, blockedId: b });
  await assert.rejects(db.insert(blocks).values({ blockerId: a, blockedId: b }), (e: any) => code(e) === "23505");
  await assert.rejects(db.insert(blocks).values({ blockerId: b, blockedId: b }), (e: any) => code(e) === "23514");
  await db.delete(users).where(eq(users.id, b));
  assert.equal((await db.select().from(follows)).length, 0);
  assert.equal((await db.select().from(blocks)).length, 0);
});

test("user_reports: reason length 1..500, resolvedAt starts null", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "a");
  const b = await mkUser(db, "b");
  const [r] = await db.insert(userReports).values({ reporterId: a, subjectId: b, reason: "x".repeat(500) }).returning();
  assert.equal(r!.resolvedAt, null);
  await assert.rejects(db.insert(userReports).values({ reporterId: a, subjectId: b, reason: "x".repeat(501) }), (e: any) => code(e) === "23514");
  await assert.rejects(db.insert(userReports).values({ reporterId: a, subjectId: b, reason: "" }), (e: any) => code(e) === "23514");
});

test("profiles.public_codename is unique", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "a");
  const b = await mkUser(db, "b");
  const base = { primaryGoal: "g", biggestWeakness: "BODY", codename: "c", onboardingRatings: {} };
  await db.insert(profiles).values({ ...base, userId: a, publicCodename: "USER // ASH-1" });
  await assert.rejects(db.insert(profiles).values({ ...base, userId: b, publicCodename: "USER // ASH-1" }), (e: any) => code(e) === "23505");
});

test("public_codename backfill gives every existing profile a distinct USER // WORD-N codename", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
  const backfill = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint"))
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.includes('UPDATE "profiles"') && chunk.includes('"public_codename"'));
  assert.equal(backfill.length, 1);
  const total = CODENAME_WORDS.length + 3; // more profiles than words: the number part must advance
  const ids: string[] = [];
  for (let i = 0; i < total; i++) ids.push(await mkUser(db, `u${i}`));
  const rollback = new Error("rollback");
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE profiles ALTER COLUMN public_codename DROP NOT NULL`);
      await tx.insert(profiles).values(
        ids.map((userId, i) => ({
          userId,
          primaryGoal: "g",
          biggestWeakness: "BODY",
          codename: "c",
          onboardingRatings: {},
          publicCodename: `tmp-${i}`,
          onboardedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        })),
      );
      await tx.execute(sql`UPDATE profiles SET public_codename = NULL`);
      await tx.execute(sql.raw(backfill[0]!));
      const rows = await tx.select({ userId: profiles.userId, c: profiles.publicCodename }).from(profiles);
      assert.equal(new Set(rows.map((r) => r.c)).size, total);
      for (const r of rows) assert.match(r.c, /^USER \/\/ [A-Z]+-[1-9][0-9]*$/);
      const byId = new Map(rows.map((r) => [r.userId, r.c]));
      assert.equal(byId.get(ids[0]!), `USER // ${CODENAME_WORDS[0]}-1`); // oldest profile first: deterministic
      assert.equal(byId.get(ids[CODENAME_WORDS.length]!), `USER // ${CODENAME_WORDS[0]}-2`);
      throw rollback;
    }),
    (e) => e === rollback,
  );
});
