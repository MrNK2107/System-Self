import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { DEFAULT_EXERCISES } from "@workspace/engine";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { SEED_EXERCISES } from "../seed";
import { users } from "./users";
import { logs, questChains } from "./game";
import { exercises } from "./gym";

after(() => closeTestDb());

const code = (e: any) => e.cause?.code ?? e.code;

async function mkUser(db: NonNullable<ReturnType<typeof getTestDb>>) {
  const [u] = await db
    .insert(users)
    .values({ email: "g@x.com", passwordHash: "h", username: "g", birthYear: 1990, termsAcceptedAt: new Date() })
    .returning();
  return u!.id;
}

test("logs (userId, clientId) is unique", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const userId = await mkUser(db);
  const row = { userId, clientId: "c1", domain: "BODY", logType: "workout", occurredAt: new Date(), localDate: "2026-10-19" };
  await db.insert(logs).values(row);
  await assert.rejects(db.insert(logs).values(row), (e: any) => code(e) === "23505");
  await db.insert(logs).values({ ...row, clientId: "c2" });
});

test("only one active chain per template per user", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const userId = await mkUser(db);
  const row = { userId, templateKey: "tpl", name: "Chain", domain: "MIND", totalSteps: 3 };
  const [first] = await db.insert(questChains).values(row).returning();
  await assert.rejects(db.insert(questChains).values(row), (e: any) => code(e) === "23505");
  await db.insert(questChains).values({ ...row, templateKey: "other" });
  // once the first is no longer active, a new active one is allowed
  await db.update(questChains).set({ status: "complete" }).where(eq(questChains.id, first!.id));
  await db.insert(questChains).values(row);
});

test("seeded exercises exist after migrate and after resetDb, and match engine DEFAULT_EXERCISES", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const rows = await db.select().from(exercises).where(isNull(exercises.userId)).orderBy(asc(exercises.id));
  assert.equal(rows.length, 20);
  const norm = (r: { id: string; name: string; primaryBodyPart: string; secondaryBodyParts: unknown; isBig5: boolean }) => ({
    id: r.id,
    name: r.name,
    primaryBodyPart: r.primaryBodyPart,
    secondaryBodyParts: r.secondaryBodyParts,
    isBig5: r.isBig5,
  });
  const expected = [...DEFAULT_EXERCISES].sort((a, b) => a.id.localeCompare(b.id)).map(norm);
  assert.deepEqual(rows.map(norm), expected);
  assert.deepEqual([...SEED_EXERCISES].sort((a, b) => a.id.localeCompare(b.id)), expected);
});

test("migration seed INSERT itself produces the engine DEFAULT_EXERCISES", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
  const insertStmts = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint"))
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.includes('INSERT INTO "exercises"'));
  assert.equal(insertStmts.length, 2);
  await db.execute(sql`DELETE FROM exercises`);
  for (const stmt of insertStmts) await db.execute(sql.raw(stmt));
  const rows = await db.select().from(exercises).where(isNull(exercises.userId)).orderBy(asc(exercises.id));
  const expected = [...DEFAULT_EXERCISES].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(
    rows.map(({ userId: _u, ...r }) => r),
    expected,
  );
});
