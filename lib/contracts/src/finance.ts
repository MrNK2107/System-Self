import { z } from "zod";
import { LogSchema, NoticeSchema, ScoreResultSchema } from "./game";


/** Finance module (PRD 19). Private: none of this ever appears in a social payload. Amounts are in `currency`. */

/** The default expense categories (the engine's EXPENSE_CATEGORIES; a server test checks they agree). */
export const EXPENSE_CATEGORY_VALUES = [
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
export const ExpenseCategorySchema = z.enum(EXPENSE_CATEGORY_VALUES);
export type ExpenseCategoryValue = z.infer<typeof ExpenseCategorySchema>;

export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const amount = z.number().positive().finite().max(1e12);
const clientId = z.string().min(1).max(200).optional();

export const GOAL_STATUS_VALUES = ["active", "achieved", "abandoned"] as const;
export const GoalStatusSchema = z.enum(GOAL_STATUS_VALUES);

/** GET /api/finance/summary?month=YYYY-MM (default: the current local month). */
export const FinanceSummaryQuerySchema = z.object({ month: MonthSchema.optional() });

export const FinancialGoalSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  targetAmount: z.number(),
  savedAmount: z.number(),
  deadline: z.string().nullable(),
  status: GoalStatusSchema,
  achievedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type FinancialGoal = z.infer<typeof FinancialGoalSchema>;

export const RecurringIncomeSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  amount: z.number(),
  dayOfMonth: z.number().int().min(1).max(28),
  active: z.boolean(),
});
export type RecurringIncomeItem = z.infer<typeof RecurringIncomeSchema>;

export const CategorySpendSchema = z.object({ category: z.string(), spent: z.number(), limit: z.number().nullable() });
export type CategorySpend = z.infer<typeof CategorySpendSchema>;

export const NetWorthPointSchema = z.object({ month: MonthSchema, amount: z.number() });

export const FinanceSummarySchema = z.object({
  month: MonthSchema,
  currency: z.string(),
  income: z.number(),
  expenses: z.number(),
  /** (income - expenses) / income for the month; 0 without income. */
  savingsRate: z.number(),
  target: z.number(),
  /** Every default category (spend and limit), then any other logged category; month-to-date spend. */
  byCategory: z.array(CategorySpendSchema),
  goals: z.array(FinancialGoalSchema),
  /** The 12 most recent monthly snapshots up to `month`, oldest first. */
  netWorth: z.array(NetWorthPointSchema),
  recurring: z.array(RecurringIncomeSchema),
});
export type FinanceSummary = z.infer<typeof FinanceSummarySchema>;

/** PUT /api/finance/budgets: the full set (a category left out loses its budget). */
export const BudgetsRequestSchema = z.object({
  items: z
    .array(z.object({ category: ExpenseCategorySchema, monthlyLimit: amount }))
    .max(EXPENSE_CATEGORY_VALUES.length)
    .refine((items) => new Set(items.map((i) => i.category)).size === items.length, { message: "Duplicate category" }),
  clientId,
});
export const BudgetsResponseSchema = z.object({
  items: z.array(z.object({ category: ExpenseCategorySchema, monthlyLimit: z.number() })),
});

/** POST /api/finance/goals */
export const GoalCreateSchema = z.object({
  title: z.string().trim().min(1).max(80),
  targetAmount: amount,
  deadline: DateSchema.nullable().optional(),
  clientId,
});
/** PATCH /api/finance/goals/:id. `status` may only abandon or reopen; `achieved` is set by contributions. */
export const GoalUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    targetAmount: amount,
    deadline: DateSchema.nullable(),
    status: z.enum(["active", "abandoned"]),
  })
  .partial()
  .extend({ clientId })
  .refine((v) => Object.entries(v).some(([k, x]) => k !== "clientId" && x !== undefined), { message: "Nothing to update" });
export const GoalResponseSchema = z.object({ goal: FinancialGoalSchema, notices: z.array(NoticeSchema) });

/** POST /api/finance/goals/:id/contribute: also records a WEALTH `saving` log (scored like any log). */
export const GoalContributeSchema = z.object({ amount, clientId });
export const GoalContributeResponseSchema = z.object({
  goal: FinancialGoalSchema,
  log: LogSchema,
  results: z.array(ScoreResultSchema),
  notices: z.array(NoticeSchema),
});

/** PUT /api/finance/net-worth: upserts the month's snapshot. */
export const NetWorthRequestSchema = z.object({ month: MonthSchema, amount: z.number().finite().min(-1e12).max(1e12), clientId });
export const NetWorthResponseSchema = NetWorthPointSchema;

/** POST /api/finance/recurring */
export const RecurringCreateSchema = z.object({
  label: z.string().trim().min(1).max(40),
  amount,
  dayOfMonth: z.number().int().min(1).max(28),
  clientId,
});
/** PATCH /api/finance/recurring/:id */
export const RecurringUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    amount,
    dayOfMonth: z.number().int().min(1).max(28),
    active: z.boolean(),
  })
  .partial()
  .extend({ clientId })
  .refine((v) => Object.entries(v).some(([k, x]) => k !== "clientId" && x !== undefined), { message: "Nothing to update" });
export const RecurringResponseSchema = RecurringIncomeSchema;
