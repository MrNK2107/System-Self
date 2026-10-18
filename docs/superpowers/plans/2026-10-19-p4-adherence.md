# P4 — Adherence Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the adherence design's features (Deferral Ledger, Floor Quest, Shadow Takes Your Session, Lock the Slot, Dungeon Briefing, Scout Reports, Home-First Dungeons, Redemption Arc, Past-You comparison, Life Context, Season Modes) — all rank-neutral.

**Architecture:** Server-side data and rules in the API (new small tables + engine data modules), surfaced through new endpoints and the quest-generation prompt; the app adds cards, sheets and two screens. No feature writes `score_events` except through existing paths (logs, quest outcomes).

**Tech Stack:** same as P2/P3.

**Spec:** `docs/superpowers/specs/2026-10-19-adherence-features-design.md` (binding; especially §3 "rankings are untouched" and the "my call" items). Party of Two (3.4) is P5.

## Global Constraints

- **Rank-neutral (spec §3):** no new code path may call `applyChanges` except `POST /api/logs`, quest complete/refuse/expiry, and gym session complete. Rewards in this plan are notices, marks, unlocks and copy only.
- **No new quest slots:** generation still tops up to 3 dailies, 1 weekly, 1 arc. Features change quest *content* via prompt instructions only.
- **"Gym quest" = any quest with `domain = "BODY"`.**
- Refusal reason becomes **required**: 1–200 chars after trim; otherwise 400 `{ code: "reason_required" }`.
- Floor routines are 8–15 minutes, bodyweight, no equipment. The floor session is logged as a normal BODY log with `logType: "floor_session"` (normal BODY delta, normal streak).
- Home sessions = logs with `logType` in `home_session | floor_session`. Gym unlock after **6** home sessions while the home path is active.
- Comeback threshold: a log arriving after **≥ 5** consecutive local days with zero logs.
- Season length 1–14 days, start ≥ tomorrow (local), cooldown 7 days after a season ends, at most one active-or-scheduled season.
- Life contexts: `student | professional | shift_worker | athlete | founder | parent | traveling`. Season kinds: `exam` (student), `crunch` (professional), `competition` (athlete), `launch` (founder), `away` (any context).
- Copy rules: SYSTEM voice; exact strings given below are verbatim.
- In-app only — no push notifications in this phase (spec 1.4).

## Review Focus

1. **Refusing a non-BODY quest** — no floor offer and no shadow takeover; the reason is still stored. (Task 1)
2. **Comeback on the very first log of a new user** — not a comeback (needs ≥ 5 inactive days *after* onboarding). (Task 4)
3. **Season overlapping an existing season or within cooldown** — 409 `{ code: "season_conflict" }`; deleting a season that already started → 409 `{ code: "season_started" }`. (Task 5)
4. **Slot set on an already-resolved quest** — 409 `not_active`; the slot banner never shows for resolved quests. (Task 2)
5. **Quiet hours with too little data** — fewer than 3 crowd reports → `{ suggestions: [] , needed: 3 - n }`, never a fabricated suggestion. (Task 3)

---

### Task 1: Deferral Ledger, Floor Quest, Shadow Takeover

**Files:**
- Create: `lib/engine/src/floor.ts` (+ test), `artifacts/api-server/src/routes/adherence.ts`, `services/analytics.ts`
- Modify: `routes/quests.ts` (refuse), `services/ai-context.ts` (deferral instruction), `lib/db/src/schema/game.ts` (+ migration), `lib/contracts`
- App: `components/RefuseSheet.tsx` (reason required), `components/FloorQuestCard.tsx`, `app/floor/[routineId].tsx` (timer + "LOG IT"), `app/(tabs)/stats.tsx` (Ledger section), `components/ShadowSelfCard.tsx` (takeover tally)
- Test: `lib/engine/src/floor.test.ts`, `artifacts/api-server/src/routes/adherence.test.ts`

**Interfaces:**
- Engine: `FLOOR_ROUTINES: { id: string; title: string; minutes: number; steps: { name: string; seconds: number }[] }[]` (at least 6 routines, 8–15 min each, bodyweight only); `pickFloorRoutine(seed: string): FloorRoutine` (deterministic by seed = quest id).
- Tables: `shadow_takeovers` (`id uuid`, `userId`, `questId uuid`, `questTitle text`, `localDate date`, `createdAt`); `analytics_events` (`id bigserial`, `userId uuid null`, `name text`, `props jsonb`, `createdAt`; index `(name, createdAt)`).
- `track(db, userId, name, props)` — fire-and-forget insert; never throws to the caller.
- `POST /api/quests/:id/refuse` `{ reason }` (required) → `{ quest, penalty, results, floor: FloorRoutine | null, shadowTook: { questTitle } | null }`; for BODY quests: `floor` set, a `shadow_takeovers` row written, `track("floor_offered")`.
- `GET /api/adherence/deferrals?days=7..90` → `{ items: { questTitle, domain, reason, localDate }[], countThisWeek }`.
- `GET /api/adherence/shadow-takeovers?days=30` → `{ items: { questTitle, localDate }[], count }`.
- Logging a `floor_session` log → `track("floor_completed")`.
- AI context: when deferrals exist in the last 7 days, the morning briefing / nightly debrief prompt adds: `The user deferred N times this week. Quote up to 3 of their reasons verbatim, in quotation marks, as evidence. Do not comment on them beyond one line.`
- Copy: floor card header `NOT THE GYM. {minutes} MINUTES. HERE. NOW.`; ledger header `DEFERRAL LEDGER`; ledger line format `{date} — "{reason}" — {questTitle}`; shadow tally `SHADOW completed: {questTitle}. You did not.`

- [ ] **Step 1:** Tests: `pickFloorRoutine is deterministic and within 8–15 min`; `refuse without reason → 400 reason_required`; `refuse BODY → floor + shadowTook + takeover row; refuse MIND → both null`; `deferrals endpoint returns reasons newest first`; `floor_session log scores the normal BODY delta (2.5 at streak 0)`; `refuse writes no score_events beyond the PRD refusal penalty`.
- [ ] **Step 2–4:** FAIL → implement (server + app) → PASS; app typecheck PASS.
- [ ] **Step 5:** Manual app check: refuse a BODY quest → reason sheet → floor card → timer → LOG IT → BODY score +2.5; Stats shows the ledger; Shadow card shows the takeover.
- [ ] **Step 6:** Commit `feat: deferral ledger, floor quest, shadow takeover`.

### Task 2: Lock the Slot

**Files:** Modify `lib/db/src/schema/game.ts` (+ migration: `quests.slotStart text`, `quests.slotEnd text` as `HH:MM`), `routes/quests.ts`, `services/ai-context.ts`; App `components/SlotPicker.tsx`, `components/QuestCard.tsx`, `app/(tabs)/index.tsx` (slot banner); Test `routes/slots.test.ts`.

**Interfaces:**
- `PATCH /api/quests/:id/slot` `{ slotStart: "HH:MM", slotEnd: "HH:MM" }` (end after start, same day, window ≤ 4 h) → `{ quest }`; 409 `not_active` if resolved; `{ slotStart: null }` clears it.
- `GET /api/quests` includes `slotStart/slotEnd` and a computed `slotState: "none" | "upcoming" | "open" | "missed"` from the user's local now.
- Dashboard banner for `missed` active BODY quests: `You chose {slotStart}. It is {nowHHMM}.` with buttons `GO NOW` (opens the dungeon briefing from Task 3) and `NOT TODAY` (opens the refuse sheet).
- The slot picker shows quiet-hour suggestions from Task 3 when available (render nothing for them until Task 3 lands).
- AI context adds `Locked slot: {slotStart}–{slotEnd}` for active BODY quests.

- [ ] **Step 1:** Tests: `slot set/cleared`; `end before start → 400`; `resolved quest → 409`; `slotState missed when now > slotEnd`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: lock the slot`.

### Task 3: Dungeon Briefing and Scout Reports

**Files:**
- Create: `lib/engine/src/dungeon.ts` (+ test) — exercise how-to lines and fallbacks; migration seeding extra exercises
- Modify: `routes/gym.ts`, `lib/db/src/schema/gym.ts` (`gym_crowd_reports`: `id`, `userId`, `sessionId uuid null`, `level text` `quiet|normal|packed`, `weekday int 0..6`, `hour int 0..23`, `createdAt`)
- App: `app/dungeon/briefing.tsx`, `components/CrowdReportSheet.tsx`, `app/(tabs)/gym.tsx`, `components/QuestCard.tsx` (BODY quests get a `BRIEFING` button)
- Test: `lib/engine/src/dungeon.test.ts`, `routes/dungeon.test.ts`

**Interfaces:**
- Seed exercises added (ids verbatim): `ex_db_press` (chest), `ex_goblet_squat` (quads), `ex_lat_pulldown` (back), `ex_leg_press` (quads), `ex_db_row` (back), `ex_pushup` (chest), `ex_rdl_db` (hamstrings), `ex_db_shoulder_press` (shoulders), `ex_glute_bridge` (glutes), `ex_bodyweight_squat` (quads), `ex_inverted_row` (back), `ex_dead_bug` (core).
- `EXERCISE_FALLBACKS: Record<string, string[]>` — every seeded exercise has 1–2 fallbacks (e.g. `ex_bench → [ex_db_press, ex_pushup]`, `ex_squat → [ex_goblet_squat, ex_leg_press]`, `ex_pullup → [ex_lat_pulldown, ex_inverted_row]`, `ex_deadlift → [ex_rdl_db]`, `ex_ohp → [ex_db_shoulder_press]`, `ex_row → [ex_db_row, ex_inverted_row]`); `EXERCISE_HOWTO: Record<string, string>` — one line, ≤ 120 chars, for every seeded exercise; `BEGINNER_DAY: { exerciseId; sets; repRange; restSec }[]` = goblet squat 3×8–12, db press 3×8–12, db row 3×8–12, dead bug 2×10.
- `GET /api/gym/briefing?date=YYYY-MM-DD` (default today local) → `{ date, source: "plan" | "beginner", blocks: { exerciseId, name, sets, repRange, restSec, howTo, fallbacks: { exerciseId, name }[] }[], estimatedMinutes }` (plan day if the active plan has blocks for that weekday; else `BEGINNER_DAY`); minutes = Σ sets × (45 s + restSec) / 60, rounded.
- `POST /api/gym/crowd` `{ level, sessionId? }` → 201 (weekday/hour from the user's local now).
- `GET /api/gym/quiet-hours` → `{ suggestions: { weekday, hour, quietShare }[], needed: number }`: needs ≥ 3 reports; ranks (weekday, hour) buckets by share of `quiet` (ties → fewer `packed`), top 3.
- Briefing screen header `DUNGEON BRIEFING — {weekday}`; each block row shows the fallback line `If taken: {fallback names joined by " / "}`.
- After completing a gym session, the app offers the crowd sheet: `How crowded was it?` QUIET / NORMAL / PACKED / SKIP.

- [ ] **Step 1:** Tests: `every seeded exercise has howTo and ≥1 fallback that is itself seeded`; `briefing uses the plan day on MON and BEGINNER_DAY on TUE (default plan)`; `estimatedMinutes for BEGINNER_DAY`; `quiet hours needs 3 reports`; `quiet hours ranks quiet share`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: dungeon briefing, fallbacks, scout reports`.

### Task 4: Home-First Dungeons and Redemption Arc

**Files:**
- Modify: `lib/db/src/schema/game.ts` (+ migration: `profiles.homePathActive boolean default false`, `profiles.homeSessions int default 0`, `profiles.returnerCount int default 0`; table `comebacks` (`id`, `userId`, `startedOn date`, `gapDays int`, `checklist jsonb`, `completedAt`)), `routes/logs.ts` (comeback detection, home-session counting), `services/ai-context.ts`
- Create: `routes/comeback.ts`, `lib/engine/src/comeback.ts` (+ test)
- App: `components/ComebackCard.tsx` (dashboard), `components/HomePathOffer.tsx`, onboarding step in `app/onboarding/assessment.tsx` (`Haven't trained in a while? START AT HOME FIRST` toggle)
- Test: `routes/comeback.test.ts`

**Interfaces:**
- Engine: `COMEBACK_CHECKLIST = [ { key: "body_session", label: "Log one BODY session" }, { key: "quests_today", label: "Complete today's quests" }, { key: "two_domains", label: "Log two different domains today" } ]`; `isComeback(lastActivityDate: string | null, today: string, onboardedOn: string): { comeback: boolean; gapDays: number }` (true when `lastActivityDate` exists, is ≥ onboardedOn, and `daysBetween(lastActivityDate, today) − 1 ≥ 5`).
- On a log that is a comeback: create a `comebacks` row; notice kind `comeback` payload `{ gapDays, line: "You returned. Most don't." , offerHomePath: boolean }` (offer when the gap ≥ 14 days or the user has 0 gym sessions).
- `GET /api/comeback` → `{ active: { gapDays, checklist: { key, label, done }[] } | null, returnerCount }`; checklist items evaluate from today's logs/quests; when all done → `completedAt`, `returnerCount += 1`, notice `returner_mark` `{ count, line: "Returned ×{count}." }`. **No score change.**
- `POST /api/profile/home-path` `{ active: boolean }` → profile; when active, the quest prompt adds: `The user is on the home path. BODY quests must be bodyweight sessions doable at home in under 25 minutes. Use the words "home session".`
- Logging with `logType: home_session | floor_session` while active increments `homeSessions`; at 6 → `homePathActive = false`, notice `gym_unlocked` `{ line: "Tier I cleared. The gym is open to you now." }`. Gym logging is never blocked.
- Notices `comeback`, `returner_mark`, `gym_unlocked` are added to `NoticeHost` order after `chain_complete`.

- [ ] **Step 1:** Tests: `first log after onboarding is not a comeback`; `log after 5 empty days → comeback notice, no extra score events`; `checklist completion → returner mark, count 1`; `6 home sessions unlock the gym`; `gym session while home path active still scores`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: home-first dungeons and redemption arc`.

### Task 5: Life Context and Season Modes

**Files:**
- Create: `lib/engine/src/life.ts` (+ test), `routes/seasons.ts`
- Modify: schema (+ migration: `profiles.lifeContext text default 'student'`; table `seasons` (`id`, `userId`, `kind`, `startsOn date`, `endsOn date`, `createdAt`)), `routes/onboarding.ts` + contract (optional `lifeContext`), `routes/profile.ts` (`lifeContext`), `services/ai-context.ts`
- App: onboarding step `app/onboarding/life.tsx` (after identity), `app/settings/life.tsx` (context + season scheduling), dashboard season chip
- Test: `lib/engine/src/life.test.ts`, `routes/seasons.test.ts`

**Interfaces:**
- Engine: `LIFE_CONTEXTS` with `{ key, label, promptLine, seasons: SeasonKind[] }` — prompt lines: student `Fit quests into gaps between classes. Prefer 20–45 minute blocks.`; professional `Fit quests around working hours: before 9, lunch, or after 18.`; shift_worker `The user works rotating shifts. Never assume a 9–5 day. Prefer flexible-time quests.`; athlete `Respect the user's training blocks. Do not add extra hard training on top of planned sessions.`; founder `Days are irregular. Prefer short, high-leverage quests; always offer a minimum version.`; parent `Windows are short. BODY quests must be doable at home in under 20 minutes.`; traveling `No gym access assumed. Bodyweight or hotel-room sessions only.`. `SEASON_LINES`: exam `Exam Season. The volume drops. The standard does not.`, crunch `Crunch Week. The volume drops. The standard does not.`, competition `Competition Week. Taper. The standard does not drop.`, launch `Launch Week. The volume drops. The standard does not.`, away `Away Mode. No gym. No excuse.`; `SEASON_PROMPT_LINE = "A season is active: make every quest smaller (about half the usual effort) and prefer home or bodyweight versions for BODY. Same count of quests."`; `validateSeason(input: { kind; startsOn; lengthDays }, ctx: { today; lifeContext; existing: { startsOn; endsOn }[] }): { ok: true; endsOn } | { ok: false; code: "season_conflict" | "invalid_kind" | "invalid_dates" }`.
- `POST /api/seasons` `{ kind, startsOn, lengthDays }` → 201 season; `GET /api/seasons` → `{ active: Season | null, scheduled: Season | null, availableKinds }`; `DELETE /api/seasons/:id` → 204 (409 `season_started` once started).
- `GameState.profile` gains `lifeContext`, `homePathActive`, `season: { kind, endsOn, line } | null`.
- Quest generation prompt adds the context line and, while a season is active, `SEASON_PROMPT_LINE`. The daily quest **count is unchanged**.
- Season scoring: identical to normal days (missed season quests are penalised normally).

- [ ] **Step 1:** Tests: `validateSeason rejects start today, length 15, overlap, cooldown < 7 days, exam for a professional`; `POST season then GET shows scheduled; after startsOn it is active`; `delete a started season → 409`; `generation with an active season still tops up to 3 dailies`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: life context and season modes`.

### Task 6: Past-You comparison and adherence metrics

**Files:**
- Create: `routes/progress.ts`, `app/(tabs)/rivals.tsx` section `components/PastSelfCard.tsx`, `artifacts/api-server/src/routes/admin-metrics.ts`
- Test: `routes/progress.test.ts`

**Interfaces:**
- `GET /api/progress/past-self` → `{ baselineDate, label: "DAY 1" | "SINCE {date}", baseline: Record<RankedDomain, number>, current: Record<RankedDomain, number>, gym: { sessionsTotal: number; prsImproved: number } }`. Baseline = the earliest `daily_snapshots` row (written at onboarding); label `DAY 1` when it equals the onboarding date.
- Rivals tab: `PastSelfCard` first, titled `YOU // {label}`, five domain rows `baseline → current (+delta)`.
- `GET /api/admin/metrics/adherence?days=30` (admin) → `{ floorOffered, floorCompleted, floorUptake, secondVisitRate, comebackRate, deferralsPerActiveUser }`. Definitions: floorUptake = floor_completed / floor_offered; secondVisitRate = users with a gym/home session after a ≥ 5-day gap who logged another BODY session within 7 days ÷ users with such a session; comebackRate = comebacks with `completedAt` ÷ comebacks.

- [ ] **Step 1:** Tests: `past-self returns DAY 1 baseline from onboarding`; `metrics computes floorUptake from analytics events`; `metrics requires admin`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: past-you comparison and adherence metrics`.
