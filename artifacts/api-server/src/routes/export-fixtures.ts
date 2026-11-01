// Shared test fixture: one user with a row in every exported table and other players around them
// (account-export.test.ts, admin-support.test.ts). Test-only; nothing in the app imports it.
import * as s from "@workspace/db/schema";
import { db } from "./game-test-helpers";

export const NOW = new Date("2026-03-04T10:00:00Z");
export const DAY = "2026-03-04";
export const WEEK = "2026-W10";

/** Gives `me` a row in every exported table, with other players (B: clanmate/duo/rival/opponent, C: stranger) all around. */
export async function seedEverything(me: string, b: string, c: string) {
  const d = db!;
  const [quest] = await d.insert(s.quests).values({ userId: me, type: "daily", title: "Run 5k", description: "Go", domain: "BODY", expiresAt: NOW }).returning();
  await d.insert(s.logs).values({ userId: me, clientId: "log-1", domain: "BODY", logType: "workout", occurredAt: NOW, localDate: DAY, freeText: "ran 5k" });
  await d.insert(s.scoreEvents).values({ userId: me, domain: "BODY", delta: 1, actualDelta: 1, reason: "log", localDate: DAY });
  await d.insert(s.dailySnapshots).values({ userId: me, localDate: DAY, scores: { BODY: 50 }, hidden: 31.337, rank: "E" });
  await d.insert(s.questChains).values({ userId: me, templateKey: "t", name: "Chain", domain: "BODY", totalSteps: 3 });
  await d.insert(s.shadowSelves).values({ userId: me, codename: "SHADOW // X" });
  await d.insert(s.achievements).values({ userId: me, achievementId: "first", unlockedAt: NOW });
  await d.insert(s.milestones).values({ userId: me, domain: "BODY", tier: 1, unlockedAt: NOW });
  const [notice] = await d.insert(s.notices).values({ userId: me, kind: "shame", payload: { handle: "bob_1", leakedId: b } }).returning();
  await d.insert(s.rankFreezes).values({ userId: me, startedOn: DAY, untilOn: "2026-03-10", month: "2026-03", reason: "rest" });
  await d.insert(s.debriefs).values({ userId: me, localDate: DAY, text: "debrief" });
  await d.insert(s.shadowTakeovers).values({ userId: me, questId: quest!.id, questTitle: "Run 5k", localDate: DAY });
  await d.insert(s.comebacks).values({ userId: me, startedOn: DAY, gapDays: 4 });
  await d.insert(s.seasons).values({ userId: me, kind: "quarter", startsOn: DAY, endsOn: "2026-06-04" });
  await d.insert(s.analyticsEvents).values({ userId: me, name: "app_open", props: {} });
  await d.insert(s.systemMessages).values({
    userId: me,
    messageType: "morning",
    rank: "E",
    trajectory: "up",
    shadowActive: false,
    shadowGap: 0,
    dayNumber: 1,
    message: "Begin.",
    model: "m",
    promptVersion: "v1",
    attempts: 1,
    context: { note: `rival ${c}` },
  });
  const [batch] = await d
    .insert(s.generatedQuestBatches)
    .values({ userId: me, rank: "E", weakestDomain: "BODY", primaryGoal: "g", dayNumber: 1, shadowGap: 0, model: "m", promptVersion: "v1", attempts: 1 })
    .returning();
  await d.insert(s.generatedQuests).values({ batchId: batch!.id, userId: me, title: "t", description: "d", domain: "BODY", type: "daily" });
  await d.insert(s.questCompletionEvents).values({ userId: me, questId: quest!.id, status: "completed", domain: "BODY", questType: "daily" });
  // Proof: a session verdict, a saved place (private to me), a coarse session spot. Shared OSM places are not mine.
  await d.insert(s.questProofs).values({
    questId: quest!.id,
    userId: me,
    method: "session",
    status: "accepted",
    summary: { kind: "workout", activeMinutes: 32 },
    reason: "Movement confirmed.",
    evidence: ["32 active min"],
  });
  await d.insert(s.places).values([
    { source: "saved", kind: "gym", name: "My gym", lat: 12.97, lng: 77.59, radiusM: 100, userId: me },
    { source: "osm", kind: "gym", name: "Public gym", lat: 12.98, lng: 77.6, radiusM: 80, osmId: "node/1" },
  ]);
  await d.insert(s.sessionSpots).values({ userId: me, kind: "gym", lat: 12.972, lng: 77.595 });
  await d.insert(s.vouchRequests).values({ questId: quest!.id, requesterId: me, voucherId: b, note: "Ran with me" });
  await d.insert(s.aiUsageDaily).values({ userId: me, localDate: DAY, name: "messages", count: 2 });
  await d.insert(s.notificationPrefs).values({ userId: me });
  await d.insert(s.notificationLog).values({ userId: me, localDate: DAY, kind: "morning" });
  await d.insert(s.noticePushes).values({ noticeId: notice!.id, userId: me, decision: "sent" });
  await d.insert(s.entitlements).values({ userId: me, tier: "pro", source: "revenuecat", productId: "pro_monthly" });
  await d.insert(s.billingEvents).values({ id: "evt_1", userId: me, type: "INITIAL_PURCHASE", payload: { app_user_id: me, other: c } });
  const ex = "bench";
  await d.insert(s.exercises).values({ id: "mine-1", userId: me, name: "Custom curl", primaryBodyPart: "arms" });
  const [plan] = await d.insert(s.workoutPlans).values({ userId: me, name: "Plan", goal: "strength", days: [] }).returning();
  const [session] = await d.insert(s.workoutSessions).values({ userId: me, planId: plan!.id, startedAt: NOW, localDate: DAY, clientId: "ws-1" }).returning();
  await d.insert(s.performedSets).values({ sessionId: session!.id, exerciseId: ex, setIndex: 0, reps: 5 });
  await d.insert(s.personalRecords).values({ userId: me, exerciseId: ex, value: 100, reps: 5, weight: 100, achievedAt: NOW });
  await d.insert(s.bodyPartScores).values({ userId: me, bodyPart: "chest" });
  await d.insert(s.gymCrowdReports).values({ userId: me, sessionId: session!.id, level: "quiet", weekday: 2, hour: 7 });
  const [dom] = await d.insert(s.customDomains).values({ userId: me, name: "Reading", baseline: 0, target: 10 }).returning();
  await d.insert(s.customLogs).values({ userId: me, customDomainId: dom!.id, clientId: "cl-1", value: 3, occurredAt: NOW, localDate: DAY });
  await d.insert(s.budgets).values({ userId: me, category: "food", monthlyLimit: 100 });
  await d.insert(s.recurringIncome).values({ userId: me, label: "Salary", amount: 1000, dayOfMonth: 1 });
  await d.insert(s.financialGoals).values({ userId: me, title: "Laptop", targetAmount: 500 });
  await d.insert(s.netWorthSnapshots).values({ userId: me, month: "2026-03", amount: 1234 });
  await d.insert(s.financeWeeks).values({ userId: me, weekKey: WEEK, evaluatedOn: DAY });
  // Peer ratings: I rated B; B and C rated me (never exported by rater); my weekly aggregate is.
  await d.insert(s.peerRatings).values([
    { raterId: me, rateeId: b, weekKey: WEEK, rating: 4 },
    { raterId: b, rateeId: me, weekKey: WEEK, rating: 2 },
    { raterId: c, rateeId: me, weekKey: WEEK, rating: 3 },
  ]);
  await d.insert(s.peerRatingWeeks).values({ userId: me, weekKey: WEEK, evaluatedOn: DAY, ratingCount: 2, average: 2.5 });
  await d.insert(s.follows).values([
    { followerId: me, followeeId: c },
    { followerId: c, followeeId: me },
  ]);
  await d.insert(s.blocks).values([
    { blockerId: me, blockedId: c },
    { blockerId: c, blockedId: me },
  ]);
  await d.insert(s.userReports).values([
    { reporterId: me, subjectId: c, subjectHandle: "carol_1", reason: "spam" },
    { reporterId: c, subjectId: me, reason: "reporter-secret" },
  ]);
  const [ghost] = await d.insert(s.ghostRivals).values({ ownerId: me, codename: "GHOST-1", rank: "E", scores: {}, trajectory: "stable" }).returning();
  const [asg] = await d
    .insert(s.rivalAssignments)
    .values([
      { userId: me, slot: 1, rivalUserId: b, codename: "RIVAL // ALPHA-1", expiresAt: NOW },
      { userId: me, slot: 2, ghostId: ghost!.id, codename: "RIVAL // GHOST-2", expiresAt: NOW },
      { userId: c, slot: 1, rivalUserId: me, codename: "RIVAL // THEIRS-9", expiresAt: NOW },
    ])
    .returning();
  await d.insert(s.rivalPressure).values({ userId: me, assignmentId: asg!.id, domain: "BODY", ahead: true });
  await d.insert(s.rivalChallenges).values({ userId: me, assignmentId: asg!.id, codename: "RIVAL // ALPHA-1", domain: "BODY", startDate: DAY, endDate: "2026-03-10", userStart: 1, rivalStart: 2 });
  await d.insert(s.rivalTaunts).values({ userId: me, assignmentId: asg!.id, codename: "RIVAL // ALPHA-1", message: "keep up", localDate: DAY });
  await d.insert(s.namedChallenges).values({
    challengerId: me,
    opponentId: b,
    domain: "BODY",
    days: 7,
    status: "resolved",
    respondBy: NOW,
    challengerStart: 10,
    opponentStart: 7771234.5,
    challengerEnd: 20,
    opponentEnd: 8881234.5,
    winnerId: b,
    outcome: "opponent_won",
  });
  const [duo] = await d.insert(s.duos).values({ userA: me, userB: b }).returning();
  await d.insert(s.duoMembers).values([
    { userId: me, duoId: duo!.id },
    { userId: b, duoId: duo!.id },
  ]);
  await d.insert(s.duoInvites).values({ fromId: me, toId: b, status: "accepted" });
  await d.insert(s.duoCheckins).values([
    { duoId: duo!.id, userId: me, kind: "done" },
    { duoId: duo!.id, userId: b, kind: "done" },
  ]);
  const [clan] = await d.insert(s.clans).values({ name: "Iron", nameLower: "iron", tag: "IRON", inviteCode: "SECRETINVITE1", createdBy: b }).returning();
  await d.insert(s.clanMembers).values([
    { userId: me, clanId: clan!.id, role: "member" },
    { userId: b, clanId: clan!.id, role: "leader" },
  ]);
  await d.insert(s.clanDispatches).values([
    { clanId: clan!.id, kind: "shame", text: "shamed", actorId: b, subjectId: me },
    { clanId: clan!.id, kind: "shame", text: "unrelated", actorId: b, subjectId: c },
  ]);
  // Secrets that must never leave.
  await d.insert(s.pushTokens).values({ userId: me, token: "ExponentPushToken[SECRETDEVICE]", platform: "ios" });
  await d.insert(s.idempotencyKeys).values({ userId: me, key: "idem-secret-1" });
  await d.insert(s.emailCodes).values({ userId: me, purpose: "verify", codeHash: "CODEHASH-SECRET", expiresAt: NOW });
}
