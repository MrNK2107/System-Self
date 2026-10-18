# P3 — Mobile App on the Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Expo app a client of the P1/P2 API: real accounts, server-owned game state, offline-tolerant logging, and no local scoring. Every existing screen keeps working and keeps its look.

**Architecture:** A small typed API client (`lib/api/*`) over `fetch`, with tokens in `expo-secure-store`, single-flight refresh on 401, and React Query for server state (persisted to AsyncStorage for fast cold start and offline reads). Mutations that must survive offline (logs, gym sets) go through a persisted outbox replayed with their `clientId`. `AppContext` keeps its public `useApp()` shape where it can, but its data now comes from queries and its actions call the API. Server notices drive the existing modals (rank-up, achievement, milestone, streak break, debrief).

**Tech Stack:** Expo SDK 54, expo-router 6, `@tanstack/react-query` 5 (+ `@tanstack/query-async-storage-persister`, `@tanstack/react-query-persist-client`), `expo-secure-store`, `@workspace/contracts` (zod), `@workspace/engine` (display helpers only).

**Spec:** `docs/superpowers/specs/2026-10-19-production-architecture-design.md` §2 items 1, 5 and §6. API contracts: P1 plan Task 4, P2 plan Tasks 5–9. Screen map: `docs/reference/client-engine-inventory.md` §8.

## Global Constraints

- Must run in **Expo Go** (SDK 54). Every new native dependency must be in Expo SDK 54's bundled module list (install with `pnpm exec expo install <pkg>` from `artifacts/system-self`).
- API base URL comes from `EXPO_PUBLIC_API_URL` (full origin incl. scheme, e.g. `http://192.168.1.12:3001`); if unset in dev, derive `http://<Constants.expoConfig.hostUri host>:3001`. `EXPO_PUBLIC_API_TOKEN` and `EXPO_PUBLIC_DOMAIN` are removed.
- No game rule is computed authoritatively on the device. `@workspace/engine` may be imported only for display helpers (`streakMultiplier`, `getStreakTier`-style previews, `ACHIEVEMENT_DEFS`, `MILESTONE_TITLES`, `CHAIN_TEMPLATES` text).
- Five ranked domains appear everywhere domains are listed: BODY, MIND, WEALTH, SOCIAL, DISCIPLINE (SOCIAL color `#B05CD6`, icon Feather `users`).
- Visual language unchanged: existing `constants/colors.ts`, monospace for numbers, corner radius ≤ 4 on new surfaces, no emoji, SYSTEM voice for all copy (second person, no exclamation marks).
- Every screen handles three states: loading (skeleton or the existing spinner style), error (one line in SYSTEM voice + "RETRY"), offline (cached data plus a thin `OFFLINE — CACHED` bar).
- Remove all `@system_self:*` AsyncStorage game keys on first launch of the new version (one-time migration; no import of old local data, since nothing has shipped publicly).
- `pnpm --filter @workspace/system-self typecheck` must pass at every commit.

## Review Focus

1. **Expired refresh token while offline** — the app opens with no network and an expired access token: cached screens render, no logout happens; on reconnect it refreshes once and replays the outbox. (Task 1)
2. **Refresh race** — five requests 401 at once → exactly one `/auth/refresh` call; all five retry with the new token. (Task 1)
3. **Outbox duplicates** — a log sent, response lost, then replayed → the server dedupes by `clientId`; the UI shows one log. (Task 1, Task 4)
4. **Notice ordering** — rank-up + achievement + milestone in one response show one modal at a time, in that order, and each is marked seen only after its modal is dismissed. (Task 4)
5. **Deleted account on another device** — any request returns 401 and refresh fails → the app clears the session and returns to sign-in without a crash loop. (Task 2)

---

### Task 1: API client, session storage, query cache, outbox

**Files:**
- Create: `artifacts/system-self/lib/api/config.ts`, `lib/api/session.ts`, `lib/api/client.ts`, `lib/api/outbox.ts`, `lib/api/query.tsx`
- Modify: `artifacts/system-self/package.json` (add `@workspace/contracts`, `@workspace/engine`, `expo-secure-store`, persist packages), `app/_layout.tsx` (wrap with `QueryProvider`), `.env.example`
- Test: `artifacts/system-self/lib/api/client.test.ts`, `outbox.test.ts` (run with `tsx --test`; add script `"test": "tsx --test lib/**/*.test.ts"`; tests use an injected `fetch` and in-memory storage — no React Native imports in the tested modules)

**Interfaces (Produces):**
- `apiBaseUrl(): string`.
- `interface TokenStore { get(): Promise<Session | null>; set(s: Session | null): Promise<void> }`, `type Session = { accessToken: string; accessTokenExpiresAt: string; refreshToken: string; user: PublicUser }`; `secureTokenStore: TokenStore` (expo-secure-store key `system_self.session`).
- `createApiClient(deps: { fetch: typeof fetch; tokens: TokenStore; baseUrl: string; onSessionExpired: () => void }): ApiClient` with `request<T>(method, path, opts?: { body?: unknown; schema?: ZodType<T>; idempotencyKey?: string; auth?: boolean }): Promise<T>`. Behaviour: attaches `Authorization`; on 401 does one single-flight `POST /api/auth/refresh` and retries once; if the refresh fails with 401 → `tokens.set(null)` + `onSessionExpired()`; network failure → throws `ApiError { kind: "network" }` (never clears the session); non-2xx → `ApiError { kind: "http", status, code?, message }`.
- `api` singleton built from the above in `client.ts`.
- `createOutbox(deps: { storage: KeyValueStorage; send: (item: OutboxItem) => Promise<void> }): Outbox` with `enqueue(item: { clientId: string; method: "POST"; path: string; body: unknown })`, `flush(): Promise<{ sent: number; remaining: number }>` (in order; stops at the first network error; drops items rejected with 4xx other than 408/429, recording them in `failed`), `pending(): OutboxItem[]`. Storage key `system_self.outbox.v1`.
- `QueryProvider` (React Query client, `gcTime` 24h, persisted via the AsyncStorage persister, key `system_self.rq.v1`); `onlineManager` wired to `@react-native-community/netinfo` **only if** it is in the SDK 54 bundle list; otherwise use AppState foreground + a failed-request flag. Flush the outbox on foreground and on reconnect.
- `useOnline(): boolean`.

- [ ] **Step 1:** Write tests: `attaches bearer token`; `401 → refresh → retry succeeds`; `5 concurrent 401s trigger one refresh`; `refresh 401 → session cleared and onSessionExpired called once`; `network error does not clear the session`; `outbox flushes in order and stops at a network error`; `outbox drops a 422 item and records it as failed`; `outbox survives re-creation from storage`.
- [ ] **Step 2:** Run `pnpm --filter @workspace/system-self test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests PASS; typecheck PASS.
- [ ] **Step 5:** Commit `feat(app): typed API client, secure session, query cache, outbox`.

### Task 2: Auth flow and routing gate

**Files:**
- Create: `artifacts/system-self/context/AuthContext.tsx`, `app/auth/_layout.tsx`, `app/auth/sign-in.tsx`, `app/auth/sign-up.tsx`, `app/auth/forgot.tsx`, `app/auth/reset.tsx`, `components/AuthField.tsx`
- Modify: `app/index.tsx` (gate), `app/_layout.tsx` (AuthProvider outermost inside QueryProvider)

**Interfaces:**
- `useAuth(): { status: "loading" | "signed_out" | "signed_in"; user: PublicUser | null; signIn(email, password): Promise<void>; signUp(input: { email; password; username; birthYear: number; acceptTerms: true; timezone: string }): Promise<void>; signOut(): Promise<void>; requestPasswordReset(email): Promise<void>; resetPassword(email, code, newPassword): Promise<void>; refreshUser(): Promise<void> }`. Timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone`. `signOut` calls `/auth/logout`, clears the session, the query cache and the outbox.
- Gate in `app/index.tsx`: loading → existing splash style; signed_out → `/auth/sign-in`; signed_in and `GET /api/state` 404 `not_onboarded` → `/onboarding`; else `/(tabs)`.
- Sign-up copy (SYSTEM voice): header "IDENTIFY YOURSELF." Fields email, password (min 10, show/hide), username (`^[a-z0-9_]{3,20}$`, lowercase as typed), birth year (numeric, 4 digits), a terms checkbox "I accept the Terms and Privacy Policy" whose links open `/legal/terms` and `/legal/privacy` (created in P8; until then they route to a placeholder screen in `app/legal/[doc].tsx` showing "DRAFT"). Server error codes map to inline messages: `email_taken` → "That email is already registered.", `username_taken` → "That codename is taken.", age → "You must be 16 or older."
- Sign-in: email, password; 401 → "Invalid email or password." Links to forgot and sign-up.
- Forgot → reset: email, then the 6-digit code + new password.

- [ ] **Step 1:** Implement the screens and context.
- [ ] **Step 2:** Verify manually against a local API (`docker compose up -d postgres`, `pnpm --filter @workspace/db migrate`, `pnpm --filter @workspace/api-server dev`, `pnpm exec expo start --lan` or `--web` for a quick check): sign up → lands on onboarding; sign out → sign-in; wrong password shows the message; reset with the code from the API log works. Record the steps and results in the report.
- [ ] **Step 3:** Typecheck PASS. Commit `feat(app): accounts — sign up, sign in, reset, session gate`.

### Task 3: Onboarding on the server, profile updates

**Files:**
- Modify: `app/onboarding/assessment.tsx` (add the SOCIAL rating), `identity.tsx` (remove the username field — the username comes from sign-up; keep the identity setting), `calibrating.tsx`, `schedule.tsx`
- Create (server): `artifacts/api-server/src/routes/profile.ts` + test `routes/profile.test.ts`; contract `ProfileUpdateSchema` in `lib/contracts`

**Interfaces:**
- Server `PATCH /api/profile` `{ morningTime?, nightlyTime?, identitySetting?, primaryGoal? }` → `GameState["profile"]`. Validates `HH:MM`.
- Flow: assessment → identity → calibrating (calls `POST /api/onboarding` with ratings, goal, weakness, stoppedBefore, identity, default times `07:00`/`21:00`, device timezone; shows the existing calibration animation while the request runs, minimum 4.4 s; error → SYSTEM-voice retry) → schedule (calls `PATCH /api/profile` with the chosen times) → `/(tabs)`.
- The assessment "what stopped you before" free-text field (PRD §21, optional, ≤ 500 chars) is added.

- [ ] **Step 1:** Write `profile.test.ts`: `PATCH /profile updates times`; `invalid time → 400`.
- [ ] **Step 2–4:** FAIL → implement (server + app) → PASS; app typecheck PASS; manual run through onboarding against the local API.
- [ ] **Step 5:** Commit `feat: server onboarding and profile updates`.

### Task 4: AppContext backed by the server; notices drive modals

**Files:**
- Rewrite: `artifacts/system-self/context/AppContext.tsx`
- Create: `artifacts/system-self/hooks/useGameState.ts`, `hooks/useNotices.ts`, `components/NoticeHost.tsx`
- Modify: `components/LogModal.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/log.tsx`, `components/DomainBar.tsx`, `constants/colors.ts` (SOCIAL color), any component listing the 4 domains

**Interfaces:**
- `useApp()` keeps these members with the same meaning (sourced from `GET /api/state`, `/api/logs`, `/api/quests`): `user` (mapped from `profile` + auth user: `{ id, username, identitySetting, rank, primaryGoal, biggestWeakness, morningTime, nightlyTime, onboardingComplete: true, createdAt, dayNumber }`), `domainScores`, `logs`, `quests`, `questChains`, `shadowSelf` (server shadow mapped to the old shape with `active`, `codename`, `gap`, `phase`), `trajectory`, `loading`, `getDomainScore`, `getWeakestDomain`, `getShadowScores`, `getShadowRank`, `getShadowPhase`, `addLog(entry)` (via the outbox; optimistic append to the logs query), `completeQuest`, `refuseQuest(id, reason?)`, `startQuestChain(templateKey)`, `resetAll` → replaced by `signOut` (remove from screens).
- Removed from `useApp()` (now server notices or gone): `updateDomainScore`, `setUser`, `setQuests`, `initializeShadowSelf`, `computeRank`, `getHiddenScore`, `pendingRankUp`/`acknowledgeRankUp`, `pendingAchievement`/`…`, `pendingMilestone`/`…`, `pendingStreakBreak`/`…`, `setPendingDebrief`, `acknowledgeDebrief`. Screens using `getHiddenScore`/`computeRank` for rank-up prep use `tierProgress` from state instead.
- Rivals, challenges and taunts stay **local** in this phase (P5 moves them to the server); they compare against the server scores. Keep their AsyncStorage keys (`@system_self:rivals`, `challenges`, `challenge_record`, `rival_taunts`) and exempt them from the one-time cleanup.
- `NoticeHost` (mounted once in the tabs layout): shows unseen notices one at a time in the order rank_change → achievement → milestone → streak_break → chain_complete → shadow_activated → shadow_resolved → quest_failed, using the existing modals (`RankUpModal`, `AchievementModal`, `MilestoneModal`, `StreakBrokenModal`, …); marks each seen via `POST /api/notices/seen` after dismissal; `quest_failed` notices are grouped into one modal per batch.
- After any mutation, invalidate `state`, `quests`, `notices`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Manual verification against the local API: log a BODY entry → score and streak update; the first_log achievement modal appears once; offline (stop the API) → logging queues and the OFFLINE bar shows; restart the API → the outbox flushes and the log appears once. Record in the report.
- [ ] **Step 3:** Typecheck PASS. Commit `feat(app): server-backed game state and notice-driven modals`.

### Task 5: Quests, chains, scheduler on the server

**Files:**
- Modify: `app/(tabs)/quests.tsx`, `components/QuestCard.tsx`, `components/QuestChainCard.tsx`
- Rewrite: `hooks/useQuestScheduler.ts` (calls `POST /api/quests/generate` on mount/foreground once per local day; exposes `{ generating, triggerGeneration }`)

**Interfaces:**
- Refuse button opens a small sheet asking "Why not today?" (optional text in this phase; mandatory in P4) and shows the refusal rule: "First refusal this week is logged. The second costs 1.5 DISCIPLINE. There is no third." Server 409 `refusal_limit` → the button is disabled with that line.
- Chains use `GET /api/chains/templates` and `POST /api/chains`; progress shows `currentStep/totalSteps` from the server.
- Remove local failed-event posting; the server handles expiry.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Manual verification: a fresh user gets 3 dailies + weekly + arc; complete one → +3 DISCIPLINE; refuse twice → second shows −1.5; third disabled; start a chain and complete step 1 → step 2 appears.
- [ ] **Step 3:** Typecheck PASS. Commit `feat(app): quests and chains from the server`.

### Task 6: Messages, debrief, recap, stats from the server

**Files:**
- Rewrite: `hooks/useSystemAI.ts` (calls `POST /api/messages`; keeps the per-type fallback strings for network errors), `hooks/useNightlyDebrief.ts` (polls `GET /api/debrief/today` on mount/foreground; ack via `POST /api/debrief/:date/ack`)
- Modify: `app/(tabs)/index.tsx` (one morning briefing call per day; remove the second nightly_debrief "SYSTEM INTEL" call — replace it with the cached nightly debrief text when available, otherwise hide the card), `app/(tabs)/recap.tsx` (`GET /api/recap/weekly` + `/api/recap/weekly/debrief`), `app/(tabs)/stats.tsx` (completion summary without `username`; achievements/milestones from state; remove `resetAll`), `components/StreakBrokenModal.tsx`, `components/ShadowConfrontationModal.tsx`

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Manual verification in template mode (no Gemini key): the dashboard briefing appears and is identical on refresh the same day; after setting nightlyTime to a past time via the schedule screen, the debrief modal appears once; recap and stats render.
- [ ] **Step 3:** Typecheck PASS. Commit `feat(app): messages, debrief, recap and stats from the server`.

### Task 7: Gym on the server

**Files:**
- Rewrite: `artifacts/system-self/features/gym/context/GymContext.tsx` (same `useGym()` member names, backed by `/api/gym`; `logPerformedSet` goes through the outbox)
- Delete: `features/gym/services/gymScoringService.ts`, `prService.ts` (now in `@workspace/engine`); keep `planService.ts` only if still used for display
- Modify: `app/(tabs)/gym.tsx` (the "create plan" button opens a simple plan editor: name, then per weekday pick exercises with sets × reps; replaces the empty-plan button)

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Manual verification: on a Monday-plan day complete all sets → BODY +17.3 and a PR card; on an unplanned day the screen says "No session planned today. Pick a day or log a free session." and a free session logs 0 points.
- [ ] **Step 3:** Typecheck PASS. Commit `feat(app): gym on the server with a plan editor`.

### Task 8: Settings and account management

**Files:**
- Create: `app/settings/_layout.tsx`, `app/settings/index.tsx`, `app/settings/account.tsx`, `app/settings/support.tsx`, `constants/support.ts`, `app/legal/[doc].tsx` (placeholder showing "DRAFT — pending legal review")
- Modify: `app/(tabs)/_layout.tsx` or the stats header (a settings entry point: Feather `settings` icon top-right on the dashboard)

**Interfaces:**
- Settings index rows: Account, Schedule (morning/nightly via `PATCH /api/profile`), Identity visibility, Support ("Need support?"), Terms, Privacy, Sign out.
- Account: email + verified badge; "Verify email" (request code → enter code → `POST /api/auth/email/verify`); change password; **Delete account** (password confirm, SYSTEM-voice warning "This erases every log, score and rank. It cannot be undone.", then `DELETE /api/auth/account` → sign-out flow).
- Support screen: plain, warm-neutral copy (the one place THE SYSTEM's voice is not used): "If you are struggling, talk to someone now." Lists `constants/support.ts` entries: India Tele-MANAS 14416 / 1-800-891-4416, iCall +91 9152987821, International: findahelpline.com, plus "If you are in immediate danger, call your local emergency number." Each row opens `tel:` / the URL.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Manual verification: change schedule → reflected on the dashboard; delete account → returns to sign-in; signing in with the deleted credentials fails.
- [ ] **Step 3:** Typecheck PASS. Commit `feat(app): settings, account management, support resources`.
