import { test } from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENT_DEFS, newAchievements, rankAchievement, type AchievementContext } from "./achievements";

const base: AchievementContext = {
  logsCount: 0,
  maxStreak: 0,
  minStreak: 0,
  completedQuests: 0,
  forbiddenLogs: 0,
  challengeWins: 0,
  scores: { BODY: 50, MIND: 50, WEALTH: 50, SOCIAL: 50, DISCIPLINE: 50 },
  shadow: null,
  now: new Date("2026-03-01T00:00:00Z"),
};

test("19 definitions with verbatim text", () => {
  assert.equal(Object.keys(ACHIEVEMENT_DEFS).length, 19);
  assert.equal(ACHIEVEMENT_DEFS.first_log.title, "FIRST TRANSMISSION");
  assert.equal(ACHIEVEMENT_DEFS.seven_days_straight.icon, "lock");
});

test("newAchievements first_log, streak_7, domain_80, all_domains_60 together", () => {
  const ctx = { ...base, logsCount: 3, maxStreak: 7, scores: { BODY: 80, MIND: 60, WEALTH: 61, SOCIAL: 70, DISCIPLINE: 65 } };
  assert.deepEqual(newAchievements(ctx, new Set()).sort(), ["all_domains_60", "domain_80", "first_log", "streak_7"]);
});

test("already unlocked ids are excluded", () => {
  const ctx = { ...base, logsCount: 3, maxStreak: 7 };
  assert.deepEqual(newAchievements(ctx, new Set(["first_log" as const])), ["streak_7"]);
});

test("quest, forbidden, challenge, discipline, seven_days_straight rules", () => {
  const ctx = {
    ...base,
    completedQuests: 50,
    forbiddenLogs: 1,
    challengeWins: 5,
    maxStreak: 30,
    minStreak: 7,
    scores: { BODY: 100, MIND: 50, WEALTH: 50, SOCIAL: 50, DISCIPLINE: 90 },
  };
  assert.deepEqual(newAchievements(ctx, new Set()).sort(), [
    "challenge_5", "challenge_win", "discipline_master", "domain_100", "domain_80", "forbidden_log",
    "quest_10", "quest_50", "seven_days_straight", "streak_30", "streak_7",
  ]);
});

test("beat_shadow needs active shadow and every domain >= shadow", () => {
  const shadow = {
    active: true,
    codename: "SHADOW // X",
    initialScores: { BODY: 50, MIND: 50, WEALTH: 50, SOCIAL: 50, DISCIPLINE: 50 },
    gainRates: { BODY: 1, MIND: 1, WEALTH: 1, SOCIAL: 1, DISCIPLINE: 1 },
    activatedAt: base.now.toISOString(),
  };
  assert.deepEqual(newAchievements({ ...base, shadow }, new Set()), ["beat_shadow"]);
  assert.deepEqual(newAchievements({ ...base, shadow: { ...shadow, active: false } }, new Set()), []);
  assert.deepEqual(newAchievements({ ...base, shadow, scores: { ...base.scores, MIND: 49 } }, new Set()), []);
});

test("rankAchievement", () => {
  assert.equal(rankAchievement("E"), null);
  assert.equal(rankAchievement("D"), "rank_d");
  assert.equal(rankAchievement("S"), "rank_s");
});
