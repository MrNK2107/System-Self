# Decisions log

Every call I made on your behalf while building the product, written as **decision — reason — cost if wrong**. I made them without asking, because you told me to decide for myself. Items that need you are in [HOLD.md](HOLD.md), not here.

## p1-platform-accounts

- Move the AI-table `username`→`userId` change (and its indexes) from T2 into T4 — keeps every commit typechecking — costs nothing if wrong (same end state).
- T3 only ADDS new env vars + Gemini default changes; removal of AUTH_ENABLED/API_AUTH_TOKENS/API_AUTH_REVOKED_TOKENS/ADMIN_API_TOKENS/AUTH_ROTATION_WARNING_DAYS and resolvers happens in T4 — keeps commits green — no cost.
- T2's cascade test checks refresh_tokens and email_codes (system_messages cascade is tested in T4) — follows from the first ruling.
- carry two Task 1 minors into Task 2 — quote test globs (lib/db and api-server `tsx --test "src/**/*.test.ts"`) and add `closeTestDb()` — because Task 3+ add tests in subdirectories that an unquoted glob silently skips — cost if wrong: trivial
- api-server test script also gets --test-concurrency=1 (shared test DB) — carried into Task 3 — cost if wrong: slower tests only
- Task 4 request schemas must enforce password 10..128 (reviewer ⚠️ from Task 3) — carried into Task 4 dispatch
- fold into Task 6: (a) .env.example + DEPLOYMENT.md stale Gemini models/auth vars; (b) rank_up_prep template grammar; (c) routes fall back to templates when Gemini fails after retries (not only when no key) — upstream outage resilience; (d) delete unused lib/integrations-gemini-ai package (nothing imports it; removes last @google/generative-ai); (e) silence pino request logs in tests (LOG_LEVEL=silent when NODE_ENV=test) for pristine output; (f) note migration 0002 hand edit in docs — cost: small scope growth
- Asia/Calcutta canonical spelling accepted (Intl canonical link; equivalent for date math) — never compare timezone strings by equality — cost if wrong: cosmetic
- forgot-password 5/hour cap is reachable unauthenticated (reset DoS for 1h) — accepted for launch; revisit in P8 abuse controls

## p2-server-engine

- future dispatches require captured RED output before implementation (implementers skipped it in T1 and P1) — cost: none
- Task 3 also rounds trajectory diff to 2 decimals before comparing ±1.0 (float edge) — cost none
- trajectory reference = 7 days before newest snapshot; Task 5/7 callers must pass currentHidden consistent with snapshots (state endpoint passes today's hidden with snapshots up to yesterday → reference 8 days back; accepted as "about a week") — cost: cosmetic
- carry into Task 5: update ACHIEVEMENT_DEFS copy "All 4 domains"→"All 5 domains" for all_domains_60 and seven_days_straight (rules use 5 ranked domains) — cost none
- score_events.domain NOT NULL kept — every score change targets one ranked domain (challenge/raid/onboarding all do) — cost: a migration if wrong
- carry into Task 9: index workout_plans(user_id) and exercises(user_id); into Task 7: index idempotency_keys(created_at) for prune
- P4 Task 3 adds exercises in a new migration — it must update game.test.ts's "exactly one exercises INSERT" assertion (seed union) — cost none
- daily_snapshots has no tier column — tier is derived from `hidden` via tierOf; constraint wording "tier" satisfied by derivation — cost none
- pull minors #5 (lastActivityDate monotonic) and #2 (missing-row guard) into fix round 1 because P6 retroactive logs depend on #5 — cost none
- chain step quest refused or failed → chain status 'abandoned' (frees the template for restart) — implement in Task 7 (refuse path in quests service + expiry in rollover) — cost if wrong: user loses chain progress on a refusal
- score reason name `quest_refusal` (existing ScoreReason) accepted in place of plan's `quest_refuse` — cost none
- chain_complete payload { name, templateKey } accepted as the contract — cost none
- carry into Task 7: UPDATE ... WHERE status='active' guard on complete/refuse; GET /quests uses gt(expiresAt, now); NoticeSchema.kind uses NOTICE_KINDS enum (extend with new kinds); 4 KB data limit counted in UTF-8 bytes (TextEncoder)
- mutating game routes (logs, quests complete/refuse/generate, chains, gym complete) call ensureRolledOver before their change, so penalties for past dates always apply in date order — enters Task 7 fix list — cost: one extra cheap query per write
- shadow activated during catch-up for date D starts at min(now, endOfLocalDay(D)) — enters Task 7 fix list — cost none
- rank windows restart after each transition — evaluate only snapshots dated after rankSince local date (PRD "sustained in the new tier for 14 consecutive days"); prevents E→D→C→B daily cascade — cost if wrong: slower multi-tier climbs (14 days per tier)
- pull minors #3 (orphan day-state), #4 (re-tick on full batch), #6 (flush logs), #5 test gaps into fix round 1 — cheap, operational — cost none
- rankSince on transition = end of rolled date (capped at now); onboarding-day snapshot not counted in first window — cost: new users wait one extra day for first promotion
- pull minors 1–7 (prompt delimiting, output cap/voice check, AI cost caching + 20/day message limit, concurrent-generate test, DST availableAt, SOCIAL in legacy schema, gt) into fix round 1 — public-launch hardening — cost: small
- recap achievementsUnlocked/chainsCompleted as counts and domainDeltas excluding onboarding events accepted — cost none
- openapi.yaml + mobile client still reference removed endpoints → handled in P3 (client rewrite) and P8 (delete stale lib/api-spec/api-zod/api-client-react if unused) — cost none
- gym session with 0 points writes no logs row (not activity); >0 points writes a gym_session logs row with no extra log delta — cost: a completed but unplanned session doesn't protect the streak
- rollover grace 2h after local midnight + logs roll only dates before logDate first — fixes offline outbox midnight case instead of accepting it — cost: penalties land up to 2h later
- fix wave includes minors 7–13,16 (scale + consistency); minors 14,15 documented only
- nextRolloverAt = endOfLocalDay(yesterday)+2h while inside grace, else endOfLocalDay(today)+2h (implementer's correct reading) — cost none
- deviate from the single-fix-wave rule for this one load-bearing scoring bug — dispatch one targeted fix + targeted re-review — because the owner delegated all decisions and a scoring hole would ship otherwise — cost: one extra review cycle
- grace applies only to passive catch-up (worker, GET /state, tz hook); any scoring mutation for date X rolls all dates < X immediately (outbox flushes older logs first) — cost: an out-of-order offline log arriving after a newer activity is scored on an already-rolled date (accepted)

## p3-mobile-on-server

- replace manual verification with typecheck + expo export bundling + node smoke scripts against a local API (see global-constraints.md) — cost: UI rendering not visually verified; P8 adds a web smoke where possible
- pull minors (dead code, flushBeforeMutation robustness, poison-item cap 5, body-read timeout, storage errors, retry policy, tests) into fix round 1 — cost none
- carry into Task 2: handleSignIn treats a missing last_user_id as different (clear) — cost: one cold cache on first login after upgrade
- carry into Task 4: UI surfaces outbox failed() items (incl. poison) with RETRY/DISCARD
- no device/web visual QA possible (browser MCP down) → HOLD H-10; rely on bundle + smoke — cost: visual/layout bugs may ship until owner checks
- carry into Task 3: set onboardingStatusKey(userId) query data to "onboarded" after POST /api/onboarding; ApiError should keep server `issues` for 400s (small client change) — Task 3
- carry into Task 3: signOut try/finally (always clears session) + disable row while running; sign-up retries once without timezone on a timezone 400; email max 254 client-side; birth-year onSubmitEditing; hard-coded #3A3D48 → colors token
- carry Task 4 minors 1,2,3,4,7 (log flicker, pending-set invalidation trigger, modal restart memo, context memo, seen >100 ids) + 9 ("all 4 domains" copy) into Task 5; minor 5,6 (recap estimate, ?? 50) belong to Task 6 — cost: small
- carry into Task 6: recap.tsx chain progress uses chain.totalSteps; remove recap log-count × BASE_LOG_DELTAS estimate (server recap replaces it); stats ?? 50 defaults → server values
- early-debrief observation = IST clock vs UTC account (server correct) — no change
- carry into Task 7: NightlyDebriefModal onRequestClose → acknowledge; StreakBrokenModal deps user?.id; sendAcks drops non-retryable 4xx; remove unused lockPill styles; delete legacy scripts/build.js EXPO_PUBLIC_DOMAIN usage if build.js unused (else switch to EXPO_PUBLIC_API_URL)
- persist gym active session + set queue per user and support resume/discard; reuse start clientId; weekday from profile timezone — public-launch data safety — cost: moderate extra work
- carry into Task 8: clearLocalData removes system_self.gym.active.v1.* for the signed-out user — cost none
- unknown notice kinds are skipped but NOT marked seen (so a newer client can show them) — cost: unseen count may include kinds an old client can't render
- fix wave includes all minors M1–M11 incl. cache buster + restored-state validation

## p4-adherence

- carry into Task 2: AI deferral count + quoted reasons use the same 7-day window and only refusals with a reason; floor logIt try/finally; LOG IT enabled only once ≥ 50% of the routine time has elapsed — cost: users who did the routine without the timer must wait/run it
- slots apply to daily BODY quests only (weekly/arc → 409 slot_daily_only) — slot has no date, so multi-day quests would show "missed" every later day — cost: no slot for weekly gym quests
- server slotState is source of truth; device clock only advances within the same local date
- zero-quiet buckets excluded from suggestions (no fabricated quiet hour) — accepted
- carry into Task 4: quiet-hour chips filtered to today's local weekday (slots are daily-only) and labelled by hour
- comeback detection on every activity mutation (logs, gym complete, quest complete) — cost none
- comeback window = 2 local days (startedOn = today), completion evaluated at end of every activity mutation + GET; refused/failed dailies don't block quests_today — cost: slightly easier to earn the mark
- never-logged user ≥5 days after onboarding counts as a comeback — cost none
- carry into Task 6: season date chips computed in the account timezone; settings shows earliest allowed season start (cooldown) — cost none
- baseline stored on profiles (never overwritten) + backfill; rollover snapshot upsert unchanged (rank windows depend on it)
- home sessions count max one per local day toward the gym unlock
- centralize activity side effects (comeback detect/evaluate) in one helper before P5 — cost: refactor of 3 routes
- baseline backfill from earliest snapshot accepted (pre-launch: no real users; new users get exact onboarding scores) — cost none

## p5-social

- social search — public users by username prefix; semi-public ONLY by publicCodename prefix (results show codename); anonymous never — PRD §16 semi-public = codename to the public — cost: semi-public friends must share codenames to be found
- codename search matches the WORD-N part only (strip "USER // ") — prevents listing everyone with "USE"
- reports: one open per (reporter, subject), ≤10/reporter/day; batch projection loading for scale; isSelf on profile
- block/report by anonymous codename keeps 204/201 (codename isn't linked to identity — not a leak)
- carry into Task 2: GameState.profile exposes the user's OWN publicCodename (self only) + settings/profile shows "Your codename" with a copy/share action (semi-public users are found only by codename); partial unique index on user_reports(reporter_id, subject_id) WHERE resolved_at IS NULL
- carry into Task 3: matching pre-sorted in SQL by latest snapshot hidden distance (no id-order bias); projection hides clanTag from rival relation (+test); taunt DTO isGhost + SIM tag on cards/alerts; anonymous users: hide codename share; group rival_passed notices into one modal per rollover batch; ChallengeModal animates only after server success; social job time budget + order by expires_at
- carry into Task 4: ghost taunt model text containing "—" also falls back to template
- clan score null when <3 active members; leaderboard only active clans with ≥3 active (prevents inferring an individual hidden score) — cost: small clans show "—"
- activity window = 5 full local days ending yesterday
- implementer rulings 1,3,4,5,6,7,8,9 accepted (userId to clanmates only; block refuses join; invite code visible to members; last leader disbands; daily repair; dispatches)
- a flagged member with a non-forbidden log today can't be removed today (flag kept)
- carry into Task 5: activeSql excludes forbidden logs (one activity rule); clan race tests replace pause(250) with polling pg_stat_activity for waiting lock count (CI flake risk); toLeaderboardItems asserts non-null score
- score-type raid live values hidden (positions only) until resolved — privacy
- isoWeek % 4 rotation accepted (W53/W01 repeat); mid-week joiners excluded from metrics, counted for bonus multiplier; clan dropping to forming mid-week ineligible to win
- carry into Task 6: fix stale copy (RaidSummarySchema comment "Sunday 23:59" → next Monday 00:00; RAID_TYPE_RULE.body → "BODY logs (gym sessions included)")
- shame disable always allowed; already-opted-in quest still notifies after PRO lapse (user opted in) — cost none
- PRD "accepted challenge visible to both users' clans" → Task 7 adds a clan dispatch to each participant's clan (opponent shown via clanmate/public projection rules) — cost: small
- implementer extras accepted (opponent 3-open limit, one open per pair, try-lock deferral ordering)
- carry into Task 7: named challenge window starts the local day AFTER acceptance (startDate = accept local date + 1) — removes accept-timing gaming; add tests for startFromHistory fallbacks
- carry into Task 7: PRD "accepted challenge visible to both users' clans" — clan dispatch on accept + result to each participant's clan
- duo check-ins of any kind capped at 10 per sender per local day (going_now stays ≤3) — anti-spam — will enter Task 7 fix round
- invite to someone already in a duo → 409 unavailable (mild signal accepted); implementer extras accepted (block dissolves duo, cancelled status, 5 pending cap, block→404)
- rivals exclude clanmates, duo partner, follow relations both ways; re-match when a relation forms (closes open-join comparison)
- dispatch handles rendered at read time; deletion scrubs handles in others' notices to "FORMER OPERATOR"; reports about deleted users kept (SET NULL + handle snapshot)
- activeMemberCount exactness (minor 4) accepted — inherent to the ≥3 ruling
- former members AND deleted users render 'FORMER OPERATOR' in dispatches; outside challenge opponents keep public projection until deleted

## p6-domains-logging

- sleep quality ≤2 at ≥7h = base WITH bonus + separate −0.5 no-bonus change (two changes, spec-literal) — will enter fix round
- unknown logTypes → 400 accepted (pre-launch; old types migrated)
- budgets compare month-to-date spend (through week end) vs monthly limit
- recurring income auto-logs don't score and aren't activity (system-generated); count in summaries/evaluation
- goal contribute is an afterOutbox mutation creating a normal saving log via applyActivityChanges; goal_achieved notice kind
- Task 2 implementer calls 1–6 accepted (user WEALTH log triggers evaluation; verdict in Monday debrief; double precision money; extra recurring endpoints; category pick; recurring excluded from activity metrics; forbidden WEALTH counts in money)
- carry into Task 3: make rivals.test.ts "one open per rival" deterministic (seed/inject ghost RNG) — flaky in full suite
- dedicated logs.system column set only by server; all activity readers use `not system`
- verdict line = most recent evaluated week not yet quoted (quotedAt)
- never run two server test suites concurrently (shared test DB) — controller waits for its own runs before dispatching DB-test work; stale connections must be terminated after killed runs
- peer rating weekKey = rater's local ISO week; ratee evaluated at their week close counting ratings with that weekKey; re-rating same ratee in a week updates; tenure ≥7d both sides; ratings given before leaving still count
- carry into Task 4: peer rating threshold ≥4 ratings; notice drops `count` (avg + delta only) — stronger rater anonymity
- brigading by a ring of aged accounts accepted (bounded ±2/week)
- custom logs are not ranked activity (no lastActivityDate/comeback/decay protection); free ≤3, PRO ≤20
- daily AI-call limits move to a dedicated `ai_usage_daily` counter table (user_id, local_date, name, count; PK on the three) with upsert — retention/purges of analytics_events must never reset a cost control; analytics event may still be emitted separately — cost if wrong: one tiny table
- refund the voice limit on ai_unavailable outcome; log err.message (never audio/transcript) in parseAudio catch — cost if wrong: an outage lets a user retry
- fix minors: keyword parser currency/unit guards + negative tests; double-tap confirm guard; reset audio mode on early release; hoist express.raw; upfront PRO check before recording; assert no usage row on 413/415
- Task 6 — a past-dated log scores its domain delta but never repairs a broken streak, never moves lastLogDate/lastActivityDate backwards, never reverses decay/demotion already applied, and never triggers a comeback — PRO's 30-day window must not become pay-to-win for rank — cost if wrong: PRO backfill feels less rewarding
- chooser sends occurredAt = min(now, end of chosen local day 23:59 in account tz); a day is offered only if that timestamp is ≥ 1 h inside the window (free 48 h / PRO 30 d) — removes offline-queue 422s; cost: near midnight the oldest day may be hidden
- the no-streak-repair ruling covers custom domains too (backdated log into a lapsed gap scores, streak/lastLogDate unchanged) — consistency, cheap
- C1 — logs dated before the user's onboarding local date are rejected 422 { code: "before_onboarding" }; and rolledOver treats null lastRolledDate as onboardDate−1 — nobody backfills a life they hadn't started in the app — cost if wrong: new users can't record yesterday's run
- I1/I2/I4 — weekly WEALTH savings rate uses trailing 28 local days of income/expenses (own, non-system logs plus system recurring income as income) ending at the week close; component skipped (0) when the window has no income; savings target min 0.05 — monthly salaries and late logs then count; cost if wrong: savings responds slower than a weekly view
- I3 — countHomeSession skipped when rolledOver — gym unlock must be earned live
- fix M3 (functional setProposals), M5 (reject reserved clientId prefixes recurring:/goal:), M6 (notSystemLog in AI context + dedupe transcript); park M1 (raw-log readers: free and PRO equal, documented), M2 (proposals dated now), M4 (→ P7 Task 1 usePro), M7 (retry charges; refund-on-503 already), M8 (currency change: add warning copy only if trivial)

## p7-monetization-engagement

- history for free users clamps to 14 days (200, `days` capped) rather than 402 — Task 5's explicit test wins over Task 2's list, and clamping is the friendlier UX — cost if wrong: one status code
- Rank Freeze blocks demotion as well as decay: a frozen user's demotion window does not advance while frozen; promotion still allows — PRD §10 "blocks demotion and decay" — cost if wrong: frozen users promote, which is not pay-to-win (promotion requires real score)
- bonus quests are excluded from completion rate, quest penalties, shadow trajectory and every ranking input — no pay-to-win
- an unexpired admin grant takes precedence over RevenueCat events (webhook still records and stamps, never downgrades or rewrites source); grantEntitlement clears latestEventAt/productId/periodType — admin grants are support/testing overrides — cost if wrong: an admin grant outlives a refund until it expires
- paywall polls billing status (backoff, ~30 s) after purchase/restore; webhook accepts "Bearer <secret>" or raw secret; SUBSCRIPTION_EXTENDED and NON_RENEWING_PURCHASE with expiration are grants; null-expiry grant logs a warning; account deletion scrubs billing_events.payload to {} (keep id/type for replay protection); accessibilityRole link on legal links
- quest-generation prompts keep full context for both tiers — quest quality is not a persona perk and better quests for free users cannot be pay-to-win — cost if wrong: slightly higher free token cost
- fix Important + all minors (display counts, floor link countsForRank, regression tests for raw-SQL exclusions, bump MESSAGE_PROMPT_VERSION and accept same-day cache, bonus excluded from missedSlotQuest)
- quest deadline copy pluralises — count 1 → "1 quest expires tonight." — verbatim PRD template assumed plural; grammar wins — cost: none
- push delivery at-most-once (decide+log before send), receipts skipped — a duplicate notification is worse than a missed one under a 3/day cap — cost if wrong: rare lost push, notice still in-app
- fix all three Important; minors: reminder-off-after-fire writes a reserved log row (cap holds), configure handler at root mount, prune notice_pushes/notification_log > 30 days in run-loop; park token-on-session-expiry (P8 note) and CONCURRENTLY index (fine at size)
- deadline notices not created after 23:00 local and skipped if payload.localDate ≠ today
- a reminder the user re-enables mid-day after events filled the cap may make a 4th notification that day — accepted: user-initiated, not system-initiated spam — cost: rare 4/day
- PRD hex values stay for fills/borders/grid; each state gets an accentText derived for ≥ 4.5:1 contrast on its bg (tested for all four), and useColors().primary returns accentText — PRD colours are a mood, readability is a requirement — cost: text red lighter than PRD hex
- frozen days are excluded from the 7-day demotion window (pause/resume, no reset); promotion counts every day
- frozen days are excluded from the promotion window too (both windows pause) — a freeze must never earn rank — cost: frozen users promote a week later
- no back-to-back freezes: a new freeze may start no earlier than 7 days after the previous freeze's until (plus once per local month); availableFrom = max(next month start, until+1, prevUntil+8) — keeps "7 days" meaning 7 days
- inactiveDays excludes frozen days (decay ramp pauses — "the clock is paused"); chart x by day offset with gaps; drop the dead rankFreezeUntil mirror write and mark columns deprecated; 409 not_onboarded; rank-change markers accepted as "rank band markers"; add a small quest completion trend chart to Stats
- I2 — handle TRANSFER by re-fetching both subscribers from RevenueCat REST (GET /v1/subscribers/{id}) when REVENUECAT_API_KEY is set; without the key log a warning and leave rows untouched (HOLD H-04 note) — cost if wrong: transfers wait for next renewal until key exists
- I3 — push-kind notices are held until the user's local delivery window [max(08:00, morningTime) .. 22:00]; age limit measured from window open
- I5 — server messages set channelId "system-self" now; eas projectId, expo-notifications plugin config and FCM credentials go to P8 Task 5 (HOLD H-03)
- fix minors 1–11 (PRO chart = 365 days with the copy unchanged; DELETE token moves to body; pushes silent; billing_events for null user keeps id/type/timestamp only + 180-day retention; reminder slots reserved only for tokens seen within SCHEDULE_DAYS; CACHE_VERSION p7-5); park 12 (deadline scan scale) to P8 perf task
- delivery window opens no later than 21:00 even if briefing time is later — keeps ≥ 1 h window — cost: none

## p8-production

- P8 also absorbs the parked notes: remove mockup-sandbox from the workspace build (T1), injected clocks for flaky auth token tests (T3), render.yaml Blueprint (T1), push token cleanup on session expiry + analytics_events retention (90 days) + orphaned gym session cleanup (T3 as hardening hygiene) — all were deferred here explicitly
- data export covers every table with a user_id FK (enumerated from the schema at task time, with a test that fails when a new user-owned table is not exported) — keeps export complete as schema grows
- compose uses env_file .env.prod (gitignored) with a README step to copy the example; the env guard rejects any value containing "REPLACE"/"CHANGE"/"example" for JWT_SECRET and webhook secrets in production; CI gets an expo export job with dummy EXPO_PUBLIC_API_URL; drainDelayMs 5 s in production (0 in tests); render.yaml uses envVarGroups and sh -c
- fix I1 (handle session_abandoned like already_completed + "abandoned" reason copy + drop saved sessions >12 h on restore), I2 (client_max_body_size 6m), I3 (drop urlencoded parser — API is JSON-only — and override qs same-major); minors M1 bound overrides at major, M2 sweep takes user lock, M3 cap adherence days at 90, M5 skipVoice tolerant of trailing slash; M4/M6 doc notes in T7; rate-limit shared store parked: document "single-instance rate limits; use Postgres store before >1 replica" in DEPLOYMENT.md (T7)
- fix I-1..I-3 and all minors (export session/device metadata without secrets; logs retention: request logs kept by host provider, disclose IP/UA in privacy.md; name Resend; correct subjectHandle text)
- generate a monochrome notification icon with Pillow (available) rather than parking it — store-blocking visual defect we can fix now
- fix Critical (add dep, boot the built image to /api/healthz as proof); cap reads() concurrency at 4 + add a mixed scenario and run it once; remove switch from .env.example; pass requires achieved rate ≥ 95% of target; T7 CI smoke must boot the image (catches this class)
- the PRD/plan targets are per-scenario and both pass; the mixed run is extra evidence — accept the staggered figure as representative (autocannon's per-second burst is not real traffic) and keep the burst figure published in PERFORMANCE.md — cost if wrong: a synchronized client burst sees ~250 ms p95; horizontal API scaling is the documented remedy
- image is 294 MB per `docker images` (the earlier 215 MB figure was not the same measure) — over the 250 MB constraint; fix: bundle all pure-JS deps with esbuild so the runtime node_modules holds only native argon2 (+ anything truly unbundleable), and measure with `docker images`
- both follow-ups land now as fix round 1 — the goal is public-launch readiness, so "before launch" means this branch
- admin-deletes-admin lock-order deadlock accepted (Postgres aborts one; retry) — vanishingly rare; in-app compact licence list → note under H-06 for counsel
- fix I-1..I-5 as stated; I-6 — authenticated traffic is rate-limited per user id (limiter after auth), auth endpoints keyed by IP+normalised email (10/15 min) with a looser per-IP ceiling (100/15 min) — CGNAT is the norm for the target market — cost if wrong: credential stuffing across many emails from one IP gets 100 tries/15 min (argon2 + per-account email-code caps still bound it)
- fix M-1..M-9, M-11, M-12; M-10 — add worker_last_tick_timestamp_seconds gauge + RUNBOOK alert rule + compose healthcheck now; crash reporting (Sentry) needs an account → new HOLD H-11 with fallback = structured error logs + metrics
- refresh-token prune grace = max(REFRESH_TOKEN_TTL_DAYS, 30) days instead of 7 — reuse detection and orphan push-token pruning need revoked rows that long — cost: slightly more rows
- per-IP auth ceiling mounts before express.json; add --go to dev script/README/HOLD; privacy text "30 days, or the session lifetime if longer"; DEPLOYMENT note on per-account budgets

