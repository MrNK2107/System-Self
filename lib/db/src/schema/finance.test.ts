import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "../testing";
import { users } from "./users";
import { logs, profiles } from "./game";
import { budgets, financeWeeks, financialGoals, netWorthSnapshots, recurringIncome } from "./finance";

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

test("finance: profile defaults, keys, checks and cascade on user delete", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "fa");
  await db.insert(profiles).values({
    userId: a,
    primaryGoal: "goal goal",
    biggestWeakness: "WEALTH",
    codename: "X",
    onboardingRatings: {},
    publicCodename: "USER // FA-1",
  });
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, a));
  assert.equal(p!.currency, "INR");
  assert.equal(p!.savingsTarget, 0.2);

  await db.insert(budgets).values({ userId: a, category: "food", monthlyLimit: 100 });
  await assert.rejects(db.insert(budgets).values({ userId: a, category: "food", monthlyLimit: 5 }), (e) => code(e) === "23505");
  await assert.rejects(db.insert(budgets).values({ userId: a, category: "rent", monthlyLimit: -1 }), (e) => code(e) === "23514");

  await db.insert(recurringIncome).values({ userId: a, label: "Salary", amount: 50000, dayOfMonth: 28 });
  await assert.rejects(db.insert(recurringIncome).values({ userId: a, label: "x", amount: 1, dayOfMonth: 29 }), (e) => code(e) === "23514");
  await assert.rejects(db.insert(recurringIncome).values({ userId: a, label: "x", amount: 1, dayOfMonth: 0 }), (e) => code(e) === "23514");

  const [g] = await db.insert(financialGoals).values({ userId: a, title: "Fund", targetAmount: 5000 }).returning();
  assert.equal(g!.savedAmount, 0);
  assert.equal(g!.status, "active");
  await assert.rejects(db.insert(financialGoals).values({ userId: a, title: "x", targetAmount: 1, status: "bogus" }), (e) => code(e) === "23514");
  await assert.rejects(db.insert(financialGoals).values({ userId: a, title: "x".repeat(81), targetAmount: 1 }), (e) => code(e) === "23514");

  await db.insert(netWorthSnapshots).values({ userId: a, month: "2026-10", amount: -500 });
  await assert.rejects(db.insert(netWorthSnapshots).values({ userId: a, month: "2026-10", amount: 1 }), (e) => code(e) === "23505");
  await assert.rejects(db.insert(netWorthSnapshots).values({ userId: a, month: "2026-13x", amount: 1 }), (e) => code(e) === "23514");

  await db.insert(financeWeeks).values({ userId: a, weekKey: "2026-W42", evaluatedOn: "2026-10-18" });
  await assert.rejects(
    db.insert(financeWeeks).values({ userId: a, weekKey: "2026-W42", evaluatedOn: "2026-10-18" }),
    (e) => code(e) === "23505",
    "one evaluation per (user, ISO week)",
  );

  await db.delete(users).where(eq(users.id, a));
  for (const table of [budgets, recurringIncome, financialGoals, netWorthSnapshots, financeWeeks]) {
    assert.equal((await db.select().from(table)).length, 0);
  }
});

test("logs.system defaults to false; the migration backfills earlier recurring auto-logs", async (t) => {
  const db = getTestDb();
  if (!db) return t.skip("TEST_DATABASE_URL not set");
  await resetDb(db);
  const a = await mkUser(db, "sy");
  const [row] = await db
    .insert(logs)
    .values({ userId: a, clientId: "c1", domain: "WEALTH", logType: "generic", data: { recurring: true }, occurredAt: new Date(), localDate: "2026-01-01" })
    .returning();
  assert.equal(row!.system, false, "a data marker never makes a log a system log");
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
  const sqlText = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
  assert.match(sqlText, /UPDATE "logs" SET "system" = true WHERE "client_id" LIKE 'recurring:%';/);
});
