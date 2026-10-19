import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameLog, GameQuest, GameState } from "@workspace/contracts";
import {
  mergeLogs,
  pendingLogEntries,
  toAchievements,
  toAppUser,
  toDomainScores,
  toLogEntry,
  toMilestones,
  toQuest,
  toQuestChains,
  toShadowSelf,
  weakestDomain,
} from "./mappers";

const profile: GameState["profile"] = {
  username: "alpha",
  codename: "GHOST // AB1-2",
  rank: "D",
  rankSince: "2026-10-01T00:00:00.000Z",
  identitySetting: "semi-public",
  primaryGoal: "Build an unbreakable daily routine",
  biggestWeakness: "SOCIAL",
  morningTime: "07:00",
  nightlyTime: "21:00",
  dayNumber: 12,
  onboarded: true,
  homePathActive: false,
  lifeContext: "student",
  season: null,
};

test("toAppUser maps profile + auth user to the old User shape", () => {
  const u = toAppUser(profile, { id: "u1", createdAt: "2026-10-01T00:00:00.000Z" });
  assert.deepEqual(u, {
    id: "u1",
    username: "alpha",
    codename: "GHOST // AB1-2",
    identitySetting: "semi-public",
    rank: "D",
    primaryGoal: "Build an unbreakable daily routine",
    biggestWeakness: "SOCIAL",
    morningTime: "07:00",
    nightlyTime: "21:00",
    onboardingComplete: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    dayNumber: 12,
  });
});

test("toDomainScores returns all five ranked domains in canonical order", () => {
  const scores = toDomainScores([
    { domain: "DISCIPLINE", score: 30, streak: 2, lastLogDate: "2026-10-18" },
    { domain: "BODY", score: 41.5, streak: 1, lastLogDate: "2026-10-19" },
    { domain: "SOCIAL", score: 22, streak: 0, lastLogDate: null },
  ]);
  assert.deepEqual(scores.map((s) => s.domain), ["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"]);
  assert.deepEqual(scores[0], { domain: "BODY", score: 41.5, streak: 1, lastLog: "2026-10-19" });
  // A domain the server omitted shows as 0 with no streak (never a made-up local default).
  assert.deepEqual(scores[1], { domain: "MIND", score: 0, streak: 0, lastLog: null });
  assert.equal(weakestDomain(scores), "MIND");
});

test("toShadowSelf maps the server shadow and a missing shadow to a dormant one", () => {
  const s = toShadowSelf({
    active: true,
    codename: "SHADOW // ALPHA",
    scores: { BODY: 50, MIND: 51, WEALTH: 52, SOCIAL: 53, DISCIPLINE: 54 },
    gap: 7.25,
    phase: "HUNTING",
    rank: "C",
  });
  assert.equal(s.active, true);
  assert.equal(s.codename, "SHADOW // ALPHA");
  assert.equal(s.gap, 7.25);
  assert.equal(s.phase, "HUNTING");
  assert.equal(s.rank, "C");
  assert.equal(s.scores.SOCIAL, 53);
  assert.equal(typeof s.dailyGainRate.SOCIAL, "number");

  const none = toShadowSelf(null);
  assert.equal(none.active, false);
  assert.equal(none.phase, "DORMANT");
  assert.equal(none.gap, 0);
});

const log = (n: number, over: Partial<GameLog> = {}): GameLog => ({
  id: `l${n}`,
  clientId: `c${n}`,
  domain: "BODY",
  logType: "workout",
  data: { intensity: 4 },
  freeText: "ran 5k",
  forbidden: false,
  occurredAt: `2026-10-19T0${n}:00:00.000Z`,
  localDate: "2026-10-19",
  isRetroactive: false,
  createdAt: `2026-10-19T0${n}:00:00.000Z`,
  ...over,
});

test("toLogEntry maps a server log to the old LogEntry shape (note from freeText)", () => {
  assert.deepEqual(toLogEntry(log(1)), {
    id: "l1",
    clientId: "c1",
    domain: "BODY",
    type: "workout",
    forbidden: false,
    data: { intensity: 4, note: "ran 5k" },
    timestamp: "2026-10-19T01:00:00.000Z",
    pending: false,
  });
  assert.deepEqual(toLogEntry(log(2, { data: null, freeText: null })).data, {});
});

test("pendingLogEntries turns queued POST /api/logs items into pending entries; other items are ignored", () => {
  const items = [
    {
      userId: "u1",
      clientId: "p1",
      method: "POST" as const,
      path: "/api/logs",
      body: { clientId: "p1", domain: "MIND", logType: "reading", data: { intensity: 2 }, freeText: "ch. 3", occurredAt: "2026-10-19T05:00:00.000Z" },
    },
    { userId: "u1", clientId: "g1", method: "POST" as const, path: "/api/gym/sessions", body: { clientId: "g1" } },
    { userId: "u1", clientId: "bad", method: "POST" as const, path: "/api/logs", body: { nonsense: true } },
  ];
  assert.deepEqual(pendingLogEntries(items), [
    {
      id: "p1",
      clientId: "p1",
      domain: "MIND",
      type: "reading",
      forbidden: false,
      data: { intensity: 2, note: "ch. 3" },
      timestamp: "2026-10-19T05:00:00.000Z",
      pending: true,
    },
  ]);
});

test("mergeLogs: server logs oldest-first, then pending ones the server does not have yet", () => {
  const server = [log(3), log(1)]; // GET /api/logs is newest first
  const pending = pendingLogEntries([
    { userId: "u1", clientId: "c3", method: "POST", path: "/api/logs", body: { clientId: "c3", domain: "BODY", logType: "workout", occurredAt: "2026-10-19T03:00:00.000Z" } },
    { userId: "u1", clientId: "p9", method: "POST", path: "/api/logs", body: { clientId: "p9", domain: "SOCIAL", logType: "conversation", occurredAt: "2026-10-19T09:00:00.000Z" } },
  ]);
  const merged = mergeLogs(server, pending);
  assert.deepEqual(merged.map((l) => l.clientId), ["c1", "c3", "p9"]);
  assert.equal(merged[1]?.pending, false); // the server copy wins over the queued one
  assert.equal(merged[2]?.pending, true);
});

const quest = (over: Partial<GameQuest> = {}): GameQuest => ({
  id: "q1",
  type: "daily",
  title: "Walk",
  description: "Walk 30 minutes",
  domain: "BODY",
  status: "active",
  expiresAt: "2026-10-19T23:59:59.000Z",
  resolvedAt: null,
  chainId: null,
  chainStep: null,
  chainTotal: null,
  refusalReason: null,
  slotStart: null,
  slotEnd: null,
  slotState: "none" as const,
  createdAt: "2026-10-19T00:00:00.000Z",
  ...over,
});

test("toQuest maps server quests; chain fields only when present; unknown domains fall back to DISCIPLINE", () => {
  assert.deepEqual(toQuest(quest()), {
    id: "q1",
    type: "daily",
    title: "Walk",
    description: "Walk 30 minutes",
    domain: "BODY",
    status: "active",
    expiresAt: "2026-10-19T23:59:59.000Z",
    generatedBySystem: true,
  });
  const chained = toQuest(quest({ type: "arc", chainId: "ch1", chainStep: 1, chainTotal: 3, domain: "weird" }));
  assert.equal(chained.chainId, "ch1");
  assert.equal(chained.chainStep, 1);
  assert.equal(chained.chainTotal, 3);
  assert.equal(chained.domain, "DISCIPLINE");
});

test("toQuest carries a locked slot and its state", () => {
  const q = toQuest(quest({ slotStart: "17:30", slotEnd: "18:30", slotState: "missed" }));
  assert.equal(q.slotStart, "17:30");
  assert.equal(q.slotEnd, "18:30");
  assert.equal(q.slotState, "missed");
});

test("toQuestChains joins the active chains with their templates", () => {
  const chains = toQuestChains({
    templates: [
      { templateKey: "mind_sharpening", name: "MIND SHARPENING ARC", description: "d", domain: "MIND", steps: [{ title: "a", description: "b", reward: "c" }] },
      { templateKey: "discipline_forge", name: "DISCIPLINE FORGE", description: "d2", domain: "DISCIPLINE", steps: [] },
    ],
    active: [
      { templateKey: "mind_sharpening", currentStep: 1 },
      { templateKey: "retired_template", currentStep: 0 },
    ],
  });
  assert.equal(chains.length, 1);
  assert.deepEqual(chains[0], {
    id: "mind_sharpening",
    templateKey: "mind_sharpening",
    name: "MIND SHARPENING ARC",
    description: "d",
    domain: "MIND",
    steps: [{ title: "a", description: "b", reward: "c" }],
    currentStep: 1,
    totalSteps: 1,
    status: "active",
  });
});

test("toAchievements / toMilestones list every definition with server unlock times", () => {
  const ach = toAchievements([{ id: "first_log", unlockedAt: "2026-10-19T01:00:00.000Z" }]);
  assert.equal(ach.length, 19);
  assert.equal(ach.find((a) => a.id === "first_log")?.unlockedAt, "2026-10-19T01:00:00.000Z");
  assert.equal(ach.find((a) => a.id === "streak_7")?.unlockedAt, null);

  const ms = toMilestones([{ domain: "SOCIAL", tier: 60, unlockedAt: "2026-10-19T02:00:00.000Z" }]);
  assert.equal(ms.length, 25); // 5 domains x 5 tiers
  const social60 = ms.find((m) => m.domain === "SOCIAL" && m.tier === 60);
  assert.equal(social60?.title, "CONNECTED");
  assert.equal(social60?.unlockedAt, "2026-10-19T02:00:00.000Z");
});
