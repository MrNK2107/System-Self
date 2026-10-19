import { sql } from "drizzle-orm";
import { boolean, check, date, doublePrecision, index, integer, pgTable, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// Finance (PRD 19). Private to its owner: nothing here is ever read by a social projection. Amounts are in the
// profile currency (profiles.currency) and stored as double precision, so large sums keep their cents.

const ts = (name: string) => timestamp(name, { withTimezone: true });
const userIdCol = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/** A monthly spending limit per (normalized) expense category. */
export const budgets = pgTable(
  "budgets",
  {
    userId: userIdCol(),
    category: text("category").notNull(),
    monthlyLimit: doublePrecision("monthly_limit").notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.category] }), check("budgets_limit_positive", sql`${t.monthlyLimit} > 0`)],
);

/** Income the rollover posts as an `income` log on `dayOfMonth` (1..28, so every month has the day). */
export const recurringIncome = pgTable(
  "recurring_income",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    label: text("label").notNull(),
    amount: doublePrecision("amount").notNull(),
    dayOfMonth: integer("day_of_month").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("recurring_income_user_idx").on(t.userId),
    check("recurring_income_day_valid", sql`${t.dayOfMonth} between 1 and 28`),
    check("recurring_income_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const financialGoals = pgTable(
  "financial_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    title: text("title").notNull(),
    targetAmount: doublePrecision("target_amount").notNull(),
    savedAmount: doublePrecision("saved_amount").notNull().default(0),
    deadline: date("deadline", { mode: "string" }),
    status: text("status").notNull().default("active"),
    achievedAt: ts("achieved_at"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("financial_goals_user_idx").on(t.userId),
    check("financial_goals_status_valid", sql`${t.status} in ('active', 'achieved', 'abandoned')`),
    check("financial_goals_title_length", sql`char_length(${t.title}) between 1 and 80`),
    check("financial_goals_target_positive", sql`${t.targetAmount} > 0`),
  ],
);

/** One manual net worth figure per month (upserted). May be negative. */
export const netWorthSnapshots = pgTable(
  "net_worth_snapshots",
  {
    userId: userIdCol(),
    month: text("month").notNull(), // YYYY-MM
    amount: doublePrecision("amount").notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.month] }),
    check("net_worth_month_format", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

/**
 * The weekly WEALTH evaluation, written once per (user, ISO week) in the rollover of the week's last local date. The
 * row is the once-guarantee and keeps the figures the nightly debrief's verdict line quotes.
 */
export const financeWeeks = pgTable(
  "finance_weeks",
  {
    userId: userIdCol(),
    weekKey: text("week_key").notNull(), // YYYY-Www
    evaluatedOn: date("evaluated_on", { mode: "string" }).notNull(),
    /** Income, expenses and savings rate over the trailing 28 local days ending at evaluatedOn (what was scored). */
    income: doublePrecision("income").notNull().default(0),
    expenses: doublePrecision("expenses").notNull().default(0),
    savingsRate: real("savings_rate").notNull().default(0),
    /** Discretionary spend in the ISO week itself. */
    discretionary: doublePrecision("discretionary").notNull().default(0),
    /** The week's discretionary budget, or null when no discretionary category has a budget. */
    discretionaryBudget: doublePrecision("discretionary_budget"),
    /** The WEALTH change actually applied (after clamping). */
    delta: real("delta").notNull().default(0),
    /** When a nightly debrief quoted this week's verdict line (each week is quoted at most once). */
    quotedAt: ts("quoted_at"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekKey] })],
);
