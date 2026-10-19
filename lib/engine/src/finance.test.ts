import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SAVINGS_TARGET,
  EXPENSE_CATEGORIES,
  daysInMonth,
  financeVerdictLine,
  formatMoney,
  goalAchieved,
  isLastDayOfIsoWeek,
  monthOf,
  normalizeCategory,
  savingsRate,
  weeklyDiscretionaryBudget,
  weeklyFinanceChanges,
} from "./finance";

const wealth = (delta: number) => ({ domain: "WEALTH", delta, bonus: false, activity: false });

test("expense categories and default target", () => {
  assert.deepEqual(EXPENSE_CATEGORIES, [
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
  ]);
  assert.equal(DEFAULT_SAVINGS_TARGET, 0.2);
  assert.equal(normalizeCategory("  Food "), "food");
});

test("savings rate math", () => {
  assert.equal(savingsRate(1000, 750), 0.25);
  assert.equal(savingsRate(1000, 1500), -0.5);
  assert.equal(savingsRate(0, 400), 0, "no income: 0, never a division by zero");
  assert.equal(savingsRate(0, 0), 0);
});

test("savings rate vs target: >= target +2, >= target/2 0, else -1", () => {
  const noBudgets: never[] = [];
  const at = (income: number, expenses: number, target = 0.2) =>
    weeklyFinanceChanges({ income, expenses, categorySpend: {} }, noBudgets, target);
  assert.deepEqual(at(1000, 800).changes, [wealth(2)], "exactly the target");
  assert.equal(at(1000, 800).savingsDelta, 2);
  assert.deepEqual(at(1000, 900).changes, [], "exactly target/2: 0, no change emitted");
  assert.equal(at(1000, 900).savingsDelta, 0);
  assert.deepEqual(at(1000, 950).changes, [wealth(-1)]);
  // Review focus: income 0 with expenses > 0 is a savings rate of 0, -1.0 against any positive target.
  const zero = at(0, 500);
  assert.equal(zero.savingsRate, 0);
  assert.deepEqual(zero.changes, [wealth(-1)]);
  assert.deepEqual(at(0, 500, 0.05).changes, [wealth(-1)]);
});

test("budgets: -0.5 per category over the monthly limit, capped at -2.0; none over +1.0; none set 0", () => {
  const budgets = [
    { category: "food", monthlyLimit: 100 },
    { category: "shopping", monthlyLimit: 100 },
    { category: "entertainment", monthlyLimit: 100 },
    { category: "transport", monthlyLimit: 100 },
    { category: "health", monthlyLimit: 100 },
  ];
  const run = (categorySpend: Record<string, number>, b = budgets) =>
    weeklyFinanceChanges({ income: 1000, expenses: 900, categorySpend }, b, 0.2);
  const one = run({ food: 101 });
  assert.deepEqual(one.overBudget, ["food"]);
  assert.equal(one.budgetDelta, -0.5);
  assert.equal(run({ food: 100 }).budgetDelta, 1, "spend equal to the limit is not over");
  assert.equal(run({ food: 200, shopping: 200, entertainment: 200 }).budgetDelta, -1.5);
  const all = run({ food: 200, shopping: 200, entertainment: 200, transport: 200, health: 200 });
  assert.equal(all.overBudget.length, 5);
  assert.equal(all.budgetDelta, -2, "capped at -2.0");
  assert.deepEqual(all.changes, [wealth(-2)], "savings at target/2 adds nothing");
  assert.equal(run({ housing: 5000 }).budgetDelta, 1, "spend in a category without a budget never counts as over");
  assert.equal(run({ food: 5000 }, []).budgetDelta, 0, "no budget set: no budget change");
});

test("savings and budget changes are separate WEALTH changes, never bonus or activity", () => {
  const r = weeklyFinanceChanges(
    { income: 1000, expenses: 500, categorySpend: { food: 50 } },
    [{ category: "food", monthlyLimit: 100 }],
    0.2,
  );
  assert.deepEqual(r.changes, [wealth(2), wealth(1)]);
});

test("weekly discretionary budget: food + shopping + entertainment limits pro-rated to 7 days of the month", () => {
  const budgets = [
    { category: "food", monthlyLimit: 3100 },
    { category: "shopping", monthlyLimit: 1550 },
    { category: "housing", monthlyLimit: 99999 },
  ];
  assert.equal(weeklyDiscretionaryBudget(budgets, 31), 1050);
  assert.equal(weeklyDiscretionaryBudget([{ category: "housing", monthlyLimit: 5 }], 30), null);
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(daysInMonth("2028-02"), 29);
  assert.equal(daysInMonth("2026-10"), 31);
  assert.equal(monthOf("2026-10-19"), "2026-10");
});

test("the ISO week closes on Sunday", () => {
  assert.equal(isLastDayOfIsoWeek("2026-10-18"), true); // Sunday
  assert.equal(isLastDayOfIsoWeek("2026-10-19"), false); // Monday
  assert.equal(isLastDayOfIsoWeek("2026-10-24"), false); // Saturday
});

test("verdict line for the nightly debrief", () => {
  const money = (n: number) => formatMoney(n, "INR");
  assert.equal(
    financeVerdictLine({ discretionary: 4200, budget: 2500, delta: -2.1 }, money),
    "You logged ₹4,200 in discretionary spending this week against a stated budget of ₹2,500. Your WEALTH score declined 2.1 points. The math is not complicated.",
  );
  assert.match(financeVerdictLine({ discretionary: 10, budget: 20, delta: 3 }, money), /Your WEALTH score rose 3\.0 points\./);
  assert.match(financeVerdictLine({ discretionary: 10, budget: 20, delta: 0 }, money), /Your WEALTH score moved 0\.0 points\./);
  assert.equal(formatMoney(1234.5, "USD"), "$1,234.50");
  assert.equal(formatMoney(12, "ZZZ").includes("12"), true);
});

test("goal achieved when saved >= target", () => {
  assert.equal(goalAchieved(500, 500), true);
  assert.equal(goalAchieved(499.99, 500), false);
  assert.equal(goalAchieved(600, 500), true);
});

test("financeTotals sums typed WEALTH logs and normalizes expense categories; malformed data counts nothing", async () => {
  const { financeTotals } = await import("./finance");
  const t = financeTotals([
    { logType: "income", data: { amount: 1000, category: "Salary" } },
    { logType: "income", data: { amount: 500, category: "x", recurring: true } },
    { logType: "expense", data: { amount: 120, category: " Food" } },
    { logType: "expense", data: { amount: 30, category: "food" } },
    { logType: "expense", data: { amount: 50, category: "Rent" } },
    { logType: "expense", data: { amount: "9" } },
    { logType: "saving", data: { amount: 200 } },
    { logType: "investment", data: { amount: 300 } },
    { logType: "generic", data: {} },
  ]);
  assert.deepEqual(t, { income: 1500, expenses: 200, saving: 200, investment: 300, byCategory: { food: 150, rent: 50 } });
});
