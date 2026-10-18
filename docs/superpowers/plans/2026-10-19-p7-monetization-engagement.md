# P7 — Monetization & Engagement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRD §20 (notifications), §17 (adaptive UI), §22 (freemium) and §10 Rank Freeze, plus full score history — with no pay-to-win.

**Architecture:** Entitlements stay server-side (`entitlements` table from P5), now fed by a RevenueCat webhook; the app uses RevenueCat's SDK only to purchase/restore and shows a graceful "store build only" state inside Expo Go. Notifications: daily briefing/debrief reminders are local scheduled notifications (Expo Go compatible); event notifications are server pushes via the Expo Push API from the worker, capped at the PRD's 3 system notifications per user per local day. The adaptive UI state is computed by the server and applied through a theme provider.

**Tech Stack:** `react-native-purchases` (+ `react-native-purchases-ui` only if in the SDK 54 compatible set; otherwise a custom paywall), `expo-notifications`, `expo-haptics`, `expo-device`.

**Spec:** PRD §10, §17, §20, §22; architecture spec §2 item 4 (no pay-to-win), §3 (payments, notifications rows); HOLD H-04.

## Global Constraints

- **No pay-to-win:** PRO never changes rank rules, score deltas, decay, or matching fairness. Anything PRO adds that could score is either non-scoring or available to free users in the same form.
- PRO feature list (and the only gates): S-rank is **not** gated (architecture ruling); bonus quests (up to 3 extra dailies per day, flagged `bonus: true`, **no DISCIPLINE reward or penalty**); full SYSTEM persona (free messages use the base context and ≤ 60% of max words; PRO gets the full context incl. past-log references and quoted words); adaptive UI (all 4 states; free = STABLE); named challenges (P5); rival identity reveal; clan creation (P5); full history (free 14 days, PRO 365 days); retroactive > 48 h (P6); Rank Freeze; voice logging (P6); Shame Mode (P5); priority rival matching (PRO users are matched first in each matching run); custom domains beyond 3 (P6).
- Prices (display fallback when RevenueCat offerings can't load): `₹499 / month`, `₹3,999 / year`. Entitlement id `pro`. Product ids `system_self_pro_monthly`, `system_self_pro_annual`.
- Webhook: `POST /api/billing/revenuecat`, header `Authorization: Bearer ${REVENUECAT_WEBHOOK_SECRET}` (constant-time compare); `app_user_id` = our user id; events: `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `UNCANCELLATION` → pro until `expiration_at_ms`; `CANCELLATION` → keep until expiration; `EXPIRATION` → free; `BILLING_ISSUE` → keep until expiration; unknown → 200 ignored. Idempotent by `event.id` (`billing_events` table).
- Notification cap: ≤ 3 system-initiated per user per local day, counting the morning and nightly reminders if enabled. Event priority for the remaining slot(s): `rank_change` > `shadow_activated` > `rival_passed` > `raid_result` > `quest_deadline_24h` > `challenge_result` > `duo_checkin`. Lower-priority events that day are dropped (they stay as in-app notices). No streak reminders, no motivational quotes, no badge counts.
- Notification copy (verbatim): morning `SYSTEM // SELF — Day {n}. Your briefing is ready.`; nightly `The day is over. Your verdict is waiting.`; rank promotion `Rank promotion. {from} → {to}.`; demotion `Rank demotion. {from} → {to}. Your score fell below threshold for 7 consecutive days.`; shadow `Shadow Self initialized. Gap: {gap} points. It will not wait for you.`; rival `{codename} moved past you in {domain}.`; raid `RAID RESULT — Week {n}. Your clan placed {pos} of {count}.`; quest deadline `{count} quests expire tonight.`
- Adaptive UI states (server `uiState`): `FALLING` (shadow active and trajectory down), `PEAK` (rank A or S and trajectory up), `CLIMBING` (trajectory up), else `STABLE`. Colors (PRD §17): FALLING bg `#0A0A0A` accent `#8B0000`; STABLE bg `#111318` accent `#3A7BD5`; CLIMBING bg `#0D1B2A` accent `#00D4FF`; PEAK bg `#0A0E17` accent `#E8D5A3` with a subtle grid texture. SYSTEM text typewriter speed per char: FALLING 45 ms, STABLE 25 ms, CLIMBING 18 ms, PEAK 20 ms. Free users always get STABLE.
- Haptics on: quest completion, rank change, Shadow Self activation, nightly verdict delivery (PRD §17).
- Rank Freeze (PRO): 7 days, once per calendar month (user's local month); blocks demotion and decay while active; line `Rank Freeze active. The clock is paused. You are not.`

## Review Focus

1. **Webhook replay / out-of-order events** — the same event id twice is ignored; an `EXPIRATION` older than the latest `RENEWAL` doesn't downgrade. (Task 1)
2. **Expo Go** — opening the paywall in Expo Go never crashes; it shows `Purchases are available in the store build.` (Task 1)
3. **Notification cap with morning + nightly enabled** — only one event push per local day, the highest priority one. (Task 3)
4. **Freeze twice in a month** — 409 `{ code: "freeze_used" }`; a freeze starting on the 30th that runs into the next month still counts for the month it started. (Task 5)
5. **Bonus quests** — completing or failing a bonus quest writes no `score_events`. (Task 2)

---

### Task 1: Billing — RevenueCat webhook, entitlements, paywall
**Files:** schema + migration `billing_events` (`id text pk` = RevenueCat event id, `userId`, `type`, `payload jsonb`, `receivedAt`), `entitlements` gains `productId`, `periodType`, `latestEventAt`; `routes/billing.ts`; `services/entitlements.ts` (source `revenuecat`); env `REVENUECAT_WEBHOOK_SECRET`; App `lib/purchases.ts` (wraps `react-native-purchases`; in Expo Go (`Constants.executionEnvironment === "storeClient"`) or without `EXPO_PUBLIC_REVENUECAT_IOS_KEY`/`_ANDROID_KEY` it's a no-op returning `{ available: false }`), `app/paywall.tsx` (PRO feature list from Global Constraints in SYSTEM voice; monthly/annual; restore; terms/privacy links), `hooks/usePro.ts` (from `GET /api/billing/status` → `{ tier, expiresAt, source }`).
- [ ] Tests (server): auth header required; INITIAL_PURCHASE → pro with expiry; replay ignored; EXPIRATION after RENEWAL in time order handling (Review Focus 1); unknown user id → 200 + logged. → implement → commit `feat: billing webhook, entitlements, paywall`.

### Task 2: PRO gates
**Files:** `services/entitlements.ts` (`requirePro` used by every gated route listed in Global Constraints that exists so far: clans create, named challenges, shame mode, voice, retroactive > 48 h, custom domains > 3, history > 14 days, rank freeze, rival reveal, bonus quests), `routes/quests.ts` (`POST /api/quests/bonus` → up to 3 bonus dailies per day, `bonus: true`; complete/fail/refuse bonus quests write no score events and don't count in completion rate), `services/ai-context.ts` (free vs PRO context depth and word limits), rival matching order (PRO first), `GET /api/rivals` reveal for PRO viewers when the rival is `public`. App: a `ProLock` component wrapping gated entry points → paywall.
- [ ] Tests: each gate 402 for free and 2xx for PRO; bonus quest no score events; free message prompt excludes past-log quotes; PRO matched first → implement → commit `feat: PRO gates without pay-to-win`.

### Task 3: Notifications
**Files:** schema + migration `push_tokens` (`id`, `userId`, `token unique`, `platform`, `createdAt`, `lastSeenAt`), `notification_prefs` (`userId pk`, `morning boolean default true`, `nightly boolean default true`, `events boolean default true`), `notification_log` (`id`, `userId`, `localDate`, `kind`, `sentAt`); `services/push.ts` (Expo Push API `https://exp.host/--/api/v2/push/send`, batches of 100, handles `DeviceNotRegistered` by deleting the token), worker step `dispatchPushes` (from new notices of the push kinds, applying the cap and priority); `routes/push.ts` (`POST /api/push/tokens`, `DELETE /api/push/tokens/:token`, `GET/PUT /api/notifications/prefs`); `quest_deadline_24h` notice created by the worker at local 18:00 when ≥ 1 active quest expires tonight. App `lib/notifications.ts` (permission request after onboarding with the SYSTEM-voice explanation `THE SYSTEM speaks twice a day. Allow it.`; local daily schedules for morning/nightly times, rescheduled when the times or prefs change; push token registration skipped in Expo Go on Android), `app/settings/notifications.tsx`.
- [ ] Tests: cap and priority (Review Focus 3); invalid token cleanup; prefs off → no pushes of that kind → implement → commit `feat: notifications with PRD cap`.

### Task 4: Adaptive UI and haptics
**Files:** `services/state.ts` (`uiState` in `GameState`, STABLE for free), App `context/ThemeContext.tsx` (palette per state; replaces direct `constants/colors.ts` background/accent use in the tab screens), `components/SystemMessage.tsx` (typewriter speed per state), `components/GridTexture.tsx` (PEAK), haptics in quest completion, rank-up modal, shadow activation notice, debrief modal.
- [ ] Tests (server): state matrix per rule; free → STABLE. Manual app check of all 4 palettes via an admin-only debug override `?uiState=` on `GET /api/state` (admin role only). → implement → commit `feat: adaptive UI states and haptics`.

### Task 5: Rank Freeze and score history
**Files:** `routes/rank-freeze.ts` (`POST /api/rank-freeze` `{ reason ≤ 120 }` PRO → `{ until }`; `GET` status), `services/rollover.ts` (decay skipped while frozen — already wired to `rankFreezeUntil`), `routes/history.ts` (`GET /api/history/scores?days=` → daily snapshot domain scores and rank, never the hidden score; free capped at 14, PRO 365; `GET /api/history/quests?days=` → completion trend), App `app/(tabs)/stats.tsx` history charts (react-native-svg line per domain, rank band markers), freeze button in Stats with the PRD line.
- [ ] Tests: Review Focus 4; history payload has no `hidden`; free requesting 90 days gets 14 → implement → commit `feat: rank freeze and score history`.
