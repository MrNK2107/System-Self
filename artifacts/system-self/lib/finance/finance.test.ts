import { test } from "node:test";
import assert from "node:assert/strict";
import type { FinanceSummary } from "@workspace/contracts";
import { ApiError, type ApiClient } from "../api/client";
import {
  budgetBar,
  budgetDraft,
  budgetOverview,
  budgetItemsFromDraft,
  categoryLabel,
  contributeToGoal,
  describeFinanceError,
  goalProgress,
  money,
  netWorthRows,
  parseAmount,
  parseDeadline,
  parseSavingsTarget,
  parseSignedAmount,
  percent,
  putBudgets,
  savingsStatus,
  savingsVerdict,
} from "./finance";

const synced = { flushBeforeMutation: async () => true };
const stuck = { flushBeforeMutation: async () => false };

function fakeApi(response: unknown) {
  const calls: { method: string; path: string; opts: any }[] = [];
  const api = {
    async request(method: string, path: string, opts: any = {}) {
      calls.push({ method, path, opts });
      return opts.schema ? opts.schema.parse(response) : response;
    },
  } as unknown as ApiClient;
  return { api, calls };
}

test("money and percentages", () => {
  assert.equal(money(4200, "INR"), "₹4,200");
  assert.equal(money(-12.5, "USD"), "-$12.50");
  assert.equal(percent(0.625), "62.5%");
  assert.equal(percent(0.2), "20%");
  assert.equal(percent(-0.5), "-50%");
  assert.equal(categoryLabel("subscriptions"), "Subscriptions");
});

test("savings verdict against the target: at target, half way, below", () => {
  assert.deepEqual(savingsVerdict(0.25, 0.2), { tone: "good", line: "Savings rate 25% against a 20% target. Held." });
  assert.deepEqual(savingsVerdict(0.12, 0.2), { tone: "warn", line: "Savings rate 12% against a 20% target. Short." });
  assert.deepEqual(savingsVerdict(0, 0.2), { tone: "bad", line: "Savings rate 0% against a 20% target. Failing." });
});

test("budget bars: fraction of the limit, capped at 1, over when spent > limit; no limit is no bar", () => {
  assert.deepEqual(budgetBar(50, 200), { fraction: 0.25, over: false });
  assert.deepEqual(budgetBar(200, 200), { fraction: 1, over: false });
  assert.deepEqual(budgetBar(300, 200), { fraction: 1, over: true });
  assert.equal(budgetBar(300, null), null);
});

test("goal progress and net worth rows with month-over-month change", () => {
  assert.equal(goalProgress({ savedAmount: 250, targetAmount: 1000 }), 0.25);
  assert.equal(goalProgress({ savedAmount: 2000, targetAmount: 1000 }), 1);
  assert.deepEqual(
    netWorthRows([
      { month: "2026-08", amount: 1000 },
      { month: "2026-09", amount: 700 },
    ]),
    [
      { month: "2026-09", amount: 700, change: -300 },
      { month: "2026-08", amount: 1000, change: null },
    ],
  );
});

test("form parsing: amounts and the savings target", () => {
  assert.equal(parseAmount("1,500.5"), 1500.5);
  assert.equal(parseAmount(" 200 "), 200);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseSignedAmount("-12,000"), -12000);
  assert.equal(parseSignedAmount("0"), 0);
  assert.equal(parseSignedAmount("--1"), null);
  assert.equal(parseDeadline(""), null);
  assert.equal(parseDeadline("2027-03-31"), "2027-03-31");
  assert.equal(parseDeadline("2027-02-30"), undefined);
  assert.equal(parseDeadline("31/03/2027"), undefined);
  assert.equal(parseSavingsTarget("25"), 0.25);
  assert.equal(parseSavingsTarget("95"), null);
  assert.equal(parseSavingsTarget("-1"), null);
  // The server floor is 5%: below it is refused here, before a 400.
  assert.equal(parseSavingsTarget("0"), null);
  assert.equal(parseSavingsTarget("4.9"), null);
  assert.equal(parseSavingsTarget("5"), 0.05);
});

test("budget draft round-trips the summary; blank fields drop the budget", () => {
  const summary = {
    byCategory: [
      { category: "food", spent: 10, limit: 200 },
      { category: "transport", spent: 0, limit: null },
      { category: "rent", spent: 5, limit: null },
    ],
  } as Pick<FinanceSummary, "byCategory">;
  const draft = budgetDraft(summary);
  assert.equal(draft.food, "200");
  assert.equal(draft.transport, "");
  assert.equal("rent" in draft, false, "only the default categories can carry a budget");
  assert.deepEqual(budgetItemsFromDraft({ ...draft, transport: "1,000", shopping: "x" }), {
    ok: false,
    invalid: ["shopping"],
  });
  assert.deepEqual(budgetItemsFromDraft({ ...draft, transport: "1,000" }), {
    ok: true,
    items: [
      { category: "food", monthlyLimit: 200 },
      { category: "transport", monthlyLimit: 1000 },
    ],
  });
});

test("mutations wait for the outbox and send an idempotency key", async () => {
  const { api, calls } = fakeApi({ items: [] });
  assert.deepEqual(await putBudgets(api, stuck, [], "c1"), { ok: false, reason: "sync_pending" });
  assert.equal(calls.length, 0);
  const r = await putBudgets(api, synced, [{ category: "food", monthlyLimit: 5 }], "c2");
  assert.equal(r.ok, true);
  assert.equal(calls[0]!.method, "PUT");
  assert.equal(calls[0]!.path, "/api/finance/budgets");
  assert.equal(calls[0]!.opts.idempotencyKey, "c2");
  assert.deepEqual(calls[0]!.opts.body, { items: [{ category: "food", monthlyLimit: 5 }], clientId: "c2" });
});

test("contribute tolerates notice kinds this build does not know", async () => {
  const goal = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Fund",
    targetAmount: 100,
    savedAmount: 100,
    deadline: null,
    status: "achieved",
    achievedAt: "2026-10-19T00:00:00.000Z",
    createdAt: "2026-10-19T00:00:00.000Z",
  };
  const log = {
    id: "00000000-0000-4000-8000-000000000002",
    clientId: "goal:x",
    domain: "WEALTH",
    logType: "saving",
    data: { amount: 100 },
    freeText: null,
    forbidden: false,
    occurredAt: "2026-10-19T00:00:00.000Z",
    localDate: "2026-10-19",
    isRetroactive: false,
    createdAt: "2026-10-19T00:00:00.000Z",
  };
  const { api, calls } = fakeApi({ goal, log, results: [], notices: [{ kind: "from_the_future" }] });
  const r = await contributeToGoal(api, synced, goal.id, 100, "c3");
  assert.ok(r.ok);
  assert.equal(r.value.goal.status, "achieved");
  assert.equal(calls[0]!.path, `/api/finance/goals/${goal.id}/contribute`);
});

test("errors read in the SYSTEM voice", () => {
  assert.equal(describeFinanceError(new ApiError({ kind: "http", status: 409, code: "goal_not_active", message: "x" })), "That goal is closed. Contributions are not accepted.");
  assert.equal(describeFinanceError(new Error("x")), "The request failed. Retry.");
});

test("savings status: no verdict without data; no rate without income; a rated month keeps the verdict", () => {
  assert.deepEqual(savingsStatus({ income: 0, expenses: 0, savingsRate: 0, target: 0.2 }), { kind: "empty" });
  const noIncome = savingsStatus({ income: 0, expenses: 120, savingsRate: 0, target: 0.2 });
  assert.equal(noIncome.kind, "no_income");
  assert.ok(!("tone" in noIncome));
  assert.deepEqual(savingsStatus({ income: 1000, expenses: 1000, savingsRate: 0, target: 0.2 }), {
    kind: "rated",
    tone: "bad",
    line: "Savings rate 0% against a 20% target. Failing.",
  });
  assert.deepEqual(savingsStatus({ income: 1000, expenses: 750, savingsRate: 0.25, target: 0.2 }), {
    kind: "rated",
    tone: "good",
    line: "Savings rate 25% against a 20% target. Held.",
  });
});

test("budget overview: counts limited categories and lists the ones over, with the excess", () => {
  assert.deepEqual(
    budgetOverview([
      { category: "food", spent: 250.5, limit: 200 },
      { category: "rent", spent: 900, limit: 1000 },
      { category: "fun", spent: 40, limit: null },
    ]),
    { limited: 2, over: [{ category: "food", by: 50.5 }] },
  );
  assert.deepEqual(budgetOverview([{ category: "food", spent: 10, limit: null }]), { limited: 0, over: [] });
});
