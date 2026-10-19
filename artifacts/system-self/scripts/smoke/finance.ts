// Smoke: the finance module against a running API.
// Register + onboard -> set the savings target and budgets -> log income and expenses -> the summary shows the savings
// rate and spend per category against its budget -> create a goal -> contribute -> a scored WEALTH saving log exists
// -> contributing past the target achieves the goal (goal_achieved notice) -> a closed goal refuses contributions.
// Registers 1 account.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/finance.ts
import assert from "node:assert/strict";
import { createApiClient, ApiError } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import {
  budgetBar,
  contributeToGoal,
  createGoal,
  fetchFinanceSummary,
  money,
  percent,
  putBudgets,
  putNetWorth,
  savingsVerdict,
  updateFinanceSettings,
} from "../../lib/finance/finance";
import { fetchLogs, newClientId } from "../../lib/game/actions";
import { parseNotices } from "../../lib/game/notices";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams } from "../../lib/onboarding/payload";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required");
  process.exit(2);
}

const synced = { flushBeforeMutation: async () => true };
const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

async function main() {
  const prefix = `sf${Date.now().toString(36).slice(-6)}`;
  let stored: Session | null = null;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl: baseUrl!, onSessionExpired: () => {} });
  const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });
  await auth.signUp({
    email: `smoke-finance-${prefix}@example.com`,
    password: "correct horse battery",
    username: `${prefix}_f`,
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 4, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Build a disciplined life",
      weakness: "WEALTH",
      identity: "anonymous",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${prefix}`));
  step("register + onboard", { prefix });

  const fresh = await fetchFinanceSummary(api);
  assert.equal(fresh.currency, "INR");
  assert.equal(fresh.target, 0.2);
  assert.equal(fresh.savingsRate, 0);
  step("a fresh summary: INR, 20% target, nothing logged", { month: fresh.month });

  assert.ok((await updateFinanceSettings(api, synced, { savingsTarget: 0.25 }, newClientId("fs"))).ok);
  const budgets = await putBudgets(
    api,
    synced,
    [
      { category: "food", monthlyLimit: 200 },
      { category: "shopping", monthlyLimit: 500 },
    ],
    newClientId("fb"),
  );
  assert.ok(budgets.ok);
  assert.deepEqual(budgets.value.items.map((b) => b.category), ["food", "shopping"]);
  step("savings target 25%, budgets food 200 / shopping 500");

  const log = (logType: string, data: Record<string, unknown>) =>
    api.request("POST", "/api/logs", { body: { clientId: newClientId("fl"), domain: "WEALTH", logType, data } });
  await log("income", { amount: 2000, category: "salary" });
  await log("expense", { amount: 250, category: "food" });
  await log("expense", { amount: 100, category: "shopping" });
  step("logged income 2000, expenses food 250 and shopping 100");

  const s = await fetchFinanceSummary(api);
  assert.equal(s.income, 2000);
  assert.equal(s.expenses, 350);
  assert.equal(s.savingsRate, 0.825);
  assert.equal(s.target, 0.25);
  const food = s.byCategory.find((c) => c.category === "food")!;
  const shopping = s.byCategory.find((c) => c.category === "shopping")!;
  assert.deepEqual([food.spent, food.limit, budgetBar(food.spent, food.limit)!.over], [250, 200, true]);
  assert.deepEqual([shopping.spent, shopping.limit, budgetBar(shopping.spent, shopping.limit)!.over], [100, 500, false]);
  step("summary: savings rate and category spend vs budget", {
    rate: percent(s.savingsRate),
    verdict: savingsVerdict(s.savingsRate, s.target).line,
    food: `${money(food.spent, s.currency)} of ${money(food.limit!, s.currency)}`,
  });

  const created = await createGoal(api, synced, { title: "Emergency fund", targetAmount: 500, deadline: null }, newClientId("fg"));
  assert.ok(created.ok);
  const goal = created.value.goal;
  assert.equal(goal.status, "active");
  step("goal created", { id: goal.id });

  const c1 = await contributeToGoal(api, synced, goal.id, 300, newClientId("fc"));
  assert.ok(c1.ok);
  assert.equal(c1.value.goal.savedAmount, 300);
  assert.equal(c1.value.log.logType, "saving");
  assert.deepEqual(c1.value.results.map((r) => [r.domain, r.actualDelta]), [["WEALTH", 0.5]]);
  const logs = await fetchLogs(api, 10);
  assert.ok(logs.some((l) => l.id === c1.value.log.id && l.domain === "WEALTH" && l.logType === "saving"));
  step("contribute 300 -> a scored WEALTH saving log is on file", { logId: c1.value.log.id });

  const c2 = await contributeToGoal(api, synced, goal.id, 250, newClientId("fc"));
  assert.ok(c2.ok);
  assert.equal(c2.value.goal.status, "achieved");
  const notices = parseNotices(c2.value.notices).notices;
  assert.ok(notices.some((n) => n.kind === "goal_achieved"));
  step("contribute past the target -> achieved, goal_achieved notice");

  try {
    await contributeToGoal(api, synced, goal.id, 1, newClientId("fc"));
    assert.fail("expected 409 goal_not_active");
  } catch (e) {
    assert.ok(e instanceof ApiError && e.status === 409 && e.code === "goal_not_active");
  }
  step("an achieved goal refuses contributions (409 goal_not_active)");

  assert.ok((await putNetWorth(api, synced, s.month, 12000, newClientId("fn"))).ok);
  const after = await fetchFinanceSummary(api);
  assert.deepEqual(after.netWorth.at(-1), { month: s.month, amount: 12000 });
  assert.equal(after.goals[0]!.savedAmount, 550);
  step("net worth recorded for the month");

  console.log("smoke: finance OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
