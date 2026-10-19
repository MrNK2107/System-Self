// Finance (GET/PUT/POST/PATCH /api/finance...): plain helpers and requests, no React Native imports. Amounts are in
// the profile currency and shown with Intl.NumberFormat. Every mutation is a plain request sent after the outbox; a
// goal contribution also records a scored WEALTH saving log on the server, so callers refetch the game state after it.
import {
  BudgetsResponseSchema,
  ExpenseCategorySchema,
  FinanceSummarySchema,
  GoalContributeResponseSchema,
  GoalResponseSchema,
  NetWorthResponseSchema,
  RecurringResponseSchema,
  type ExpenseCategoryValue,
  type FinanceSummary,
  type FinancialGoal,
  type RecurringIncomeItem,
} from "@workspace/contracts";
import { EXPENSE_CATEGORIES, formatMoney } from "@workspace/engine";
import { z } from "zod";
import { ApiError, type ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { afterOutbox, type MutationResult } from "../game/actions";

export { EXPENSE_CATEGORIES };

/** An amount in the profile currency (`₹4,200`, `$12.50`). */
export const money = (amount: number, currency: string): string => formatMoney(amount, currency);

/** A rate as a percentage with at most one decimal (`62.5%`, `20%`). */
export const percent = (rate: number): string => `${Math.round(rate * 1000) / 10}%`;

export const categoryLabel = (category: string): string => category.charAt(0).toUpperCase() + category.slice(1);

/** The summary's verdict on the savings rate, with the same tiers as the weekly evaluation. */
export function savingsVerdict(rate: number, target: number): { tone: "good" | "warn" | "bad"; line: string } {
  const head = `Savings rate ${percent(rate)} against a ${percent(target)} target.`;
  if (rate >= target) return { tone: "good", line: `${head} Held.` };
  if (rate >= target / 2) return { tone: "warn", line: `${head} Short.` };
  return { tone: "bad", line: `${head} Failing.` };
}

/** A category's spent/limit bar; null without a limit. */
export function budgetBar(spent: number, limit: number | null): { fraction: number; over: boolean } | null {
  if (limit === null || limit <= 0) return null;
  return { fraction: Math.min(1, spent / limit), over: spent > limit };
}

export const goalProgress = (g: Pick<FinancialGoal, "savedAmount" | "targetAmount">): number =>
  g.targetAmount > 0 ? Math.min(1, g.savedAmount / g.targetAmount) : 0;

/** Net worth snapshots newest first, each with its change from the previous snapshot (null for the oldest). */
export function netWorthRows(points: readonly { month: string; amount: number }[]): { month: string; amount: number; change: number | null }[] {
  const asc = [...points].sort((a, b) => a.month.localeCompare(b.month));
  return asc
    .map((p, i) => ({ ...p, change: i === 0 ? null : Math.round((p.amount - asc[i - 1]!.amount) * 100) / 100 }))
    .reverse();
}

/** A positive amount typed by the user (`1,500.5` reads as 1500.5); null when blank, zero or unreadable. */
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 && n <= 1e12 ? n : null;
}

/** A net worth figure: any finite amount, negative allowed (`-12,000`); null when blank or unreadable. */
export function parseSignedAmount(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Math.abs(n) <= 1e12 ? n : null;
}

/** A deadline typed as YYYY-MM-DD (blank is no deadline); undefined when malformed. */
export function parseDeadline(text: string): string | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return undefined;
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : undefined;
}

/** A savings target typed as a percentage (5..90) to the 0.05..0.9 fraction the server stores; null when out of range. */
export function parseSavingsTarget(text: string): number | null {
  const n = Number(text.trim().replace(/%$/, ""));
  if (text.trim() === "" || !Number.isFinite(n) || n < 5 || n > 90) return null;
  return Math.round(n * 10) / 1000;
}

export type BudgetDraft = Record<ExpenseCategoryValue, string>;

/** The budget form's text per default category, from the summary's limits. */
export function budgetDraft(summary: Pick<FinanceSummary, "byCategory">): BudgetDraft {
  const limits = new Map(summary.byCategory.map((c) => [c.category, c.limit]));
  return Object.fromEntries(
    EXPENSE_CATEGORIES.map((c) => {
      const limit = limits.get(c);
      return [c, limit === null || limit === undefined ? "" : String(limit)];
    }),
  ) as BudgetDraft;
}

/** The PUT body from the form: blank drops a category's budget; anything else must be a positive amount. */
export function budgetItemsFromDraft(
  draft: BudgetDraft,
): { ok: true; items: { category: ExpenseCategoryValue; monthlyLimit: number }[] } | { ok: false; invalid: ExpenseCategoryValue[] } {
  const items: { category: ExpenseCategoryValue; monthlyLimit: number }[] = [];
  const invalid: ExpenseCategoryValue[] = [];
  for (const category of EXPENSE_CATEGORIES) {
    const text = (draft[category] ?? "").trim();
    if (text === "") continue;
    const amount = parseAmount(text);
    if (amount === null) invalid.push(category);
    else items.push({ category, monthlyLimit: amount });
  }
  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, items };
}

/** SYSTEM-voice line for a failed finance request. */
export function describeFinanceError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The request failed. Retry.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  switch (err.code) {
    case "goal_not_active":
      return "That goal is closed. Contributions are not accepted.";
    case "goal_achieved":
      return "That goal is already achieved. Set a new one.";
    case "not_onboarded":
      return "Finish onboarding first.";
    case "not_found":
      return "Not found. It may have been removed.";
    default:
      if (err.status === 400) return "Check the fields and retry.";
      return (err.status ?? 0) >= 500 ? "The system is unavailable. Retry shortly." : "The request was rejected.";
  }
}

// --- requests ----------------------------------------------------------------------------------------

type Guard = Pick<Outbox, "flushBeforeMutation">;
const seg = encodeURIComponent;
// Notices are parsed loosely: a kind this build does not know must not fail the response (notices.ts skips it).
const LooseGoalResponseSchema = GoalResponseSchema.extend({ notices: z.array(z.unknown()) });
const LooseContributeSchema = GoalContributeResponseSchema.extend({ notices: z.array(z.unknown()) });
export type GoalResult = z.infer<typeof LooseGoalResponseSchema>;
export type ContributeResult = z.infer<typeof LooseContributeSchema>;

export function fetchFinanceSummary(api: ApiClient, month?: string): Promise<FinanceSummary> {
  return api.request("GET", `/api/finance/summary${month ? `?month=${seg(month)}` : ""}`, { schema: FinanceSummarySchema });
}

export function putBudgets(
  api: ApiClient,
  outbox: Guard,
  items: { category: ExpenseCategoryValue; monthlyLimit: number }[],
  clientId: string,
): Promise<MutationResult<z.infer<typeof BudgetsResponseSchema>>> {
  return afterOutbox(outbox, () =>
    api.request("PUT", "/api/finance/budgets", { body: { items, clientId }, idempotencyKey: clientId, schema: BudgetsResponseSchema }),
  );
}

export function createGoal(
  api: ApiClient,
  outbox: Guard,
  goal: { title: string; targetAmount: number; deadline: string | null },
  clientId: string,
): Promise<MutationResult<GoalResult>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/finance/goals", { body: { ...goal, clientId }, idempotencyKey: clientId, schema: LooseGoalResponseSchema }),
  );
}

export function updateGoal(
  api: ApiClient,
  outbox: Guard,
  id: string,
  patch: { title?: string; targetAmount?: number; deadline?: string | null; status?: "active" | "abandoned" },
  clientId: string,
): Promise<MutationResult<GoalResult>> {
  return afterOutbox(outbox, () =>
    api.request("PATCH", `/api/finance/goals/${seg(id)}`, { body: { ...patch, clientId }, idempotencyKey: clientId, schema: LooseGoalResponseSchema }),
  );
}

/** Adds to a goal; the server also records a scored WEALTH saving log. */
export function contributeToGoal(api: ApiClient, outbox: Guard, id: string, amount: number, clientId: string): Promise<MutationResult<ContributeResult>> {
  return afterOutbox(outbox, () =>
    api.request("POST", `/api/finance/goals/${seg(id)}/contribute`, { body: { amount, clientId }, idempotencyKey: clientId, schema: LooseContributeSchema }),
  );
}

export function putNetWorth(api: ApiClient, outbox: Guard, month: string, amount: number, clientId: string) {
  return afterOutbox(outbox, () =>
    api.request("PUT", "/api/finance/net-worth", { body: { month, amount, clientId }, idempotencyKey: clientId, schema: NetWorthResponseSchema }),
  );
}

export function createRecurring(
  api: ApiClient,
  outbox: Guard,
  item: { label: string; amount: number; dayOfMonth: number },
  clientId: string,
): Promise<MutationResult<RecurringIncomeItem>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/finance/recurring", { body: { ...item, clientId }, idempotencyKey: clientId, schema: RecurringResponseSchema }),
  );
}

export function setRecurringActive(api: ApiClient, outbox: Guard, id: string, active: boolean, clientId: string): Promise<MutationResult<RecurringIncomeItem>> {
  return afterOutbox(outbox, () =>
    api.request("PATCH", `/api/finance/recurring/${seg(id)}`, { body: { active, clientId }, idempotencyKey: clientId, schema: RecurringResponseSchema }),
  );
}

/** PATCH /api/profile with the finance settings (the response is the profile, not needed here). */
export function updateFinanceSettings(
  api: ApiClient,
  outbox: Guard,
  settings: { currency?: string; savingsTarget?: number },
  clientId: string,
): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("PATCH", "/api/profile", { body: settings, idempotencyKey: clientId }));
}

export const isExpenseCategory = (c: string): c is ExpenseCategoryValue => ExpenseCategorySchema.safeParse(c).success;
