import { addDays, isoWeekKey } from "./dates";
import type { ChangeSpec } from "./scoring";

/** The expense categories offered by default (PRD 19). Logged categories are compared after normalizeCategory. */
export const EXPENSE_CATEGORIES = [
  "food",
  "transport",
  "housing",
  "utilities",
  "shopping",
  "entertainment",
  "health",
  "education",
  "subscriptions",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Spending the weekly verdict line calls discretionary. */
export const DISCRETIONARY_CATEGORIES: readonly ExpenseCategory[] = ["shopping", "entertainment", "food"];

export const DEFAULT_SAVINGS_TARGET = 0.2;
export const SAVINGS_HIT_DELTA = 2.0;
export const SAVINGS_MISS_DELTA = -1.0;
export const BUDGET_OVER_DELTA = -0.5;
export const BUDGET_PENALTY_CAP = -2.0;
export const BUDGET_CLEAN_DELTA = 1.0;

const round2 = (n: number) => Math.round(Number(n.toPrecision(12)) * 100) / 100;

export const normalizeCategory = (category: string): string => category.trim().toLowerCase();

/** (income - expenses) / income; 0 when there is no income (never a division by zero). */
export function savingsRate(income: number, expenses: number): number {
  // Rounded to 12 significant digits so float noise never decides a tier boundary.
  return income > 0 ? Number(((income - expenses) / income).toPrecision(12)) : 0;
}

export interface FinanceWeekSummary {
  /** Income and expenses logged in the ISO week (Monday..Sunday). */
  income: number;
  expenses: number;
  /** Month-to-date expense per normalized category, through the week's last day. */
  categorySpend: Record<string, number>;
}

export interface Budget {
  category: string;
  monthlyLimit: number;
}

export interface FinanceWeekResult {
  savingsRate: number;
  savingsDelta: number;
  overBudget: string[];
  budgetDelta: number;
  /** WEALTH changes (never bonus, never activity); zero components are left out. */
  changes: ChangeSpec[];
}

/**
 * The weekly WEALTH evaluation. Savings rate vs target: >= target +2.0, >= target/2 0, else -1.0. Budgets: every
 * category whose month-to-date spend is over its monthly limit -0.5 (at most -2.0 in total); at least one budget set
 * and none over +1.0; no budgets 0.
 */
export function weeklyFinanceChanges(summary: FinanceWeekSummary, budgets: readonly Budget[], target: number): FinanceWeekResult {
  const rate = savingsRate(summary.income, summary.expenses);
  const savingsDelta = rate >= target ? SAVINGS_HIT_DELTA : rate >= target / 2 ? 0 : SAVINGS_MISS_DELTA;
  const overBudget = budgets
    .filter((b) => (summary.categorySpend[normalizeCategory(b.category)] ?? 0) > b.monthlyLimit)
    .map((b) => normalizeCategory(b.category));
  const budgetDelta =
    budgets.length === 0 ? 0 : overBudget.length === 0 ? BUDGET_CLEAN_DELTA : Math.max(BUDGET_PENALTY_CAP, overBudget.length * BUDGET_OVER_DELTA);
  const changes: ChangeSpec[] = [savingsDelta, budgetDelta]
    .filter((delta) => delta !== 0)
    .map((delta) => ({ domain: "WEALTH", delta, bonus: false, activity: false }));
  return { savingsRate: rate, savingsDelta, overBudget, budgetDelta, changes };
}

/** Days in a `YYYY-MM` month. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** `YYYY-MM` of a `YYYY-MM-DD` date. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** True on the last local date of an ISO week (Sunday): the date the weekly evaluations run on. */
export const isLastDayOfIsoWeek = (date: string): boolean => isoWeekKey(date) !== isoWeekKey(addDays(date, 1));

/** The discretionary budget for one week: the discretionary categories' monthly limits x 7 / days in the month. Null when none is set. */
export function weeklyDiscretionaryBudget(budgets: readonly Budget[], monthDays: number): number | null {
  const set = budgets.filter((b) => (DISCRETIONARY_CATEGORIES as readonly string[]).includes(normalizeCategory(b.category)));
  if (set.length === 0) return null;
  return round2((set.reduce((sum, b) => sum + b.monthlyLimit, 0) * 7) / monthDays);
}

/** An amount in the profile currency: whole amounts without decimals, others with two. Unknown codes fall back to `12 XYZ`. */
export function formatMoney(amount: number, currency: string, locale = "en-US"): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

/** The SYSTEM verdict on a closed finance week (nightly debrief). `delta` is the WEALTH change the evaluation applied. */
export function financeVerdictLine(
  v: { discretionary: number; budget: number; delta: number },
  money: (amount: number) => string,
): string {
  const moved = v.delta > 0 ? "rose" : v.delta < 0 ? "declined" : "moved";
  return `You logged ${money(v.discretionary)} in discretionary spending this week against a stated budget of ${money(v.budget)}. Your WEALTH score ${moved} ${Math.abs(v.delta).toFixed(1)} points. The math is not complicated.`;
}

export const goalAchieved = (saved: number, target: number): boolean => saved >= target;

export interface FinanceTotals {
  income: number;
  expenses: number;
  saving: number;
  investment: number;
  /** Expense per normalized category. */
  byCategory: Record<string, number>;
}

const amountOf = (data: unknown): number => {
  const v = data !== null && typeof data === "object" ? (data as Record<string, unknown>).amount : undefined;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
};

/** Sums WEALTH logs by type (recurring auto-logs included). Data that is not a positive number counts nothing. */
export function financeTotals(rows: readonly { logType: string; data: unknown }[]): FinanceTotals {
  const t: FinanceTotals = { income: 0, expenses: 0, saving: 0, investment: 0, byCategory: {} };
  for (const r of rows) {
    const amount = amountOf(r.data);
    if (amount === 0) continue;
    if (r.logType === "income") t.income += amount;
    else if (r.logType === "saving") t.saving += amount;
    else if (r.logType === "investment") t.investment += amount;
    else if (r.logType === "expense") {
      t.expenses += amount;
      const raw = (r.data as Record<string, unknown>).category;
      const category = typeof raw === "string" && raw.trim() ? normalizeCategory(raw) : "other";
      t.byCategory[category] = round2((t.byCategory[category] ?? 0) + amount);
    }
  }
  return { ...t, income: round2(t.income), expenses: round2(t.expenses), saving: round2(t.saving), investment: round2(t.investment) };
}
