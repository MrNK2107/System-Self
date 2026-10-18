// Smoke: the calls the gym screen makes (lib/game/gym, lib/api outbox) against a running API.
// register + onboard (UTC) -> GET gym (default plan "Starter Strength") -> start session (idempotent replay) ->
// log every set of the session's plan day through flushSetQueue (a replayed key does not double) -> complete:
// points equal the engine's computeGymPoints for that day, BODY rises by that amount, a PR exists for each Big5
// exercise with completed sets -> complete again: 409 already_completed.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/gym.ts
import assert from "node:assert/strict";
import { ApiError, createApiClient } from "../../lib/api/client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { computeGymPoints } from "@workspace/engine";
import { fetchGameState, newClientId } from "../../lib/game/actions";
import { activatePlan, buildPlanRequest, completeGymSession, createPlan, fetchGym, flushSetQueue, newSetKey, startGymSession, type QueuedSet } from "../../lib/game/gym";
import { toDomainScores } from "../../lib/game/mappers";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams } from "../../lib/onboarding/payload";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required");
  process.exit(2);
}

let stored: Session | null = null;
const tokens: TokenStore = {
  get: async () => stored,
  set: async (s) => {
    stored = s;
  },
};
const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl, onSessionExpired: () => {} });
const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });

const memoryStorage = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
};
const outbox = createOutbox({
  storage: memoryStorage(),
  getUserId: async () => stored?.user.id ?? null,
  send: async (item: OutboxItem) => {
    await api.request(item.method, item.path, { body: item.body, idempotencyKey: item.clientId });
  },
});

const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
const disciplineScore = async () => toDomainScores((await fetchGameState(api)).scores).find((d) => d.domain === "DISCIPLINE")!.score;

const bodyScore = async () => toDomainScores((await fetchGameState(api)).scores).find((d) => d.domain === "BODY")!.score;

async function main() {
  const suffix = Date.now().toString(36);
  const user = await auth.signUp({
    email: `smoke-gym-${suffix}@example.com`,
    password: "correct horse battery",
    username: `sg_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Build an unbreakable daily routine",
      weakness: "DISCIPLINE",
      identity: "semi-public",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${suffix}`));
  step("register + onboard", { username: user.username });

  // 1. First read creates the default plan.
  const gym = await fetchGym(api);
  assert.equal(gym.plans.length, 1);
  let plan = gym.plans[0]!;
  assert.equal(plan.name, "Starter Strength");
  assert.equal(gym.activePlanId, plan.id);
  assert.ok(gym.exercises.length >= 8);
  assert.deepEqual(gym.personalRecords, []);
  step("GET /api/gym: default plan", { plan: plan.name, days: plan.days.map((d) => d.weekday), exercises: gym.exercises.length });

  // 2. A plan from the editor for today's weekday (UTC user), made active; the session then scores against it.
  const todayWeekday = (["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const)[new Date().getUTCDay()]!;
  const made = await createPlan(
    api,
    buildPlanRequest(
      {
        name: "Smoke Plan",
        days: [
          {
            weekday: todayWeekday,
            blocks: [
              { exerciseId: "ex_bench", sets: 3, reps: 5 },
              { exerciseId: "ex_plank", sets: 2, reps: 30 },
            ],
          },
        ],
      },
      newClientId("gym-plan"),
    ),
  );
  assert.equal(made.isActive, false);
  const activated = await activatePlan(api, made.id, newClientId("gym-activate"));
  assert.equal(activated.isActive, true);
  assert.equal((await fetchGym(api)).activePlanId, made.id);
  plan = activated;
  step("create plan + set active", { plan: made.name, day: todayWeekday });

  // 2b. Start a session; the same clientId replays to the same session.
  const clientId = newClientId("gym-session");
  const started = await startGymSession(api, outbox, clientId, plan.id);
  assert.ok(started.ok);
  const session = started.value;
  const replay = await startGymSession(api, outbox, clientId, plan.id);
  assert.ok(replay.ok && replay.value.id === session.id);
  step("start session (replay returns the same id)", { id: session.id, localDate: session.localDate });

  // 3. Log every set of the plan day for the session's local date (UTC user), keyed per set.
  const weekday = (["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const)[new Date(`${session.localDate}T12:00:00Z`).getUTCDay()]!;
  const blocks = plan.days.find((d) => d.weekday === weekday)?.blocks ?? [];
  const bigFive = new Set(gym.exercises.filter((e) => e.isBig5).map((e) => e.id));
  const queue: QueuedSet[] = [];
  const counts = new Map<string, number>();
  const add = (exerciseId: string, weight: number, reps: number) => {
    const setIndex = counts.get(exerciseId) ?? 0;
    counts.set(exerciseId, setIndex + 1);
    queue.push({ key: newSetKey(session.id), sessionId: session.id, set: { exerciseId, reps, weight, completed: true, setIndex } });
  };
  for (const b of blocks) for (let i = 0; i < b.sets; i++) add(b.exerciseId, 40 + 10 * i, 5);
  if (!blocks.some((b) => bigFive.has(b.exerciseId))) add("ex_squat", 60, 5); // an unplanned Big5 set still earns a PR
  const flushed = await flushSetQueue(api, queue);
  assert.equal(flushed.remaining.length, 0);
  assert.equal(flushed.dropped.length, 0);
  const again = await flushSetQueue(api, [queue[0]!]); // the same key replays
  assert.equal(again.remaining.length + again.dropped.length, 0);
  step(`log ${queue.length} sets (${weekday} plan day, ${blocks.length} blocks), first key replayed`);

  // 4. Complete: points follow the engine.
  const before = await bodyScore();
  const exById = new Map(gym.exercises.map((e) => [e.id, e]));
  const expected = computeGymPoints(
    queue.map((q) => ({ exerciseId: q.set.exerciseId, completed: q.set.completed })),
    blocks,
    (id) => exById.get(id)?.primaryBodyPart,
  );
  const done = await completeGymSession(api, outbox, session.id, `gym-done-${session.id}`);
  assert.ok(done.ok);
  assert.equal(done.value.points, expected.totalPoints);
  assert.deepEqual(done.value.byBodyPart, expected.byBodyPart);
  const after = await bodyScore();
  assert.equal(Math.round((after - before) * 100) / 100, expected.totalPoints);
  step("complete: points equal engine computeGymPoints, BODY rose by them", { weekday, points: done.value.points, before, after });

  // 5. A PR for every Big5 exercise with completed sets.
  const doneBig5 = new Set(queue.filter((q) => bigFive.has(q.set.exerciseId)).map((q) => q.set.exerciseId));
  assert.ok(doneBig5.size > 0);
  assert.deepEqual(new Set(done.value.newPrs.map((p) => p.exerciseId)), doneBig5);
  const after2 = await fetchGym(api);
  assert.deepEqual(new Set(after2.personalRecords.map((p) => p.exerciseId)), doneBig5);
  assert.equal(after2.recentSessions[0]!.points, expected.totalPoints);
  step("PRs for Big5 exercises with sets", { newPrs: done.value.newPrs.map((p) => `${p.name} ${p.weight}x${p.reps}=${p.value}`) });

  // 6. Completing again is refused.
  await assert.rejects(
    () => completeGymSession(api, outbox, session.id, newClientId("gym-done")),
    (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === "already_completed",
  );
  step("complete again: 409 already_completed");
  console.log("gym smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
