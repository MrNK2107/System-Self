import { and, asc, desc, eq, gte, isNull, lt, lte } from "drizzle-orm";
import { budgets, financeWeeks, financialGoals, logs, profiles, recurringIncome, users } from "@workspace/db";
import {
  DISCRETIONARY_CATEGORIES,
  SAVINGS_WINDOW_DAYS,
  addDays,
  effectiveSavingsTarget,
  daysInMonth,
  financeTotals,
  financeVerdictLine,
  formatMoney,
  goalAchieved,
  isLastDayOfIsoWeek,
  isoWeekKey,
  localTimeToInstant,
  monthOf,
  weeklyDiscretionaryBudget,
  weeklyFinanceChanges,
} from "@workspace/engine";
import type { FinancialGoal, Notice } from "@workspace/contracts";
import { applyChanges, insertNotice } from "./scoring";
import { notSystemLog } from "./system-logs";
import type { Tx } from "./user-lock";

type Reader = Pick<Tx, "select">;

// Catch-up limit: both rollover hooks below run only for dates rolled one by one. When a user has been away for more
// than MAX_CATCH_UP_DAYS (services/rollover), rollOverDue collapses the older dates into a single decay step: no
// recurring income is posted and no weekly evaluation runs for them. Only the last 30 dates are rolled individually.


/** First day of the month after a `YYYY-MM` month, as `YYYY-MM-DD`. */
export function nextMonthStart(month: string): string {
  return addDays(`${month}-01`, daysInMonth(month));
}

/** WEALTH logs (type and data) with local dates in [from, to]. Forbidden ones count too: money spent is spent. */
async function wealthLogs(tx: Reader, userId: string, from: string, to: string) {
  return tx
    .select({ logType: logs.logType, data: logs.data, localDate: logs.localDate })
    .from(logs)
    .where(and(eq(logs.userId, userId), eq(logs.domain, "WEALTH"), gte(logs.localDate, from), lte(logs.localDate, to)));
}

export async function loadBudgets(tx: Reader, userId: string) {
  return tx.select({ category: budgets.category, monthlyLimit: budgets.monthlyLimit }).from(budgets).where(eq(budgets.userId, userId));
}

/**
 * Rollover hook: on a local date whose day of month matches an active recurring income, posts it as an `income` log
 * with `system = true`. The clientId `recurring:<id>:<YYYY-MM>` makes it once per month however often the date is
 * rolled. System-generated: no score, not activity.
 */
export async function postRecurringIncome(tx: Tx, userId: string, date: string, tz: string, now: Date): Promise<void> {
  const day = Number(date.slice(8, 10));
  const due = await tx
    .select()
    .from(recurringIncome)
    .where(and(eq(recurringIncome.userId, userId), eq(recurringIncome.active, true), eq(recurringIncome.dayOfMonth, day)))
    .orderBy(asc(recurringIncome.createdAt));
  for (const r of due) {
    await tx
      .insert(logs)
      .values({
        userId,
        clientId: `recurring:${r.id}:${monthOf(date)}`,
        domain: "WEALTH",
        logType: "income",
        data: { amount: r.amount, category: "salary", note: r.label },
        system: true,
        occurredAt: localTimeToInstant(date, 0, 0, tz),
        localDate: date,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [logs.userId, logs.clientId] });
  }
}

/**
 * Rollover hook for the last local date of an ISO week: the weekly WEALTH evaluation (engine weeklyFinanceChanges),
 * only when the user logged at least one WEALTH entry themselves that week. The savings rate covers the trailing
 * SAVINGS_WINDOW_DAYS (28) local days ending at `date`: income is the user's own income logs plus recurring auto-logs,
 * expenses are expense logs, and a window with no income skips the savings component. A monthly salary therefore
 * carries the weeks after it, and a late log for a closed week still counts in the next weeks' windows. Budgets use
 * month-to-date spend through `date`. Reason `finance_week`, no bonus, not activity. The finance_weeks row (primary key
 * user + ISO week) makes it exactly once per week, and keeps the 28-day income/expenses/rate it evaluated plus the ISO
 * week's discretionary spend.
 */
export async function evaluateFinanceWeek(tx: Tx, userId: string, date: string, now: Date): Promise<Notice[]> {
  if (!isLastDayOfIsoWeek(date)) return [];
  const weekStart = addDays(date, -6);
  const [own] = await tx
    .select({ id: logs.id })
    .from(logs)
    .where(and(eq(logs.userId, userId), eq(logs.domain, "WEALTH"), gte(logs.localDate, weekStart), lte(logs.localDate, date), notSystemLog))
    .limit(1);
  if (!own) return [];
  const weekKey = isoWeekKey(date);
  const claimed = await tx
    .insert(financeWeeks)
    .values({ userId, weekKey, evaluatedOn: date, createdAt: now })
    .onConflictDoNothing()
    .returning({ weekKey: financeWeeks.weekKey });
  if (claimed.length === 0) return [];

  const month = monthOf(date);
  const monthStart = `${month}-01`;
  const windowStart = addDays(date, -(SAVINGS_WINDOW_DAYS - 1));
  const rows = await wealthLogs(tx, userId, windowStart < monthStart ? windowStart : monthStart, date);
  const window = financeTotals(rows.filter((r) => r.localDate >= windowStart));
  const week = financeTotals(rows.filter((r) => r.localDate >= weekStart));
  const monthToDate = financeTotals(rows.filter((r) => r.localDate >= monthStart));
  const userBudgets = await loadBudgets(tx, userId);
  const [profile] = await tx.select({ target: profiles.savingsTarget }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const result = weeklyFinanceChanges(
    { income: window.income, expenses: window.expenses, categorySpend: monthToDate.byCategory },
    userBudgets,
    effectiveSavingsTarget(profile?.target),
  );
  const applied = await applyChanges(
    tx,
    userId,
    result.changes.map((c) => ({ ...c, reason: "finance_week" as const, refId: weekKey })),
    { localDate: date, now },
  );
  const delta = Math.round(applied.results.reduce((sum, r) => sum + r.actualDelta, 0) * 10) / 10;
  const discretionary = DISCRETIONARY_CATEGORIES.reduce((sum, c) => sum + (week.byCategory[c] ?? 0), 0);
  await tx
    .update(financeWeeks)
    .set({
      income: window.income,
      expenses: window.expenses,
      savingsRate: result.savingsRate,
      discretionary: Math.round(discretionary * 100) / 100,
      discretionaryBudget: weeklyDiscretionaryBudget(userBudgets, daysInMonth(month)),
      delta,
    })
    .where(and(eq(financeWeeks.userId, userId), eq(financeWeeks.weekKey, weekKey)));
  return applied.notices;
}

/**
 * The finance verdict for the nightly debrief of `today`: the most recent week evaluated before `today`, if no debrief
 * has quoted it yet (quotedAt) and a discretionary budget is set. An older unquoted week behind a newer one is never
 * dug up. The debrief that stores the line marks the week quoted (markVerdictQuoted), so a nightlyTime that falls
 * before the week's rollover only delays the line to the next debrief. Null when there is nothing to quote.
 */
export async function financeVerdictFor(tx: Reader, userId: string, today: string): Promise<{ line: string; weekKey: string } | null> {
  const [row] = await tx
    .select({ week: financeWeeks, currency: profiles.currency })
    .from(financeWeeks)
    .innerJoin(profiles, eq(profiles.userId, financeWeeks.userId))
    .where(and(eq(financeWeeks.userId, userId), lt(financeWeeks.evaluatedOn, today)))
    .orderBy(desc(financeWeeks.evaluatedOn))
    .limit(1);
  if (!row || row.week.quotedAt !== null || row.week.discretionaryBudget === null) return null;
  const line = financeVerdictLine(
    {
      discretionary: row.week.discretionary,
      budget: row.week.discretionaryBudget,
      delta: row.week.delta,
      // The 28-day rate the evaluation scored; no income in the window means savings were skipped.
      savingsRate: row.week.income > 0 ? row.week.savingsRate : null,
    },
    (n) => formatMoney(n, row.currency),
  );
  return { line, weekKey: row.week.weekKey };
}

export async function markVerdictQuoted(tx: Pick<Tx, "update">, userId: string, weekKey: string, now: Date): Promise<void> {
  await tx
    .update(financeWeeks)
    .set({ quotedAt: now })
    .where(and(eq(financeWeeks.userId, userId), eq(financeWeeks.weekKey, weekKey), isNull(financeWeeks.quotedAt)));
}

export function toGoalDto(g: typeof financialGoals.$inferSelect): FinancialGoal {
  return {
    id: g.id,
    title: g.title,
    targetAmount: g.targetAmount,
    savedAmount: g.savedAmount,
    deadline: g.deadline,
    status: g.status as FinancialGoal["status"],
    achievedAt: g.achievedAt ? g.achievedAt.toISOString() : null,
    createdAt: g.createdAt.toISOString(),
  };
}

/** Marks an active goal achieved once saved >= target and writes its `goal_achieved` notice (no score change). */
export async function settleGoal(
  tx: Tx,
  goal: typeof financialGoals.$inferSelect,
  now: Date,
): Promise<{ goal: typeof financialGoals.$inferSelect; notices: Notice[] }> {
  if (goal.status !== "active" || !goalAchieved(goal.savedAmount, goal.targetAmount)) return { goal, notices: [] };
  const [achieved] = await tx
    .update(financialGoals)
    .set({ status: "achieved", achievedAt: now })
    .where(and(eq(financialGoals.id, goal.id), eq(financialGoals.status, "active")))
    .returning();
  if (!achieved) return { goal, notices: [] };
  const [p] = await tx.select({ currency: profiles.currency }).from(profiles).where(eq(profiles.userId, goal.userId)).limit(1);
  const notice = await insertNotice(
    tx,
    goal.userId,
    "goal_achieved",
    { goalId: goal.id, title: goal.title, targetAmount: goal.targetAmount, currency: p?.currency ?? "INR" },
    now,
  );
  return { goal: achieved, notices: [notice] };
}

/** The user's timezone (UTC when unknown). */
export async function userTimezone(tx: Reader, userId: string): Promise<string> {
  const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.tz ?? "UTC";
}

/** Month totals for the summary: WEALTH logs dated in `month`. */
export async function monthTotals(tx: Reader, userId: string, month: string) {
  const rows = await tx
    .select({ logType: logs.logType, data: logs.data })
    .from(logs)
    .where(
      and(
        eq(logs.userId, userId),
        eq(logs.domain, "WEALTH"),
        gte(logs.localDate, `${month}-01`),
        lt(logs.localDate, nextMonthStart(month)),
      ),
    );
  return financeTotals(rows);
}

