import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, type ApiClient } from "../api/client";
import {
  activatePlan,
  applyFlushResult,
  buildPlanRequest,
  completeGymSession,
  createPlan,
  clearActive,
  emptyActive,
  fetchGym,
  flushSetQueue,
  loadActive,
  saveActive,
  newSetKey,
  planBlocksFor,
  startGymSession,
  toGymView,
  toWorkoutPlan,
  createPlanClientIds,
  validatePlanDraft,
  weekdayOf,
  type PlanDraft,
  type QueuedSet,
} from "./gym";

const EX = new Set(["ex_squat", "ex_bench", "ex_plank"]);
const net = () => new ApiError({ kind: "network", message: "offline" });
const http = (status: number, code?: string) => new ApiError({ kind: "http", status, code, message: String(status) });

interface Call {
  method: string;
  path: string;
  body?: unknown;
  key?: string;
}
function fakeApi(handler: (c: Call) => unknown): { api: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const api: ApiClient = {
    async request(method, path, opts) {
      const call = { method, path, body: opts?.body, key: opts?.idempotencyKey };
      calls.push(call);
      const out = handler(call);
      return (opts?.schema ? opts.schema.parse(out) : out) as never;
    },
  };
  return { api, calls };
}
const outboxOk = { flushBeforeMutation: async () => true };
const outboxBlocked = { flushBeforeMutation: async () => false };

const SESSION = {
  id: "11111111-1111-4111-8111-111111111111",
  planId: null,
  clientId: "c1",
  localDate: "2026-10-19",
  startedAt: "2026-10-19T08:00:00.000Z",
  completedAt: null,
  points: 0,
};

test("weekdayOf uses the device's local calendar day", () => {
  assert.equal(weekdayOf(new Date(2026, 9, 19, 23, 30)), "MON");
  assert.equal(weekdayOf(new Date(2026, 9, 18, 0, 5)), "SUN");
});

test("planBlocksFor returns the blocks of the plan day for that weekday, else none", () => {
  const plan = {
    id: "p",
    name: "n",
    goal: "",
    isActive: true,
    createdAt: "",
    days: [{ weekday: "MON" as const, blocks: [{ exerciseId: "ex_squat", sets: 3, repRange: "5", restSec: 90 }] }],
  };
  assert.equal(planBlocksFor(plan, new Date(2026, 9, 19)).length, 1);
  assert.deepEqual(planBlocksFor(plan, new Date(2026, 9, 20)), []);
  assert.deepEqual(planBlocksFor(undefined, new Date(2026, 9, 19)), []);
});

test("validatePlanDraft enforces name, <= 7 days, <= 12 blocks a day, known exercises, sets and reps", () => {
  const ok: PlanDraft = { name: "Push", days: [{ weekday: "MON", blocks: [{ exerciseId: "ex_bench", sets: 3, reps: 8 }] }] };
  assert.equal(validatePlanDraft(ok, EX), null);
  assert.match(validatePlanDraft({ ...ok, name: "  " }, EX)!, /name/i);
  assert.match(validatePlanDraft({ name: "x", days: [] }, EX)!, /day/i);
  const blocks13 = Array.from({ length: 13 }, () => ({ exerciseId: "ex_bench", sets: 3, reps: 8 }));
  assert.match(validatePlanDraft({ name: "x", days: [{ weekday: "MON", blocks: blocks13 }] }, EX)!, /12/);
  assert.match(
    validatePlanDraft({ name: "x", days: [{ weekday: "MON", blocks: [{ exerciseId: "nope", sets: 3, reps: 8 }] }] }, EX)!,
    /exercise/i,
  );
  assert.match(
    validatePlanDraft({ name: "x", days: [{ weekday: "MON", blocks: [{ exerciseId: "ex_bench", sets: 0, reps: 8 }] }] }, EX)!,
    /sets/i,
  );
  assert.match(
    validatePlanDraft({ name: "x", days: [{ weekday: "MON", blocks: [{ exerciseId: "ex_bench", sets: 3, reps: 0 }] }] }, EX)!,
    /reps/i,
  );
  const eight = (["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", "MON"] as const).map((weekday) => ({
    weekday,
    blocks: ok.days[0]!.blocks,
  }));
  assert.match(validatePlanDraft({ name: "x", days: eight }, EX)!, /7|day/i);
  const dup = [ok.days[0]!, ok.days[0]!];
  assert.match(validatePlanDraft({ name: "x", days: dup }, EX)!, /day/i);
});

test("buildPlanRequest drops empty days and shapes blocks for the server", () => {
  const req = buildPlanRequest(
    {
      name: " Mine ",
      days: [
        { weekday: "TUE", blocks: [] },
        { weekday: "WED", blocks: [{ exerciseId: "ex_plank", sets: 2, reps: 30 }] },
      ],
    },
    "plan-c1",
  );
  assert.equal(req.name, "Mine");
  assert.equal(req.clientId, "plan-c1");
  assert.deepEqual(req.days, [{ weekday: "WED", blocks: [{ exerciseId: "ex_plank", sets: 2, repRange: "30", restSec: 90 }] }]);
});

test("startGymSession is sync_pending while the outbox cannot flush, and when the network is down", async () => {
  const a = fakeApi(() => SESSION);
  assert.deepEqual(await startGymSession(a.api, outboxBlocked, "c1"), { ok: false, reason: "sync_pending" });
  assert.equal(a.calls.length, 0);

  const b = fakeApi(() => {
    throw net();
  });
  assert.deepEqual(await startGymSession(b.api, outboxOk, "c1"), { ok: false, reason: "sync_pending" });
});

test("startGymSession posts clientId (and planId) with the clientId as idempotency key", async () => {
  const { api, calls } = fakeApi(() => SESSION);
  const r = await startGymSession(api, outboxOk, "c1", "22222222-2222-4222-8222-222222222222");
  assert.equal(r.ok && r.value.id, SESSION.id);
  assert.deepEqual(calls[0], {
    method: "POST",
    path: "/api/gym/sessions",
    body: { clientId: "c1", planId: "22222222-2222-4222-8222-222222222222" },
    key: "c1",
  });
});

test("startGymSession rethrows a server error", async () => {
  const { api } = fakeApi(() => {
    throw http(404);
  });
  await assert.rejects(startGymSession(api, outboxOk, "c1"), (e: unknown) => e instanceof ApiError && e.status === 404);
});

const q = (n: number): QueuedSet => ({
  key: `k${n}`,
  sessionId: SESSION.id,
  set: { exerciseId: "ex_squat", reps: 5, weight: 40, completed: true, setIndex: n },
});
const SET_REPLY = { id: 1, sessionId: SESSION.id, exerciseId: "ex_squat", setIndex: 0, reps: 5, weight: 40, completed: true };

test("flushSetQueue sends in order with the stable key, keeps the rest after a network error", async () => {
  const sent: Call[] = [];
  const { api } = fakeApi((c) => {
    if (c.key === "k1") throw net();
    sent.push(c);
    return SET_REPLY;
  });
  const r = await flushSetQueue(api, [q(0), q(1), q(2)]);
  assert.deepEqual(sent.map((c) => c.key), ["k0"]);
  assert.deepEqual(r.remaining.map((s) => s.key), ["k1", "k2"]);
  assert.equal(r.dropped.length, 0);
  assert.equal(sent[0]!.path, `/api/gym/sessions/${SESSION.id}/sets`);
  assert.deepEqual(sent[0]!.body, { exerciseId: "ex_squat", reps: 5, weight: 40, completed: true, setIndex: 0, clientId: "k0" });
});

test("flushSetQueue stops on a 5xx, drops a set on a non-retryable 4xx and continues", async () => {
  const a = fakeApi((c) => {
    if (c.key === "k0") throw http(409, "already_completed");
    return SET_REPLY;
  });
  const r = await flushSetQueue(a.api, [q(0), q(1)]);
  assert.deepEqual(r.dropped.map((s) => s.key), ["k0"]);
  assert.equal(r.remaining.length, 0);

  const b = fakeApi(() => {
    throw http(503);
  });
  const r2 = await flushSetQueue(b.api, [q(0), q(1)]);
  assert.equal(r2.remaining.length, 2);
  assert.equal(b.calls.length, 1);
});

test("completeGymSession waits for the outbox and parses the completion with loose notices", async () => {
  const blocked = fakeApi(() => ({}));
  assert.deepEqual(await completeGymSession(blocked.api, outboxBlocked, SESSION.id, "done1"), {
    ok: false,
    reason: "sync_pending",
  });
  assert.equal(blocked.calls.length, 0);

  const { api, calls } = fakeApi(() => ({
    session: { ...SESSION, completedAt: "2026-10-19T09:00:00.000Z", points: 17.3 },
    points: 17.3,
    byBodyPart: { quads: 5 },
    newPrs: [
      { exerciseId: "ex_squat", value: 46.7, reps: 5, weight: 40, achievedAt: "2026-10-19T09:00:00.000Z", name: "Back Squat", previous: null },
    ],
    results: [],
    notices: [{ whatever: true }],
  }));
  const r = await completeGymSession(api, outboxOk, SESSION.id, "done1");
  assert.ok(r.ok && r.value.points === 17.3 && r.value.newPrs[0]!.name === "Back Squat");
  assert.deepEqual(calls[0], {
    method: "POST",
    path: `/api/gym/sessions/${SESSION.id}/complete`,
    body: { clientId: "done1" },
    key: "done1",
  });
});

test("completeGymSession surfaces a 409 already_completed and maps a network error to sync_pending", async () => {
  const a = fakeApi(() => {
    throw http(409, "already_completed");
  });
  await assert.rejects(
    completeGymSession(a.api, outboxOk, SESSION.id, "d"),
    (e: unknown) => e instanceof ApiError && e.code === "already_completed",
  );
  const b = fakeApi(() => {
    throw net();
  });
  assert.deepEqual(await completeGymSession(b.api, outboxOk, SESSION.id, "d"), { ok: false, reason: "sync_pending" });
});

test("fetchGym, createPlan and activatePlan call the gym endpoints", async () => {
  const plan = { id: "p1", name: "A", goal: "g", days: [], isActive: false, createdAt: "2026-10-19T00:00:00.000Z" };
  const { api, calls } = fakeApi((c) => {
    if (c.method === "GET") {
      return { exercises: [], plans: [plan], activePlanId: null, recentSessions: [], personalRecords: [], bodyPartScores: [] };
    }
    return { ...plan, isActive: c.method === "PATCH" };
  });
  assert.equal((await fetchGym(api)).plans.length, 1);
  await createPlan(api, { name: "A", goal: "g", days: [], clientId: "pc" });
  await activatePlan(api, "p1", "ac");
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path} ${c.key ?? ""}`),
    ["GET /api/gym ", "POST /api/gym/plans pc", "PATCH /api/gym/plans/p1 ac"],
  );
  assert.deepEqual(calls[2]!.body, { isActive: true, clientId: "ac" });
});

test("toGymView maps server data to the screen model (plans active first, body parts filled, PR metric)", () => {
  const view = toGymView({
    exercises: [
      { id: "ex_squat", userId: null, name: "Back Squat", primaryBodyPart: "quads", secondaryBodyParts: ["glutes"], isBig5: true },
    ],
    plans: [
      {
        id: "a",
        name: "A",
        goal: "",
        days: [{ weekday: "MON", blocks: [{ exerciseId: "ex_squat", sets: 3, repRange: "5", restSec: 90 }] }],
        isActive: false,
        createdAt: "",
      },
      { id: "b", name: "B", goal: "", days: [], isActive: true, createdAt: "" },
    ],
    activePlanId: "b",
    recentSessions: [{ ...SESSION, completedAt: SESSION.startedAt, points: 12 }],
    personalRecords: [{ exerciseId: "ex_squat", value: 46.7, reps: 5, weight: 40, achievedAt: "t" }],
    bodyPartScores: [{ bodyPart: "quads", points: 5, updatedAt: "t" }],
  });
  assert.deepEqual(view.workoutPlans.map((p) => p.id), ["b", "a"]);
  assert.equal(view.workoutPlans[1]!.days[0]!.weekday, "MON");
  assert.equal(view.bodyPartScores.length, 10);
  assert.equal(view.bodyPartScores.find((s) => s.bodyPart === "quads")!.pointsTotal, 5);
  assert.equal(view.bodyPartScores.find((s) => s.bodyPart === "chest")!.pointsTotal, 0);
  assert.equal(view.personalRecords[0]!.metricType, "weight_1rm_proxy");
  assert.equal(view.workoutSessions[0]!.points, 12);
  assert.equal(view.activePlanId, "b");
});

test("newSetKey is unique per call and names its session", () => {
  const a = newSetKey(SESSION.id);
  assert.notEqual(a, newSetKey(SESSION.id));
  assert.ok(a.startsWith("gym-set-"));
});

test("flushSetQueue reports every processed key (sent and dropped)", async () => {
  const { api } = fakeApi((c) => {
    if (c.key === "k0") throw http(400);
    return SET_REPLY;
  });
  const r = await flushSetQueue(api, [q(0), q(1), q(2)]);
  assert.deepEqual([...r.processed].sort(), ["k0", "k1", "k2"]);
  const stopped = await flushSetQueue(fakeApi(() => { throw http(503); }).api, [q(0)]);
  assert.deepEqual([...stopped.processed], []);
});

test("a set appended while a flush is in flight survives and is sent on the next pass", async () => {
  let queue: QueuedSet[] = [q(0)];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const sent: string[] = [];
  const api: ApiClient = {
    async request(_m, _p, opts) {
      await gate;
      sent.push(opts!.idempotencyKey!);
      return SET_REPLY as never;
    },
  };
  const inFlight = flushSetQueue(api, queue); // snapshots [k0]
  queue = [...queue, q(1)]; // appended during the flush
  release();
  queue = applyFlushResult(queue, await inFlight);
  assert.deepEqual(queue.map((s) => s.key), ["k1"]);
  const second = await flushSetQueue(api, queue);
  queue = applyFlushResult(queue, second);
  assert.deepEqual(sent, ["k0", "k1"]);
  assert.equal(queue.length, 0);
});

test("applyFlushResult keeps unprocessed sets in order", () => {
  const out = applyFlushResult([q(0), q(1), q(2)], { processed: new Set(["k0"]) });
  assert.deepEqual(out.map((s) => s.key), ["k1", "k2"]);
});

function memStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
    removeItem: async (k: string) => void m.delete(k),
  };
}

test("saveActive / loadActive round-trip per user; clearActive removes", async () => {
  const st = memStorage();
  const rec = {
    ...emptyActive(),
    session: { id: SESSION.id, planId: null, startedAt: SESSION.startedAt, performed: [{ exerciseId: "ex_squat", setIndex: 0, reps: 5, weight: 40, completed: true }] },
    queue: [q(0)],
  };
  await saveActive(st, "u1", rec);
  assert.ok(st.m.has("system_self.gym.active.v1.u1"));
  assert.deepEqual(await loadActive(st, "u1"), rec);
  assert.deepEqual(await loadActive(st, "u2"), emptyActive());
  await clearActive(st, "u1");
  assert.deepEqual(await loadActive(st, "u1"), emptyActive());
});

test("loadActive ignores corrupt or wrong-shape data", async () => {
  const st = memStorage();
  st.m.set("system_self.gym.active.v1.u1", "{not json");
  assert.deepEqual(await loadActive(st, "u1"), emptyActive());
  st.m.set("system_self.gym.active.v1.u1", JSON.stringify({ session: 5 }));
  assert.deepEqual(await loadActive(st, "u1"), emptyActive());
});

test("saveActive of an empty record removes the key; a pending start survives the round-trip", async () => {
  const st = memStorage();
  await saveActive(st, "u1", { ...emptyActive(), pendingStart: { clientId: "gs-1", planId: "p" } });
  assert.deepEqual((await loadActive(st, "u1")).pendingStart, { clientId: "gs-1", planId: "p" });
  await saveActive(st, "u1", emptyActive());
  assert.equal(st.m.size, 0);
});

test("weekdayOf and planBlocksFor use the given timezone for the weekday", () => {
  const instant = new Date("2026-10-18T22:00:00Z"); // Sunday 22:00 UTC = Monday 03:30 in Kolkata
  assert.equal(weekdayOf(instant, "UTC"), "SUN");
  assert.equal(weekdayOf(instant, "Asia/Kolkata"), "MON");
  assert.equal(weekdayOf(instant, "Not/AZone"), weekdayOf(instant));
  const plan = { days: [{ weekday: "MON" as const, blocks: [{ exerciseId: "ex_squat", sets: 3, repRange: "5", restSec: 90 }] }] };
  assert.equal(planBlocksFor(plan, instant, "Asia/Kolkata").length, 1);
  assert.equal(planBlocksFor(plan, instant, "UTC").length, 0);
});

test("flushSetQueue keeps the set queued on 401, 408 and 429 (retried later, never dropped)", async () => {
  for (const status of [401, 408, 429]) {
    const { api, calls } = fakeApi(() => {
      throw http(status);
    });
    const r = await flushSetQueue(api, [q(0), q(1)]);
    assert.deepEqual(r.remaining.map((s) => s.key), ["k0", "k1"], `status ${status}`);
    assert.equal(r.dropped.length, 0, `status ${status}`);
    assert.equal(r.processed.size, 0, `status ${status}`);
    assert.equal(calls.length, 1, `status ${status}`);
  }
});

test("toWorkoutPlan maps the created plan from the POST response", () => {
  const plan = toWorkoutPlan({
    id: "p9",
    name: "Push",
    goal: "Custom split",
    days: [{ weekday: "TUE", blocks: [{ exerciseId: "ex_bench", sets: 3, repRange: "8", restSec: 90 }] }],
    isActive: true,
    createdAt: "2026-10-19T00:00:00.000Z",
  });
  assert.equal(plan.id, "p9");
  assert.equal(plan.name, "Push");
  assert.deepEqual(plan.days, [
    { id: "p9-TUE", planId: "p9", weekday: "TUE", blocks: [{ exerciseId: "ex_bench", sets: 3, repRange: "8", restSec: 90 }] },
  ]);
});

test("planClientIds reuses one clientId for the same draft until it succeeds", () => {
  let n = 0;
  const ids = createPlanClientIds(() => `pc-${++n}`);
  const draft: PlanDraft = { name: "A", days: [{ weekday: "MON", blocks: [{ exerciseId: "ex_squat", sets: 3, reps: 5 }] }] };
  const first = ids.idFor(draft);
  assert.equal(ids.idFor({ ...draft, name: " A " }), first, "same request after trimming");
  assert.equal(ids.idFor(draft), first, "retry after a failure");
  const edited: PlanDraft = { ...draft, name: "B" };
  const second = ids.idFor(edited);
  assert.notEqual(second, first, "an edited draft is a different request");
  ids.succeeded();
  assert.notEqual(ids.idFor(edited), second, "a new save after success gets a new id");
});
