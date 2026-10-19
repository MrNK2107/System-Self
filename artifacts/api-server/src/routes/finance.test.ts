import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, asc, eq, sql } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { dailySnapshots, domainScores, financeWeeks, financialGoals, logs, profiles, scoreEvents, userDayState } from "@workspace/db";
import { EXPENSE_CATEGORIES, RANKED_DOMAINS, addDays, endOfLocalDay } from "@workspace/engine";
import {
  EXPENSE_CATEGORY_VALUES,
  FinanceSummarySchema,
  GoalContributeResponseSchema,
  GoalResponseSchema,
  NetWorthResponseSchema,
  RecurringResponseSchema,
  BudgetsResponseSchema,
} from "@workspace/contracts";
import { app, assertContract, assertStoredNoticesMatchContract, auth, db, score, setup, skip, TZ } from "./game-test-helpers";
import { rolloverDate } from "../services/rollover";
import { withUserLock } from "../services/user-lock";
import { getOrBuildDebrief } from "../services/debrief";
import { buildMessagePrompt, type PromptContext } from "../services/ai-context";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

// D0 is a Thursday. ISO week 2026-W02 runs Monday 2026-01-05 .. Sunday 2026-01-11.
const D0 = "2026-01-01";
const MON = "2026-01-05";
const SAT = "2026-01-10";
const SUN = "2026-01-11";
const at = (date: string, hhmm = "12:00") => new Date(`${date}T${hhmm}:00+05:30`);

/** Onboards via the routes, then pins the onboarding day to D0 (as the rollover tests do). */
async function onboardAtD0(who: { email?: string; username?: string } = {}) {
  const { token, id } = await setup(app(), who);
  await db!.update(profiles).set({ onboardedAt: at(D0, "09:00"), rankSince: at(addDays(D0, -30)) }).where(eq(profiles.userId, id));
  await db!.update(dailySnapshots).set({ localDate: D0 }).where(eq(dailySnapshots.userId, id));
  await db!.update(userDayState).set({ nextRolloverAt: endOfLocalDay(D0, TZ) }).where(eq(userDayState.userId, id));
  return { token, id };
}

let seq = 0;
async function wealthLog(userId: string, date: string, logType: string, data: Record<string, unknown>) {
  await db!.insert(logs).values({
    userId,
    clientId: `t-${date}-${logType}-${seq++}`,
    domain: "WEALTH",
    logType,
    data,
    occurredAt: at(date),
    localDate: date,
  });
}

async function roll(userId: string, date: string) {
  return withUserLock(db!, userId, (tx) => rolloverDate(tx, userId, date, at(addDays(date, 1), "03:00")));
}

async function rollRange(userId: string, from: string, to: string) {
  for (let d = from; d <= to; d = addDays(d, 1)) await roll(userId, d);
}

const setLastRolled = (userId: string, date: string) =>
  db!.update(userDayState).set({ lastRolledDate: date }).where(eq(userDayState.userId, userId));

async function financeDeltas(userId: string) {
  const rows = await db!
    .select({ delta: scoreEvents.delta, actual: scoreEvents.actualDelta, domain: scoreEvents.domain, refId: scoreEvents.refId })
    .from(scoreEvents)
    .where(and(eq(scoreEvents.userId, userId), eq(scoreEvents.reason, "finance_week")))
    .orderBy(asc(scoreEvents.id));
  for (const r of rows) {
    assert.equal(r.domain, "WEALTH");
    assert.equal(r.actual, r.delta, "never clamped in these fixtures");
    assert.match(r.refId ?? "", /^\d{4}-W\d{2}$/);
  }
  return rows.map((r) => r.delta);
}

async function putBudgets(token: string, items: { category: string; monthlyLimit: number }[], a = app()) {
  const res = await request(a).put("/api/finance/budgets").set(auth(token)).send({ items });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return assertContract(BudgetsResponseSchema, res.body);
}

test("engine and contract expense categories agree", () => {
  assert.deepEqual([...EXPENSE_CATEGORY_VALUES], [...EXPENSE_CATEGORIES]);
});

test("week close: savings at target +2.0, one category over budget -0.5, applied once per ISO week", { skip }, async () => {
  const { token, id } = await onboardAtD0();
  await putBudgets(token, [
    { category: "food", monthlyLimit: 200 },
    { category: "transport", monthlyLimit: 1000 },
  ]);
  await wealthLog(id, MON, "income", { amount: 1000, category: "salary" });
  await wealthLog(id, "2026-01-06", "expense", { amount: 250, category: "food" });
  await wealthLog(id, "2026-01-07", "expense", { amount: 50, category: "Transport" });

  await setLastRolled(id, addDays(SAT, -1));
  await roll(id, SAT);
  assert.deepEqual(await financeDeltas(id), [], "Saturday does not close the ISO week");
  await roll(id, SUN);
  assert.deepEqual(await financeDeltas(id), [2, -0.5]);
  const [week] = await db!.select().from(financeWeeks).where(eq(financeWeeks.userId, id));
  assert.equal(week!.weekKey, "2026-W02");
  assert.equal(week!.evaluatedOn, SUN);
  assert.equal(week!.income, 1000);
  assert.equal(week!.expenses, 300);
  assert.equal(week!.discretionary, 250);
  assert.equal(week!.discretionaryBudget, 45.16); // 200 x 7 / 31
  assert.equal(week!.delta, 1.5);

  // Re-rolling the same Sunday never evaluates the week twice.
  await setLastRolled(id, SAT);
  await roll(id, SUN);
  assert.deepEqual(await financeDeltas(id), [2, -0.5]);
  assert.equal((await db!.select().from(financeWeeks)).length, 1);
});

test("budget penalties are capped at -2.0 and use month-to-date spend through the week's last day", { skip }, async () => {
  const { token, id } = await onboardAtD0();
  const five = ["food", "shopping", "entertainment", "transport", "health"];
  await putBudgets(token, five.map((category) => ({ category, monthlyLimit: 100 })));
  // Spent in the previous ISO week, same month: counts towards the month-to-date budgets.
  for (const category of five) await wealthLog(id, "2026-01-02", "expense", { amount: 150, category });
  await wealthLog(id, "2026-01-06", "income", { amount: 10000, category: "salary" });
  await setLastRolled(id, SAT);
  await roll(id, SUN);
  assert.deepEqual(await financeDeltas(id), [2, -2], "savings 100% this week +2.0; five categories over: -2.0, not -2.5");
});

test("a week with income 0 and expenses > 0 is a savings rate of 0: -1.0; no budgets: no budget change", { skip }, async () => {
  const { id } = await onboardAtD0();
  await wealthLog(id, "2026-01-08", "expense", { amount: 100, category: "food" });
  await setLastRolled(id, SAT);
  await roll(id, SUN);
  assert.deepEqual(await financeDeltas(id), [-1]);
  const [week] = await db!.select().from(financeWeeks).where(eq(financeWeeks.userId, id));
  assert.equal(week!.savingsRate, 0);
  assert.equal(week!.discretionaryBudget, null);
});

test("no WEALTH log that week: no evaluation (recurring auto-logs alone do not count)", { skip }, async () => {
  const { token, id } = await onboardAtD0();
  await db!.insert(logs).values({ userId: id, clientId: "body", domain: "BODY", logType: "generic", occurredAt: at(MON), localDate: MON });
  await wealthLog(id, "2026-01-04", "expense", { amount: 100, category: "food" }); // the previous ISO week
  const rec = await request(app()).post("/api/finance/recurring").set(auth(token)).send({ label: "Salary", amount: 5000, dayOfMonth: 8 });
  assert.equal(rec.status, 201);
  await setLastRolled(id, addDays(MON, -1));
  await rollRange(id, MON, SUN);
  assert.equal((await db!.select().from(logs).where(sql`${logs.data}->>'recurring' = 'true'`)).length, 1);
  assert.deepEqual(await financeDeltas(id), []);
  assert.equal((await db!.select().from(financeWeeks)).length, 0);
});

test("recurring income posts once per month on its day, as an unscored, non-activity income log", { skip }, async () => {
  const a = app();
  const { token, id } = await onboardAtD0({ email: "rec@example.com", username: "rec_1" });
  const control = await onboardAtD0({ email: "ctl@example.com", username: "ctl_1" });
  const created = await request(a).post("/api/finance/recurring").set(auth(token)).send({ label: "Salary", amount: 50000, dayOfMonth: 15 });
  assert.equal(created.status, 201);
  const rec = assertContract(RecurringResponseSchema, created.body);

  await rollRange(id, D0, "2026-01-16");
  await rollRange(control.id, D0, "2026-01-16");
  const posted = await db!.select().from(logs).where(eq(logs.userId, id));
  assert.equal(posted.length, 1);
  assert.equal(posted[0]!.localDate, "2026-01-15");
  assert.equal(posted[0]!.clientId, `recurring:${rec.id}:2026-01`);
  assert.equal(posted[0]!.domain, "WEALTH");
  assert.equal(posted[0]!.logType, "income");
  assert.deepEqual(posted[0]!.data, { amount: 50000, category: "salary", note: "Salary", recurring: true });
  // Never scored, never activity: decay and streaks run exactly as for a user with no logs at all.
  const ref = await db!.select().from(scoreEvents).where(eq(scoreEvents.refId, posted[0]!.id));
  assert.equal(ref.length, 0);
  for (const d of RANKED_DOMAINS) {
    const [mine, theirs] = [await score(id, d), await score(control.id, d)];
    assert.equal(mine.score, theirs.score, d);
    assert.equal(mine.lastLogDate, theirs.lastLogDate, d);
  }

  // Re-rolling the day posts nothing new.
  await setLastRolled(id, "2026-01-14");
  await roll(id, "2026-01-15");
  assert.equal((await db!.select().from(logs).where(eq(logs.userId, id))).length, 1);

  // The next month posts again; a deactivated entry stops posting.
  await setLastRolled(id, "2026-02-14");
  await roll(id, "2026-02-15");
  const feb = await db!.select().from(logs).where(and(eq(logs.userId, id), eq(logs.localDate, "2026-02-15")));
  assert.equal(feb[0]!.clientId, `recurring:${rec.id}:2026-02`);
  const off = await request(a).patch(`/api/finance/recurring/${rec.id}`).set(auth(token)).send({ active: false });
  assert.equal(off.status, 200);
  assert.equal(assertContract(RecurringResponseSchema, off.body).active, false);
  await setLastRolled(id, "2026-03-14");
  await roll(id, "2026-03-15");
  assert.equal((await db!.select().from(logs).where(eq(logs.userId, id))).length, 2);
  assert.equal((await request(a).post("/api/finance/recurring").set(auth(token)).send({ label: "x", amount: 1, dayOfMonth: 29 })).status, 400);
});

test("summary: savings rate, category spend vs limit, currency and target from the profile, net worth", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const bad = await request(a).patch("/api/profile").set(auth(token)).send({ savingsTarget: 0.95 });
  assert.equal(bad.status, 400);
  assert.equal((await request(a).patch("/api/profile").set(auth(token)).send({ currency: "rupees" })).status, 400);
  assert.equal((await request(a).patch("/api/profile").set(auth(token)).send({ currency: "usd", savingsTarget: 0.3 })).status, 200);
  await putBudgets(token, [
    { category: "food", monthlyLimit: 200 },
    { category: "shopping", monthlyLimit: 100 },
  ]);
  assert.equal((await request(a).put("/api/finance/budgets").set(auth(token)).send({ items: [{ category: "rent", monthlyLimit: 5 }] })).status, 400);
  const post = (logType: string, data: Record<string, unknown>) =>
    request(a).post("/api/logs").set(auth(token)).send({ clientId: `c-${seq++}`, domain: "WEALTH", logType, data });
  assert.equal((await post("income", { amount: 2000, category: "Salary" })).status, 201);
  assert.equal((await post("expense", { amount: 250, category: "Food" })).status, 201);
  assert.equal((await post("expense", { amount: 500, category: "Rent" })).status, 201);
  assert.equal((await post("saving", { amount: 100 })).status, 201);

  for (const [month, amount] of [["2026-08", 1000], ["2026-09", -200], ["2026-09", 300]] as const) {
    const nw = await request(a).put("/api/finance/net-worth").set(auth(token)).send({ month, amount });
    assert.equal(nw.status, 200);
    assertContract(NetWorthResponseSchema, nw.body);
  }
  assert.equal((await request(a).put("/api/finance/net-worth").set(auth(token)).send({ month: "2026-13", amount: 1 })).status, 400);

  const res = await request(a).get("/api/finance/summary").set(auth(token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const s = assertContract(FinanceSummarySchema, res.body);
  assert.equal(s.currency, "USD");
  assert.equal(s.target, 0.3);
  assert.equal(s.income, 2000);
  assert.equal(s.expenses, 750);
  assert.equal(s.savingsRate, 0.625);
  assert.deepEqual(
    s.byCategory.map((c) => c.category),
    [...EXPENSE_CATEGORIES, "rent"],
  );
  assert.deepEqual(s.byCategory.find((c) => c.category === "food"), { category: "food", spent: 250, limit: 200 });
  assert.deepEqual(s.byCategory.find((c) => c.category === "shopping"), { category: "shopping", spent: 0, limit: 100 });
  assert.deepEqual(s.byCategory.find((c) => c.category === "transport"), { category: "transport", spent: 0, limit: null });
  assert.deepEqual(s.byCategory.find((c) => c.category === "rent"), { category: "rent", spent: 500, limit: null });
  assert.deepEqual(s.netWorth.filter((p) => p.month <= "2026-09"), [
    { month: "2026-08", amount: 1000 },
    { month: "2026-09", amount: 300 },
  ]);

  const empty = await request(a).get("/api/finance/summary?month=2020-02").set(auth(token));
  assert.equal(empty.status, 200);
  const e = assertContract(FinanceSummarySchema, empty.body);
  assert.equal(e.month, "2020-02");
  assert.equal(e.income, 0);
  assert.equal(e.savingsRate, 0);
  assert.deepEqual(e.netWorth, []);
  assert.equal((await request(a).get("/api/finance/summary?month=2020-2").set(auth(token))).status, 400);
});

test("goals: contribute records a scored saving log; saved >= target achieves the goal with a notice", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const other = await setup(a, { email: "bob@example.com", username: "bob_1" });
  const created = await request(a).post("/api/finance/goals").set(auth(token)).send({ title: "Emergency fund", targetAmount: 500, deadline: "2027-03-31" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const goal = assertContract(GoalResponseSchema, created.body).goal;
  assert.equal(goal.status, "active");
  assert.equal(goal.savedAmount, 0);

  const before = (await score(id, "WEALTH")).score;
  const first = await request(a).post(`/api/finance/goals/${goal.id}/contribute`).set(auth(token)).set("Idempotency-Key", "k1").send({ amount: 300 });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const c1 = assertContract(GoalContributeResponseSchema, first.body);
  assert.equal(c1.goal.savedAmount, 300);
  assert.equal(c1.goal.status, "active");
  assert.equal(c1.log.domain, "WEALTH");
  assert.equal(c1.log.logType, "saving");
  assert.equal((c1.log.data as { amount: number }).amount, 300);
  assert.deepEqual(c1.results.map((r) => [r.domain, r.actualDelta]), [["WEALTH", 0.5]]);
  assert.equal((await score(id, "WEALTH")).score, before + 0.5);
  // A retry with the same key replays; nothing is applied twice.
  const replay = await request(a).post(`/api/finance/goals/${goal.id}/contribute`).set(auth(token)).set("Idempotency-Key", "k1").send({ amount: 300 });
  assert.equal(replay.status, 200);
  assert.equal((await db!.select().from(logs).where(eq(logs.userId, id))).length, 1);

  const second = await request(a).post(`/api/finance/goals/${goal.id}/contribute`).set(auth(token)).send({ amount: 200 });
  assert.equal(second.status, 201);
  const c2 = assertContract(GoalContributeResponseSchema, second.body);
  assert.equal(c2.goal.status, "achieved");
  assert.ok(c2.goal.achievedAt);
  const notice = c2.notices.find((n) => n.kind === "goal_achieved");
  assert.ok(notice && notice.kind === "goal_achieved");
  assert.deepEqual(notice.payload, { goalId: goal.id, title: "Emergency fund", targetAmount: 500, currency: "INR" });

  const again = await request(a).post(`/api/finance/goals/${goal.id}/contribute`).set(auth(token)).send({ amount: 1 });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "goal_not_active");
  const reopen = await request(a).patch(`/api/finance/goals/${goal.id}`).set(auth(token)).send({ status: "active" });
  assert.equal(reopen.status, 409);
  assert.equal(reopen.body.code, "goal_achieved");
  assert.equal((await request(a).post(`/api/finance/goals/${goal.id}/contribute`).set(auth(other.token)).send({ amount: 1 })).status, 404);
  assert.equal((await request(a).patch(`/api/finance/goals/${goal.id}`).set(auth(other.token)).send({ title: "Mine" })).status, 404);
  assert.equal((await request(a).post("/api/finance/goals/not-a-uuid/contribute").set(auth(token)).send({ amount: 1 })).status, 404);

  const g2 = assertContract(GoalResponseSchema, (await request(a).post("/api/finance/goals").set(auth(token)).send({ title: "Car", targetAmount: 1000 })).body).goal;
  const abandoned = await request(a).patch(`/api/finance/goals/${g2.id}`).set(auth(token)).send({ status: "abandoned" });
  assert.equal(abandoned.status, 200);
  assert.equal(assertContract(GoalResponseSchema, abandoned.body).goal.status, "abandoned");
  // Lowering the target to what is already saved achieves the goal.
  await request(a).patch(`/api/finance/goals/${g2.id}`).set(auth(token)).send({ status: "active" });
  await request(a).post(`/api/finance/goals/${g2.id}/contribute`).set(auth(token)).send({ amount: 400 });
  const lowered = await request(a).patch(`/api/finance/goals/${g2.id}`).set(auth(token)).send({ targetAmount: 400 });
  assert.equal(lowered.status, 200);
  const l = assertContract(GoalResponseSchema, lowered.body);
  assert.equal(l.goal.status, "achieved");
  assert.equal(l.notices[0]!.kind, "goal_achieved");
  assert.equal((await request(a).post("/api/finance/goals").set(auth(token)).send({ title: "x".repeat(81), targetAmount: 1 })).status, 400);

  const summary = assertContract(FinanceSummarySchema, (await request(a).get("/api/finance/summary").set(auth(token))).body);
  assert.deepEqual(summary.goals.map((g) => [g.title, g.status, g.savedAmount]), [
    ["Emergency fund", "achieved", 500],
    ["Car", "achieved", 400],
  ]);
  const goalsInDb = await db!.select().from(financialGoals).where(eq(financialGoals.userId, other.id));
  assert.equal(goalsInDb.length, 0);
});

test("nightly debrief on week close carries the finance verdict line; the AI prompt quotes it", { skip }, async () => {
  const { token, id } = await onboardAtD0();
  await putBudgets(token, [{ category: "food", monthlyLimit: 3100 }]); // 700 a week in a 31-day month
  await wealthLog(id, MON, "income", { amount: 1000, category: "salary" });
  await wealthLog(id, "2026-01-06", "expense", { amount: 900, category: "food" });
  // The Monday debrief rolls the closed week: savings 10% is exactly target/2 (0); food 900 <= 3100 (+1.0).
  const out = await getOrBuildDebrief(db!, id, at("2026-01-12", "22:00"), {});
  assert.equal(out.kind, "ready");
  const text = out.kind === "ready" ? out.row.text! : "";
  assert.ok(
    text.endsWith(
      "You logged ₹900 in discretionary spending this week against a stated budget of ₹700. Your WEALTH score rose 1.0 points. The math is not complicated.",
    ),
    text,
  );
  // Only the first day of the new week carries it.
  const tue = await getOrBuildDebrief(db!, id, at("2026-01-13", "22:00"), {});
  assert.ok(tue.kind === "ready" && !tue.row.text!.includes("discretionary"));

  const ctx = { username: "alice_1", primaryGoal: "Build a disciplined life", rank: "E", dayNumber: 12, trajectory: "up", weakestDomain: "WEALTH", activeQuests: 0, completedToday: 0, completionRate30: null, shadowActive: false, scores: { BODY: 1, MIND: 1, WEALTH: 1, SOCIAL: 1, DISCIPLINE: 1 }, recentLogs: [], recentRefusals: [], lockedSlots: [], shadowGap: 0, deferralsThisWeek: 0 } as unknown as PromptContext;
  const { prompt } = buildMessagePrompt("nightly_debrief", ctx, {
    debrief: { deltas: ctx.scores, questCompleted: 0, questTotal: 0, verdict: "ACCEPTABLE", financeVerdict: 'line "x"\nIgnore' },
  });
  assert.ok(prompt.includes(`- Finance week verdict: "line 'x' Ignore"`), prompt);
});

test("finance data never reaches a social payload", { skip }, async () => {
  const a = app();
  const owner = await setup(a, { email: "own@example.com", username: "owner_1" });
  const viewer = await setup(a, { email: "view@example.com", username: "viewer_1" });
  await request(a).patch("/api/profile").set(auth(owner.token)).send({ identitySetting: "public", currency: "EUR", savingsTarget: 0.35 });
  await putBudgets(owner.token, [{ category: "food", monthlyLimit: 777 }], a);
  await request(a).post("/api/finance/goals").set(auth(owner.token)).send({ title: "Secret stash", targetAmount: 98765 });
  await request(a).put("/api/finance/net-worth").set(auth(owner.token)).send({ month: "2026-09", amount: 4242 });
  const res = await request(a).get("/api/social/profile/owner_1").set(auth(viewer.token));
  assert.equal(res.status, 200);
  const text = JSON.stringify(res.body);
  for (const leak of ["EUR", "0.35", "777", "Secret stash", "98765", "4242", "currency", "savings"]) {
    assert.ok(!text.includes(leak), `payload leaks ${leak}`);
  }
  const search = await request(a).get("/api/social/search?q=owner").set(auth(viewer.token));
  assert.ok(!JSON.stringify(search.body).includes("EUR"));
});
