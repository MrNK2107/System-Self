# P2 — Server Game Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all game rules and state (scores, streaks, decay, rank, quests, chains, shadow, achievements, milestones, debriefs, gym) to the server, so each user's progress is authoritative, multi-device, and ready for social features.

**Architecture:** A pure TypeScript rules package `lib/engine` (no I/O) holds every formula. The API owns state in Postgres; every score change goes through one transactional service that takes a per-user advisory lock, writes an append-only `score_events` ledger, and emits `notices` (rank-up, achievement, milestone, streak break, shadow…) the client acknowledges. A daily rollover per user's local date (worker + on-demand catch-up) applies decay, quest expiry, streak breaks, snapshots, rank transitions and shadow activation. Request/response shapes live in a shared zod package `lib/contracts` that the mobile app will import in P3.

**Tech Stack:** TypeScript, zod 3, drizzle-orm/pg, Express 5, `node:test` + `tsx`, supertest, `@google/genai` (via the P1 `generateWithFallback`).

**Spec:** `docs/superpowers/specs/2026-10-19-production-architecture-design.md` (§2 item 3 is the ranking authority). Reference for existing client rules: `docs/reference/client-engine-inventory.md`.

## Global Constraints

- Ranked domains: `BODY, MIND, WEALTH, SOCIAL, DISCIPLINE` (in this order everywhere). CUSTOM domains arrive in P6 and are never in the hidden score.
- Hidden score: `(BODY*0.20 + MIND*0.20 + WEALTH*0.15 + SOCIAL*0.15 + DISCIPLINE*0.30) * m`, m = 1.1 if 30-day completion rate ≥ 0.90, 0.85 if < 0.50, else 1.0; m = 1.0 when fewer than 5 quests resolved (complete+failed+refused) in the last 30 local days. Round to 2 decimals.
- Tiers: E 0–25, D 26–40, C 41–55, B 56–70, A 71–85, S 86–100 (`tierOf(h)`: ≥86 S, ≥71 A, ≥56 B, ≥41 C, ≥26 D, else E).
- Promotion: the last 14 rollover snapshots all have `tierOf(hidden) > rank` → rank + 1 tier. Demotion: the last 7 snapshots all have `hidden < floor(rank)` and no active Rank Freeze → rank − 1 tier. Never below E or above S. Each new user starts at E.
- Log deltas (unchanged from the app): BODY 2.5, MIND 2.5, WEALTH 2.0, SOCIAL 2.0, DISCIPLINE 3.0; streak multiplier `min(2.0, 1.0 + streakBefore*0.1)` applied only when the bonus flag is on and delta > 0; `actual = round1(delta*mult)`; score clamped 0..100.
- Forbidden log: `+5` to its domain (no bonus) and `−2` DISCIPLINE (no bonus). Quest complete: `+3.0` DISCIPLINE with bonus. Gym session: computed gym points to BODY, no bonus (constants SET 1.2, BLOCK 1.5, SESSION 2.0).
- Streaks increment only on *activity* (a log or gym session in that domain; a completed quest counts as DISCIPLINE activity). Same local day → no change; previous day → +1; older → reset to 1. Penalties never touch streaks.
- Rollover for local date D (applied once per user per date, in this order):
  1. Expire active quests with `expiresAt ≤ end of D` → `failed`; DISCIPLINE −0.8 daily / −2.0 weekly / −5.0 arc.
  2. Streak breaks: each domain with `streak > 0` and `lastLogDate < D` → streak 0. DISCIPLINE −`min(6, 2*broken)` (always, even if DISCIPLINE broke).
  3. Decay: with `k` = consecutive local days up to and including D with zero logs: k = 1 → 0, 2 ≤ k ≤ 4 → −0.3 per ranked domain, k ≥ 5 → −0.6 per ranked domain. No decay while Rank Freeze is active.
  4. Snapshot `daily_snapshots(userId, D)` with scores, hidden score, tier, rank.
  5. Rank transition per the rules above (a notice `rank_change`).
  6. Shadow: activate if inactive and (7 consecutive snapshots with hidden < mean of the preceding 30 snapshots, needing ≥ 14 snapshots in total) or k ≥ 5; resolve if active and every ranked domain ≥ shadow score.
- Refusal (per ISO week in the user's timezone): 1st refusal free (no penalty), 2nd −1.5 DISCIPLINE, 3rd rejected with 409 `{ code: "refusal_limit" }`.
- Shadow: initial = `min(100, score + 12)` per domain; daily gain BODY 1.4, MIND 1.2, WEALTH 1.0, SOCIAL 1.0, DISCIPLINE 1.8; scores `min(100, initial + days*rate)` with fractional days; gap = mean(shadow) − mean(user); phases as in the inventory; codename `SHADOW // <USERNAME>`.
- Dates: every "day" is the user's local date in `users.timezone` (IANA), as `YYYY-MM-DD`. Use `Intl.DateTimeFormat` with `timeZone`; no date library.
- All score mutations happen inside `withUserLock` (transaction + `pg_advisory_xact_lock(hashtext(userId))`).
- Every mutating endpoint accepts an `Idempotency-Key` header or a `clientId` body field; replays return the original result with 200.
- Timezone changes (`PATCH /api/auth/me` with `timezone`) must recompute `user_day_state.nextRolloverAt` under `withUserLock` (add this hook in Task 7). Every new table that has `updatedAt` gets it set explicitly by the service on every update.
- The hidden score is never returned to clients. Clients get `rank`, `tier progress %` (0–100 within the current tier band), and `trajectory`.
- Trajectory: hidden score now vs the snapshot 7 days earlier (or the earliest one): > +1.0 up, < −1.0 down, else stable.
- DB-dependent tests follow the P1 guard (skip without `TEST_DATABASE_URL`).

## Review Focus

1. **Rollover idempotency and catch-up** — calling rollover twice for the same date changes nothing the second time; a user away for 10 days gets each missed date applied in order (max 30 days of catch-up; older gaps are applied as one decay-only step). (Task 7)
2. **Concurrent writes** — two simultaneous `POST /logs` for the same user both land, and the final score equals the sum of both actual deltas. (Task 5)
3. **Timezone boundary** — a user in `Asia/Kolkata` logging at 23:50 local and 00:10 local gets two different local dates, and the streak increments. (Task 1, Task 6)
4. **Double complete / complete after fail** — completing an already-complete or failed quest → 409 and no score change. (Task 6)
5. **Multi-tier milestone jump** — a score moving 58 → 82 unlocks 60, 70 and 80 together (three notices). (Task 3)

---

### Task 1: `lib/engine` — scores, streaks, penalties, dates

**Files:**
- Create: `lib/engine/package.json` (`@workspace/engine`, `type: module`, exports `.` → `./src/index.ts`, script `test`: `tsx --test src/**/*.test.ts`, devDeps `tsx` catalog:, `@types/node` catalog:), `lib/engine/tsconfig.json` (composite, like `lib/db`), `lib/engine/src/index.ts`, `src/constants.ts`, `src/dates.ts`, `src/scoring.ts`
- Modify: root `tsconfig.json` references
- Test: `lib/engine/src/scoring.test.ts`, `src/dates.test.ts`

**Interfaces (Produces):**
- `type RankedDomain = "BODY" | "MIND" | "WEALTH" | "SOCIAL" | "DISCIPLINE"`; `RANKED_DOMAINS: readonly RankedDomain[]`; `type Rank = "E" | "D" | "C" | "B" | "A" | "S"`; `RANKS: readonly Rank[]`; `type QuestType = "daily" | "weekly" | "arc"`.
- `BASE_LOG_DELTAS: Record<RankedDomain, number>`; `FORBIDDEN_DOMAIN_DELTA = 5`; `FORBIDDEN_DISCIPLINE_DELTA = -2`; `QUEST_COMPLETE_DELTA = 3`; `QUEST_FAIL_PENALTY: Record<QuestType, number>` (0.8, 2.0, 5.0 as positives).
- `localDate(at: Date, timeZone: string): string`; `addDays(date: string, n: number): string`; `daysBetween(a: string, b: string): number` (b − a); `isoWeekKey(date: string): string` (`YYYY-Www`); `endOfLocalDay(date: string, timeZone: string): Date`.
- `interface DomainState { domain: RankedDomain; score: number; streak: number; lastLogDate: string | null }`
- `streakMultiplier(streak: number): number`
- `applyDelta(s: DomainState, delta: number, o: { bonus: boolean; activity: boolean; date: string }): { next: DomainState; actualDelta: number }`
- `logChanges(domain: RankedDomain, forbidden: boolean): ChangeSpec[]` where `interface ChangeSpec { domain: RankedDomain; delta: number; bonus: boolean; activity: boolean }`
- `streakBreaks(states: DomainState[], date: string): { broken: RankedDomain[]; penalty: number }` (the date being rolled over: broken if `streak > 0 && lastLogDate < date`).
- `decayPerDomain(consecutiveInactiveDays: number): number` (returns 0, 0.3 or 0.6).
- `refusalOutcome(refusalsAlreadyThisWeek: number): { allowed: boolean; penalty: number }`.

- [ ] **Step 1:** Write tests with exact values: `applyDelta BODY 50 streak 3 +2.5 bonus → actual 3.3, score 53.3`; `applyDelta streak 12 caps multiplier at 2.0`; `negative delta never uses the multiplier and does not touch the streak even with activity false`; `activity on next day increments, same day keeps, gap resets to 1`; `score clamps at 100 and 0, and actualDelta reflects the clamp`; `logChanges forbidden returns [+5 domain no bonus, −2 DISCIPLINE no bonus]`; `streakBreaks penalty caps at 6 and includes DISCIPLINE`; `decayPerDomain 1→0, 2→0.3, 4→0.3, 5→0.6`; `refusalOutcome 0→{true,0}, 1→{true,1.5}, 2→{false,0}`; `localDate 2026-10-19T18:25Z in Asia/Kolkata → 2026-10-19 and 18:35Z → 2026-10-20`; `isoWeekKey 2026-01-01 → 2026-W01`.
- [ ] **Step 2:** `pnpm --filter @workspace/engine test` → FAIL.
- [ ] **Step 3:** Implement. Note: `actualDelta` = the score change after clamping, rounded to 1 decimal.
- [ ] **Step 4:** Tests PASS; root `pnpm run typecheck` PASS.
- [ ] **Step 5:** Commit `feat(engine): scoring, streaks, penalties, local dates`.

### Task 2: `lib/engine` — hidden score, rank, trajectory

**Files:** Create `lib/engine/src/rank.ts`; Test `src/rank.test.ts`.

**Interfaces (Produces):**
- `completionMultiplier(resolved: number, completed: number): number`
- `hiddenScore(scores: Record<RankedDomain, number>, multiplier: number): number`
- `tierOf(hidden: number): Rank`; `rankFloor(rank: Rank): number` (0, 26, 41, 56, 71, 86); `rankCeil(rank: Rank): number` (25, 40, 55, 70, 85, 100); `tierProgress(hidden: number, rank: Rank): number` (0–100, clamped, relative to the rank's band).
- `interface Snapshot { date: string; hidden: number }`
- `evaluateRankTransition(rank: Rank, snapshots: Snapshot[] /* oldest→newest */, freezeActive: boolean): { kind: "promotion" | "demotion"; to: Rank } | null`
- `trajectory(snapshots: Snapshot[], currentHidden: number): "up" | "stable" | "down"`
- `generateCodename(rank: Rank, rng?: () => number): string` (prefixes E GHOST, D VECTOR, C CIPHER, B PHANTOM, A WRAITH, S ORACLE; format `PREFIX // XXX-N`).

- [ ] **Step 1:** Tests: `hiddenScore all 50 with m=1 → 50`; `completionMultiplier(4,4) → 1.0 (too few)`, `(10,9) → 1.1`, `(10,4) → 0.85`, `(10,7) → 1.0`; `tierOf boundaries 25→E 26→D 85.99→A 86→S`; `promotion needs 14 consecutive snapshots above tier: 13 → null, 14 → D`; `one dip in the last 14 resets promotion`; `promotion is one tier even if snapshots are in A`; `demotion after 7 below floor; freeze blocks it`; `E never demotes, S never promotes`; `trajectory +1.5 over 7 days → up`; `codename matches /^VECTOR \/\/ [A-Z0-9]{3}-[1-9]$/`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(engine): hidden score, rank transitions, trajectory`.

### Task 3: `lib/engine` — shadow, achievements, milestones, verdict, gym

**Files:** Create `lib/engine/src/shadow.ts`, `achievements.ts`, `milestones.ts`, `debrief.ts`, `gym.ts`; Tests `shadow.test.ts`, `achievements.test.ts`, `milestones.test.ts`, `debrief.test.ts`, `gym.test.ts`.

**Interfaces (Produces):**
- `interface ShadowState { active: boolean; codename: string; initialScores: Record<RankedDomain, number>; gainRates: Record<RankedDomain, number>; activatedAt: string | null /* ISO */ }`
- `SHADOW_GAIN_RATES`, `SHADOW_HEAD_START = 12`; `initShadow(scores, username, now: Date): ShadowState`; `shadowScores(s: ShadowState, now: Date): Record<RankedDomain, number>`; `shadowGap(s, userScores, now): number`; `shadowPhase(s, gap, now): "DORMANT" | "AWAKENED" | "HUNTING" | "DOMINANT"`; `shadowRank(s, now): Rank` (tier of the plain mean); `shouldActivateShadow(snapshots: Snapshot[], inactiveDays: number): boolean`; `isShadowResolved(s, userScores, now): boolean`.
- `type AchievementId` = the 19 ids from the inventory; `ACHIEVEMENT_DEFS: Record<AchievementId, { title: string; description: string; icon: string }>` (copy titles/descriptions/icons verbatim from `artifacts/system-self/context/AppContext.tsx` L184–204); `interface AchievementContext { logsCount: number; maxStreak: number; minStreak: number; completedQuests: number; forbiddenLogs: number; challengeWins: number; scores: Record<RankedDomain, number>; shadow: ShadowState | null; now: Date }`; `newAchievements(ctx: AchievementContext, unlocked: ReadonlySet<AchievementId>): AchievementId[]` (all rules from the inventory except `rank_*`; `all_domains_60` and `seven_days_straight` use the five ranked domains); `rankAchievement(rank: Rank): AchievementId | null`.
- `MILESTONE_TIERS = [60, 70, 80, 90, 100]`; `MILESTONE_TITLES: Record<RankedDomain, Record<60|70|80|90|100, string>>` (copy from AppContext L208–213; SOCIAL: 60 CONNECTED, 70 MAGNETIC, 80 INFLUENTIAL, 90 COMMANDING, 100 SOCIAL SOVEREIGN); `crossedMilestones(domain, prev, next, unlocked: ReadonlySet<string /* `${domain}_${tier}` */>): number[]` (every tier with `prev < tier ≤ next` that isn't unlocked).
- `debriefVerdict(deltas: Record<RankedDomain, number>, questRate: number): "ACCEPTABLE" | "INSUFFICIENT" | "PATHETIC"` (rules from the inventory; avg over ranked domains).
- Gym (moved from `artifacts/system-self/features/gym/services/*`, same constants and behaviour): `computeGymPoints(performed: { exerciseId: string; completed: boolean }[], plannedBlocks: { exerciseId: string; sets: number }[], primaryBodyPartOf: (exerciseId: string) => string | undefined): { totalPoints: number; byBodyPart: Record<string, number>; finishedBlocks: number }`; `estimate1RM(weight: number, reps: number): number`.

- [ ] **Step 1:** Tests: `initShadow head start 12 capped at 100`; `shadow BODY after 2 days = initial + 2.8`; `phase HUNTING at gap 12 day 1`; `shouldActivateShadow true after 7 below the trailing mean with ≥14 snapshots; false with 13`; `shouldActivateShadow true when inactiveDays ≥ 5`; `isShadowResolved only when every domain ≥ shadow`; `newAchievements first_log, streak_7, domain_80, all_domains_60 together`; `already unlocked ids are excluded`; `crossedMilestones 58→82 = [60,70,80]`; `crossedMilestones skips unlocked 70`; `verdict ACCEPTABLE avg 2.0 discipline 0 rate 0.5`; `verdict PATHETIC avg 0 rate 0`; `gym full default MON day = 17.3`; `estimate1RM(100, 5) = 116.67 (2 decimals)`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(engine): shadow, achievements, milestones, verdict, gym`.

### Task 4: Game-state schema

**Files:** Create `lib/db/src/schema/game.ts`, `lib/db/src/schema/gym.ts`; Modify `schema/index.ts`; generate migration; Test `lib/db/src/schema/game.test.ts`.

**Interfaces (tables; `userId uuid → users.id on delete cascade` on every table; text enums validated in app code):**
- `profiles` (pk `userId`): `identitySetting text not null default 'semi-public'`, `primaryGoal text not null`, `biggestWeakness text not null`, `stoppedBefore text`, `morningTime text not null default '07:00'`, `nightlyTime text not null default '21:00'`, `rank text not null default 'E'`, `rankSince timestamptz not null default now()`, `codename text not null`, `onboardedAt timestamptz not null default now()`, `onboardingRatings jsonb not null`, `rankFreezeUntil date`, `rankFreezeUsedMonth text` (`YYYY-MM`).
- `domain_scores` (pk `userId, domain`): `score real not null`, `streak integer not null default 0`, `lastLogDate date`, `updatedAt`.
- `score_events`: `id bigserial pk`, `userId`, `domain text`, `delta real` (requested), `actualDelta real`, `reason text` (`log | forbidden_log | quest_complete | quest_refuse | quest_failed | streak_break | decay | gym | onboarding | challenge | raid`), `refId text`, `localDate date not null`, `createdAt`. Index `(userId, createdAt)`, `(userId, localDate)`.
- `logs`: `id uuid pk`, `userId`, `clientId text not null`, `domain text`, `logType text`, `data jsonb not null default {}`, `freeText text`, `forbidden boolean not null default false`, `occurredAt timestamptz not null`, `localDate date not null`, `isRetroactive boolean not null default false`, `createdAt`. Unique `(userId, clientId)`; index `(userId, occurredAt desc)`.
- `quests` (replaces `generated_quests` for live quests; keep `generated_quest_batches` as the AI audit log and link via `batchId`): `id uuid pk`, `userId`, `batchId integer → generated_quest_batches.id on delete set null`, `type text`, `title`, `description`, `domain`, `status text not null default 'active'` (`active | complete | failed | refused`), `expiresAt timestamptz not null`, `resolvedAt`, `resolvedLocalDate date`, `generatedBySystem boolean not null default true`, `chainId uuid`, `chainStep integer`, `chainTotal integer`, `refusalReason text`, `createdAt`. Index `(userId, status, expiresAt)`.
- `quest_chains`: `id uuid pk`, `userId`, `templateKey text`, `name`, `domain`, `currentStep integer not null default 0`, `totalSteps integer`, `status text not null default 'active'`, `startedAt`, `completedAt`. Unique partial `(userId, templateKey) where status='active'`.
- `shadow_selves` (pk `userId`): `active boolean`, `codename`, `initialScores jsonb`, `gainRates jsonb`, `activatedAt timestamptz`, `resolvedAt timestamptz`, `gapAtActivation real`.
- `achievements` (pk `userId, achievementId`): `unlockedAt not null`.
- `milestones` (pk `userId, domain, tier`): `unlockedAt not null`.
- `notices`: `id uuid pk`, `userId`, `kind text` (`rank_change | achievement | milestone | streak_break | shadow_activated | shadow_resolved | quest_failed | debrief_ready`), `payload jsonb not null`, `createdAt`, `seenAt`. Index `(userId, seenAt, createdAt)`.
- `daily_snapshots` (pk `userId, localDate`): `scores jsonb not null`, `hidden real not null`, `rank text not null`, `createdAt`.
- `user_day_state` (pk `userId`): `lastRolledDate date` (last local date fully rolled), `nextRolloverAt timestamptz not null`, `lastActivityDate date`. Index `(nextRolloverAt)`.
- `debriefs` (pk `userId, localDate`): `deltas jsonb`, `questCompleted int`, `questTotal int`, `verdict text`, `text text`, `model text`, `acknowledgedAt`.
- `idempotency_keys` (pk `userId, key`): `route text`, `responseStatus int`, `responseBody jsonb`, `createdAt`. (Rows older than 7 days are pruned by the worker.)
- `gym.ts`: `exercises` (`id text pk` for seeded `ex_*`, `userId uuid null` for custom, `name`, `primaryBodyPart`, `secondaryBodyParts jsonb`, `isBig5 boolean`); `workout_plans` (`id uuid`, `userId`, `name`, `goal`, `days jsonb` = `{ weekday, blocks: { exerciseId, sets, repRange, restSec, notes? }[] }[]`, `isActive boolean`, `createdAt`); `workout_sessions` (`id uuid`, `userId`, `planId uuid null`, `startedAt`, `completedAt`, `localDate date`, `points real`, `clientId text`, unique `(userId, clientId)`); `performed_sets` (`id bigserial`, `sessionId → workout_sessions cascade`, `exerciseId`, `setIndex`, `reps`, `weight real`, `completed boolean`); `personal_records` (pk `userId, exerciseId`: `value real`, `reps`, `weight`, `achievedAt`); `body_part_scores` (pk `userId, bodyPart`: `points real`, `updatedAt`). Seed the 8 `DEFAULT_EXERCISES` from `artifacts/system-self/features/gym/model/constants.ts` in the migration (`userId` null).

- [ ] **Step 1:** Tests (DB-guarded): `logs (userId, clientId) unique`; `only one active chain per template per user`; `seeded exercises exist after migrate (8 rows with userId null)`.
- [ ] **Step 2–4:** FAIL → schema + `pnpm --filter @workspace/db generate` (hand-append the seed `INSERT` and the partial unique index to the generated SQL if drizzle doesn't emit them) → PASS.
- [ ] **Step 5:** Commit `feat(db): game state schema (profiles, scores ledger, logs, quests, shadow, notices, snapshots, gym)`.

### Task 5: Contracts package, scoring service, onboarding, state endpoint

**Files:**
- Create: `lib/contracts/` (`@workspace/contracts`, zod only; `src/index.ts`, `src/game.ts`), `artifacts/api-server/src/services/user-lock.ts`, `services/scoring.ts`, `services/state.ts`, `services/idempotency.ts`, `routes/onboarding.ts`, `routes/state.ts`
- Test: `artifacts/api-server/src/services/scoring.test.ts`, `routes/onboarding.test.ts`

**Interfaces:**
- Consumes: Task 1–3 engine functions; P1 `createApp`, `requireAuth`, `getTestDb`, `resetDb`.
- `withUserLock<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>`.
- `applyChanges(tx: Tx, userId: string, changes: (ChangeSpec & { reason: ScoreReason; refId?: string })[], ctx: { localDate: string; now: Date }): Promise<{ results: { domain; actualDelta; score; streak }[]; notices: Notice[] }>` — loads domain_scores `FOR UPDATE`, applies each change in order with `applyDelta`, writes `score_events`, updates `user_day_state.lastActivityDate` when any change has `activity`, then unlocks achievements/milestones (writing notices).
- `withIdempotency(req, res, routeKey, handler)` helper: stores and replays responses keyed by the `Idempotency-Key` header (or `body.clientId`).
- Contracts (`lib/contracts/src/game.ts`): `RankedDomainSchema`, `RankSchema`, `OnboardingRequestSchema` `{ ratings: Record<RankedDomain, int 1..10>, primaryGoal: string 5..200, biggestWeakness: RankedDomain, stoppedBefore?: string ≤ 500, identitySetting: "anonymous" | "semi-public" | "public", morningTime: "HH:MM", nightlyTime: "HH:MM", timezone: IANA string }`; `GameStateSchema` `{ profile: { username, codename, rank, rankSince, identitySetting, primaryGoal, biggestWeakness, morningTime, nightlyTime, dayNumber, onboarded: boolean }, scores: { domain, score, streak, lastLogDate }[], tierProgress: number, trajectory, shadow: { active, codename, scores, gap, phase, rank } | null, unseenNotices: Notice[], today: string }`; `NoticeSchema` `{ id, kind, payload, createdAt }`.
- `POST /api/onboarding` (auth) → 201 `GameState`; 409 `{ code: "already_onboarded" }`. Initial scores `rating*4` (unchanged from the app), SOCIAL from `ratings.SOCIAL`; score_events `reason: onboarding`; profile codename `generateCodename("E")`; `user_day_state.nextRolloverAt = endOfLocalDay(today)`; initial `daily_snapshots` row for today. The shadow is **not** activated at onboarding (PRD trigger rules apply).
- `GET /api/state` (auth) → `GameState` (404 `{ code: "not_onboarded" }` before onboarding). Before responding it runs the on-demand catch-up `ensureRolledOver(db, userId, now)` from Task 7 — in this task, stub it as an exported no-op in `services/rollover.ts` that Task 7 fills in.
- `dayNumber` = `daysBetween(localDate(onboardedAt), today) + 1`.

- [ ] **Step 1:** Tests: `applyChanges BODY +2.5 with streak 3 → 3.3 and a score_events row`; `concurrent applyChanges (Promise.all of 2) on one user sum correctly`; `onboarding sets scores rating*4, rank E, no shadow, returns GameState`; `second onboarding → 409`; `GET /state before onboarding → 404 not_onboarded`; `GameState never contains a "hidden" key (deep scan)`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(api): scoring service, onboarding, game state`.

### Task 6: Logs, quests, chains, notices APIs

**Files:**
- Create: `routes/logs.ts`, `routes/quests.ts`, `routes/notices.ts`, `services/quests.ts`, `lib/engine/src/chains.ts` (+ test)
- Modify: `lib/contracts/src/game.ts`
- Test: `routes/logs.test.ts`, `routes/quests.test.ts`

**Interfaces:**
- `lib/engine/src/chains.ts`: `CHAIN_TEMPLATES` = the 4 `PREDEFINED_CHAINS` (copy verbatim from AppContext L252–293, `templateKey` = `physical_protocol | mind_sharpening | wealth_accumulation | discipline_forge`); `chainStepQuest(templateKey, step): { title: string; description: string; domain; type: "arc" }` (title `[NAME] stepTitle`, description `desc\n\nReward: reward`).
- `POST /api/logs` `{ clientId, domain: RankedDomain, logType: string ≤ 40, data?: object (≤ 4 KB JSON), freeText?: string ≤ 2000, forbidden?: boolean, occurredAt?: ISO }` → 201 `{ log, results, notices }`. `occurredAt` older than 48h → 422 `{ code: "retroactive_limit" }` (PRO extension in P7); `isRetroactive` when its local date < today. Replay of a `clientId` → 200 with the same body.
- `GET /api/logs?limit=1..100&cursor` → `{ items, nextCursor }` newest first.
- `GET /api/quests` → `{ active: Quest[], recent: Quest[] /* resolved in the last 2 local days */ }`.
- `POST /api/quests/:id/complete` → `{ quest, results, notices }`; 409 `{ code: "not_active" }` unless active and unexpired. If it is a chain step: advance the chain; create the next step's quest (14-day expiry) or complete the chain (notice `achievement`-style payload `{ chainCompleted: name }` with kind `milestone`? No — use a new notice kind `chain_complete`; add it to the schema enum list in code).
- `POST /api/quests/:id/refuse` `{ reason?: string ≤ 200 }` → `{ quest, penalty, results }`; 409 `refusal_limit` per Global Constraints; the reason is stored in `refusalReason`.
- `GET /api/chains/templates` → `{ templates: { templateKey, name, description, domain, steps }[], active: { templateKey, currentStep }[] }`; `POST /api/chains` `{ templateKey }` → 201 `{ chain, quest }`; 409 `{ code: "chain_active" }`.
- `GET /api/notices` → `{ items: Notice[] }` (unseen, oldest first); `POST /api/notices/seen` `{ ids: uuid[] }` → 204.
- Quest service exports `createQuests(tx, userId, items: { type; title; description; domain; expiresAt: Date; batchId?: number; chainId?: string; chainStep?: number; chainTotal?: number }[])`.

- [ ] **Step 1:** Tests: `log BODY → +2.5, streak 1, first_log achievement notice`; `replayed clientId returns the same response and doesn't double-score`; `log 49h ago → 422 retroactive_limit`; `forbidden log → +5 and −2`; `two logs at 23:50 and 00:10 Asia/Kolkata → streak 2` (set `occurredAt`); `complete quest → +3 DISCIPLINE; again → 409`; `refuse 1st free, 2nd −1.5, 3rd 409 refusal_limit (same ISO week)`; `chain: start → step-0 quest; complete it → step-1 quest exists; finish all 3 → chain complete notice`; `notices seen are not returned again`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(api): logs, quests, chains, notices`.

### Task 7: Rollover service and worker

**Files:**
- Create/replace: `artifacts/api-server/src/services/rollover.ts`, `src/worker.ts`, `src/jobs/run-loop.ts`
- Modify: `artifacts/api-server/build.mjs` (second entry point `src/worker.ts` → `dist/worker.mjs`), `package.json` scripts (`worker`: `node --enable-source-maps ./dist/worker.mjs`, `dev:worker`: `tsx src/worker.ts`)
- Test: `services/rollover.test.ts`

**Interfaces:**
- `rolloverDate(tx: Tx, userId: string, date: string, now: Date): Promise<Notice[]>` — applies the 6 steps of the Global Constraints for one local date; a no-op if `date ≤ lastRolledDate`.
- `ensureRolledOver(db: Db, userId: string, now: Date): Promise<void>` — under `withUserLock`, rolls every date from `lastRolledDate+1` to `yesterday(local)` in order (max 30; if more, roll the 30 most recent with all older days collapsed into one decay step using `decayPerDomain(30)`), then sets `lastRolledDate` and `nextRolloverAt = endOfLocalDay(today)`.
- `claimDueUsers(db: Db, limit: number): Promise<string[]>` — `SELECT user_id FROM user_day_state WHERE next_rollover_at <= now() ORDER BY next_rollover_at LIMIT $1 FOR UPDATE SKIP LOCKED` inside a short transaction that bumps `next_rollover_at` by 10 minutes (lease), returning ids.
- `runWorkerTick(db, now): Promise<{ processed: number }>` → claims up to 200 users and calls `ensureRolledOver` for each; also prunes `idempotency_keys` older than 7 days.
- `worker.ts`: loop every `WORKER_TICK_MS` (env, default 60000), graceful SIGTERM, logs `{ processed, ms }`.

- [ ] **Step 1:** Tests (use injected `now`): `daily quest expired at rollover → failed, −0.8 DISCIPLINE, quest_failed notice`; `streak break penalty includes DISCIPLINE when it broke`; `decay: 1 inactive day → none, 2nd → −0.3 per domain, 5th → −0.6`; `rollover is idempotent for the same date`; `14 snapshots in tier D → promotion E→D with rank_change notice and rank_d achievement`; `rank freeze blocks demotion`; `shadow activates after 5 inactive days`; `catch-up after 10 days processes 10 dates in order`; `two concurrent runWorkerTick calls never process the same user twice` (count score_events reasons).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(api): daily rollover, catch-up, worker`.

### Task 8: Server-built AI context — quest generation, messages, debrief, recap

**Files:**
- Create: `services/ai-context.ts`, `routes/messages.ts`, `routes/debrief.ts`
- Modify: `routes/system.ts` (remove the client-context endpoints `POST /system/message` and `POST /system/quests`; keep the prompt builders, moved into `services/ai-context.ts`), `routes/quests.ts` (add generation), `routes/history.ts` (weekly recap from server data)
- Test: `routes/ai-flows.test.ts` (runs in template mode: no `GEMINI_API_KEY`)

**Interfaces:**
- `buildUserContext(tx, userId, now): Promise<PromptContext>` — username, rank, dayNumber, trajectory, ranked domain scores, active/completed-today quest counts, shadow status/gap, primary goal, last 7 days of logs (`DOMAIN: logType` + freeText truncated to 120 chars), 30-day completion rate, weakest domain, recent refusal reasons (last 5).
- `POST /api/quests/generate` → `{ active: Quest[], generated: boolean }`. Generates at most once per local day (otherwise returns the board with `generated: false`): tops up to 3 active dailies; adds a weekly if none is active; adds an arc if none active and no active chain. Expiry: daily = end of today local; weekly = end of local day +6; arc = end of local day +20. AI output validated with the existing `generateQuestsResponseSchema`; on invalid output or no key use `templateQuests`.
- `POST /api/messages` `{ type: one of the 14 types (+ "weekly_debrief"), extraContext?: string ≤ 500 }` → `{ message, meta }`. `morning_briefing` and `nightly_debrief` are cached per user per local date in `system_messages` (a second call returns the cached one).
- `GET /api/debrief/today` → `{ available: false, availableAt }` before the local `nightlyTime`; otherwise `{ available: true, debrief: { date, deltas, questCompleted, questTotal, verdict, text, acknowledged } }`, built once and stored in `debriefs`. Deltas = current scores − today's start-of-day snapshot. Quest rate = quests resolved today (complete / all resolved today).
- `POST /api/debrief/:date/ack` → 204.
- `GET /api/recap/weekly` → `{ weekStart, domainDeltas (sum of score_events.actualDelta per domain over the last 7 local days), questsCompleted, questsFailed, questsRefused, logsCount, forbiddenLogs, peakDomain, chainsCompleted, achievementsUnlocked }` (all scoped to the last 7 local days).
- `GET /api/recap/weekly/debrief` keeps working from server data.

- [ ] **Step 1:** Tests: `generate twice same day → second returns generated:false`; `generate returns 3 dailies + 1 weekly + 1 arc on an empty board`; `messages morning_briefing cached per day (same text twice)`; `debrief unavailable before nightlyTime, available after, verdict matches debriefVerdict`; `recap counts only the last 7 days`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(api): server-built AI context, quest generation, debrief, weekly recap`.

### Task 9: Gym API

**Files:** Create `routes/gym.ts`, `services/gym.ts`; Modify contracts; Test `routes/gym.test.ts`.

**Interfaces:**
- `GET /api/gym` → `{ exercises, plans, activePlanId, recentSessions (last 20), personalRecords, bodyPartScores }`. On first call, create the default plan "Starter Strength" (MON/WED/FRI blocks exactly as in the inventory) as active.
- `POST /api/gym/plans` `{ name, goal, days }` → 201 plan (validate `exerciseId`s exist, ≤ 7 days, ≤ 12 blocks/day); `PATCH /api/gym/plans/:id` (partial; `isActive: true` deactivates the others).
- `POST /api/gym/sessions` `{ clientId, planId? }` → 201 session; `POST /api/gym/sessions/:id/sets` `{ exerciseId, reps 0..200, weight 0..1000, completed, setIndex? }` → 201; `POST /api/gym/sessions/:id/complete` → `{ session, points, byBodyPart, newPrs, results, notices }` — computes points for the plan day of the session's **local** weekday; 0 points → no score change; otherwise a `gym` score change to BODY (no bonus, activity true) **and** a `logs` row (`domain BODY`, `logType "gym_session"`, `data { sessionId, points }`) without applying the log delta. Completing twice → 409 `{ code: "already_completed" }`.

- [ ] **Step 1:** Tests: `first GET creates the default plan`; `complete MON session with all sets → 17.3 BODY, gym_session log, PR for squat`; `complete twice → 409`; `session on a day with no plan blocks → 0 points, no score event`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(api): gym plans, sessions, PRs, body-part scores`.
