import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { budgets, financialGoals, logs, netWorthSnapshots, profiles, recurringIncome, type Db } from "@workspace/db";
import { EXPENSE_CATEGORIES, localDate, logChanges, monthOf, savingsRate } from "@workspace/engine";
import {
  BudgetsRequestSchema,
  FinanceSummaryQuerySchema,
  GoalContributeSchema,
  GoalCreateSchema,
  GoalUpdateSchema,
  NetWorthRequestSchema,
  RecurringCreateSchema,
  RecurringUpdateSchema,
  type ExpenseCategoryValue,
  type FinanceSummary,
  type RecurringIncomeItem,
} from "@workspace/contracts";
import { applyActivityChanges } from "../services/activity";
import { loadBudgets, monthTotals, settleGoal, toGoalDto, userTimezone } from "../services/finance";
import { readKey, withIdempotency } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { toLogDto } from "./logs";
import type { Tx } from "../services/user-lock";

// Finance (PRD 19). Private to the owner: nothing here feeds a social projection. None of these routes score except
// a goal contribution, which records a WEALTH `saving` log through the normal log scoring.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = { status: 404, body: { error: "Goal not found", code: "not_found" } };
const NOT_ONBOARDED = { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } };
const round2 = (n: number) => Math.round(n * 100) / 100;

const toRecurringDto = (r: typeof recurringIncome.$inferSelect): RecurringIncomeItem => ({
  id: r.id,
  label: r.label,
  amount: r.amount,
  dayOfMonth: r.dayOfMonth,
  active: r.active,
});

const sortedBudgets = (rows: { category: string; monthlyLimit: number }[]) =>
  [...rows]
    .sort((a, b) => EXPENSE_CATEGORIES.indexOf(a.category as never) - EXPENSE_CATEGORIES.indexOf(b.category as never))
    .map((r) => ({ category: r.category as ExpenseCategoryValue, monthlyLimit: r.monthlyLimit }));

async function hasProfile(tx: Pick<Tx, "select">, userId: string): Promise<boolean> {
  const [p] = await tx.select({ id: profiles.userId }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return !!p;
}

export function financeRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  router.get("/finance/summary", async (req, res) => {
    const q = FinanceSummaryQuerySchema.parse(req.query);
    const userId = req.user!.id;
    const [profile] = await db
      .select({ currency: profiles.currency, target: profiles.savingsTarget })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!profile) {
      res.status(409).json(NOT_ONBOARDED.body);
      return;
    }
    const month = q.month ?? monthOf(localDate(clock(), await userTimezone(db, userId)));
    const totals = await monthTotals(db, userId, month);
    const limits = new Map((await loadBudgets(db, userId)).map((b) => [b.category, b.monthlyLimit]));
    const extra = Object.keys(totals.byCategory)
      .filter((c) => !(EXPENSE_CATEGORIES as readonly string[]).includes(c))
      .sort();
    const goals = await db.select().from(financialGoals).where(eq(financialGoals.userId, userId)).orderBy(asc(financialGoals.createdAt));
    const netWorth = await db
      .select({ month: netWorthSnapshots.month, amount: netWorthSnapshots.amount })
      .from(netWorthSnapshots)
      .where(and(eq(netWorthSnapshots.userId, userId), lte(netWorthSnapshots.month, month)))
      .orderBy(desc(netWorthSnapshots.month))
      .limit(12);
    const recurring = await db
      .select()
      .from(recurringIncome)
      .where(eq(recurringIncome.userId, userId))
      .orderBy(asc(recurringIncome.createdAt));
    const body: FinanceSummary = {
      month,
      currency: profile.currency,
      income: totals.income,
      expenses: totals.expenses,
      savingsRate: round2(savingsRate(totals.income, totals.expenses) * 100) / 100,
      target: profile.target,
      byCategory: [...EXPENSE_CATEGORIES, ...extra].map((category) => ({
        category,
        spent: totals.byCategory[category] ?? 0,
        limit: limits.get(category) ?? null,
      })),
      goals: goals.map(toGoalDto),
      netWorth: netWorth.reverse(),
      recurring: recurring.map(toRecurringDto),
    };
    res.json(body);
  });

  /** Replaces the full budget set. */
  router.put("/finance/budgets", async (req, res) => {
    const body = BudgetsRequestSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "PUT /finance/budgets", async (tx) => {
      if (!(await hasProfile(tx, userId))) return NOT_ONBOARDED;
      const now = clock();
      await tx.delete(budgets).where(eq(budgets.userId, userId));
      if (body.items.length > 0) {
        await tx.insert(budgets).values(body.items.map((i) => ({ userId, category: i.category, monthlyLimit: i.monthlyLimit, updatedAt: now })));
      }
      return { status: 200, body: { items: sortedBudgets(await loadBudgets(tx, userId)) } };
    });
  });

  router.post("/finance/goals", async (req, res) => {
    const body = GoalCreateSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /finance/goals", async (tx) => {
      if (!(await hasProfile(tx, userId))) return NOT_ONBOARDED;
      const [goal] = await tx
        .insert(financialGoals)
        .values({ userId, title: body.title, targetAmount: body.targetAmount, deadline: body.deadline ?? null, createdAt: clock() })
        .returning();
      return { status: 201, body: { goal: toGoalDto(goal!), notices: [] } };
    });
  });

  router.patch("/finance/goals/:id", async (req, res) => {
    const id = String(req.params.id);
    const { clientId: _clientId, ...patch } = GoalUpdateSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, `PATCH /finance/goals/${id}`, async (tx) => {
      if (!UUID.test(id)) return NOT_FOUND;
      const [current] = await tx
        .select()
        .from(financialGoals)
        .where(and(eq(financialGoals.id, id), eq(financialGoals.userId, userId)))
        .limit(1);
      if (!current) return NOT_FOUND;
      // An achieved goal keeps its target and status; only the title and deadline stay editable.
      if (current.status === "achieved" && (patch.status !== undefined || patch.targetAmount !== undefined)) {
        return { status: 409, body: { error: "The goal is already achieved", code: "goal_achieved" } };
      }
      const [updated] = await tx.update(financialGoals).set(patch).where(eq(financialGoals.id, id)).returning();
      const settled = await settleGoal(tx, updated!, clock());
      return { status: 200, body: { goal: toGoalDto(settled.goal), notices: settled.notices } };
    });
  });

  /**
   * Adds to an active goal and records the amount as a WEALTH `saving` log on today's local date, scored like any log
   * (applyActivityChanges). A goal reaching its target is achieved with a `goal_achieved` notice.
   */
  router.post("/finance/goals/:id/contribute", async (req, res) => {
    const id = String(req.params.id);
    const body = GoalContributeSchema.parse(req.body);
    const userId = req.user!.id;
    const key = readKey(req);
    await withIdempotency(db, req, res, `POST /finance/goals/${id}/contribute`, async (tx) => {
      if (!UUID.test(id)) return NOT_FOUND;
      const [goal] = await tx
        .select()
        .from(financialGoals)
        .where(and(eq(financialGoals.id, id), eq(financialGoals.userId, userId)))
        .limit(1);
      if (!goal) return NOT_FOUND;
      if (goal.status !== "active") return { status: 409, body: { error: "The goal is not active", code: "goal_not_active" } };

      const now = clock();
      const today = localDate(now, await userTimezone(tx, userId));
      await rollOverDue(tx, userId, now, { before: today });
      const data = { amount: body.amount, goalId: goal.id };
      const clientId = `goal:${goal.id}:${key ?? randomUUID()}`;
      // The key's idempotency record may have been pruned while its log remains: refuse instead of a unique-index 500.
      const [dup] = await tx
        .select({ id: logs.id })
        .from(logs)
        .where(and(eq(logs.userId, userId), eq(logs.clientId, clientId)))
        .limit(1);
      if (dup) return { status: 409, body: { error: "This contribution was already recorded", code: "duplicate_client_id" } };
      const [log] = await tx
        .insert(logs)
        .values({
          userId,
          clientId,
          domain: "WEALTH",
          logType: "saving",
          data,
          occurredAt: now,
          localDate: today,
          createdAt: now,
        })
        .returning();
      const changes = logChanges("WEALTH", "saving", data, false).map((c) => ({ ...c, reason: "log" as const, refId: log!.id }));
      const applied = await applyActivityChanges(tx, userId, changes, { localDate: today, now });
      const [added] = await tx
        .update(financialGoals)
        .set({ savedAmount: sql`${financialGoals.savedAmount} + ${body.amount}` })
        .where(eq(financialGoals.id, goal.id))
        .returning();
      const settled = await settleGoal(tx, added!, now);
      await rollOverDue(tx, userId, now);
      return {
        status: 201,
        body: { goal: toGoalDto(settled.goal), log: toLogDto(log!), results: applied.results, notices: [...applied.notices, ...settled.notices] },
      };
    });
  });

  router.put("/finance/net-worth", async (req, res) => {
    const body = NetWorthRequestSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "PUT /finance/net-worth", async (tx) => {
      if (!(await hasProfile(tx, userId))) return NOT_ONBOARDED;
      const now = clock();
      await tx
        .insert(netWorthSnapshots)
        .values({ userId, month: body.month, amount: body.amount, updatedAt: now })
        .onConflictDoUpdate({ target: [netWorthSnapshots.userId, netWorthSnapshots.month], set: { amount: body.amount, updatedAt: now } });
      return { status: 200, body: { month: body.month, amount: body.amount } };
    });
  });

  router.post("/finance/recurring", async (req, res) => {
    const body = RecurringCreateSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /finance/recurring", async (tx) => {
      if (!(await hasProfile(tx, userId))) return NOT_ONBOARDED;
      const [row] = await tx
        .insert(recurringIncome)
        .values({ userId, label: body.label, amount: body.amount, dayOfMonth: body.dayOfMonth, createdAt: clock() })
        .returning();
      return { status: 201, body: toRecurringDto(row!) };
    });
  });

  router.patch("/finance/recurring/:id", async (req, res) => {
    const id = String(req.params.id);
    const { clientId: _clientId, ...patch } = RecurringUpdateSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, `PATCH /finance/recurring/${id}`, async (tx) => {
      const missing = { status: 404, body: { error: "Recurring income not found", code: "not_found" } };
      if (!UUID.test(id)) return missing;
      const [row] = await tx
        .update(recurringIncome)
        .set(patch)
        .where(and(eq(recurringIncome.id, id), eq(recurringIncome.userId, userId)))
        .returning();
      if (!row) return missing;
      return { status: 200, body: toRecurringDto(row) };
    });
  });

  return router;
}
