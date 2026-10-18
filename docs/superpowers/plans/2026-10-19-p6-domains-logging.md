# P6 — Domains & Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete PRD §8, §18 and §19: structured logs for every domain with PRD score drivers, the Finance module, the SOCIAL domain (including clan peer ratings), CUSTOM domains, free-form text logging parsed by THE SYSTEM, voice logging (PRO), and retroactive logging rules.

**Architecture:** Each log type's score change is decided by one engine function, `logChanges(domain, logType, data, forbidden)`, which replaces P2's two-argument version (same result for the generic types). Finance data lives in log `data` plus three small tables (budgets, goals, net worth). Weekly finance and peer-rating evaluations run inside the user's rollover on the last day of the user's ISO week. Free-form and voice parsing produce *proposals* that the user confirms before anything is logged.

**Tech Stack:** same; `expo-audio` (SDK 54 bundled) for recording.

**Spec:** PRD §8, §18, §19; architecture spec §3 (voice + free-form rows).

## Global Constraints

- Structured log types and their data (validated with zod in `lib/contracts`):
  - BODY `workout` `{ kind: string ≤ 40, minutes 1..600, intensity 1..5 }`; BODY `sleep` `{ hours 0..16 (0.25 steps), quality 1..5 }`; BODY `meal` `{ description ≤ 120, quality 1..5 }`.
  - MIND `focus` `{ minutes 1..600, distraction 1..5, subject ≤ 60 }`; MIND `reading` `{ pages 1..2000 }`; MIND `learning` `{ minutes 1..600 }`; MIND `journal` `{ words 1..20000 }`.
  - WEALTH `income` `{ amount > 0, category, note? }`; WEALTH `expense` `{ amount > 0, category, note? }`; WEALTH `saving` `{ amount > 0 }`; WEALTH `investment` `{ amount > 0 }`.
  - SOCIAL `interaction` `{ kind: "meaningful" | "networking" | "casual", note? ≤ 200 }`; SOCIAL `outreach` `{ count 1..50 }`; SOCIAL `speaking` `{ minutes 1..300 }`.
  - DISCIPLINE `deadline_met` `{ label ≤ 80 }`; DISCIPLINE `routine` `{ label ≤ 80 }`.
  - Any domain `generic` `{}` (the old untyped log), plus the existing special types (`gym_session`, `floor_session`, `home_session`).
- Score drivers (engine `logChanges`; the base is `BASE_LOG_DELTAS[domain]` with streak bonus unless stated):
  - `sleep`: hours ≥ 7 → base; 6 ≤ h < 7 → +1.0 (no bonus); h < 6 → −1.0 (no bonus, still activity). Quality ≤ 2 subtracts 0.5 more (no bonus).
  - `workout`: base × (0.6 + 0.1 × intensity) (intensity 5 = 1.1×), then the streak bonus.
  - `focus`: minutes ≥ 60 → base; 30–59 → base × 0.6; < 30 → base × 0.3; distraction ≥ 4 → × 0.7.
  - `meal`: quality ≥ 4 → +1.0; quality ≤ 2 → −0.5; else +0.5 (all no bonus, activity true).
  - `interaction` meaningful → base; networking → base × 0.8; casual → base × 0.4.
  - `expense`, `income`, `saving`, `investment` → +0.5 each (logging consistency; no bonus); the real WEALTH movement comes from the weekly evaluation.
  - everything else → base.
- Weekly finance evaluation (on the user's ISO-week last rollover, only if ≥ 1 WEALTH log that week): savings rate = (income − expenses) / income (0 if no income). vs `profiles.savingsTarget` (default 0.20): ≥ target → +2.0; ≥ target/2 → 0; else −1.0. Budgets: each category over budget → −0.5 (max −2.0); at least one budget set and none over → +1.0. Reason `finance_week`.
- Peer ratings (SOCIAL, clans only, anonymous): a member may rate up to 5 clanmates per ISO week, 1–5. On week close a ratee with ≥ 3 ratings gets SOCIAL `(avg − 3) × 1.0` (reason `peer_rating`). Raters are never revealed.
- CUSTOM domains: free 3, PRO 20; name ≤ 24 chars; `unit` ≤ 12; each custom log `+2.5` with streak bonus on a separate 0–100 custom score; never part of the hidden score, rank, decay or shadow.
- Currency: `profiles.currency` ISO 4217, default `INR`; amounts stored as numbers in that currency; display uses `Intl.NumberFormat`.
- Retroactive: `occurredAt` up to 48 h back for everyone; up to 30 days for PRO (`isPro`); older → 422 `retroactive_limit`. Retroactive logs count for streaks only on their own local date if that date has not been rolled over yet; otherwise they score but don't change streaks.
- Free-form: text ≤ 1000 chars → `POST /api/logs/parse` → `{ proposals: { domain, logType, data, confidence 0..1 }[] (≤ 3) }`. Without a Gemini key, a keyword parser in the engine produces proposals. Nothing is logged until the client posts the confirmed proposals to `/api/logs` with `freeText` attached.
- Voice (PRO): `POST /api/logs/voice` raw body `audio/m4a | audio/mp4 | audio/aac | audio/webm`, ≤ 5 MB, ≤ 120 s → `{ transcript, proposals }` using Gemini audio input; audio is never stored; no key → 503 `{ code: "ai_unavailable" }`. Microphone permission string (iOS): `THE SYSTEM listens only while you hold the button.`
- The log screen must stay the fastest screen: a structured entry in ≤ 3 taps for the default values (PRD: under 30 seconds).

## Review Focus

1. **Sleep 5 h at streak 9** — the score goes down by 1.0 (not multiplied), and the streak still increments. (Task 1)
2. **Finance week with income 0 and expenses > 0** — savings rate 0 → −1.0 against any positive target; no division by zero. (Task 2)
3. **Peer rating self / non-clanmate / 6th rating** — 403 / 403 / 409 `{ code: "rating_limit" }`. (Task 3)
4. **Voice upload of 6 MB or a non-audio content type** — 413 / 415 before any AI call. (Task 5)
5. **Retroactive log for a date already rolled over** — scores, but the streak and `lastLogDate` don't move backwards. (Task 6)

---

### Task 1: Structured log types and score drivers
**Files:** `lib/engine/src/logs.ts` (+ test; replaces `logChanges` in `scoring.ts`, re-exported), `lib/contracts/src/logs.ts`, `routes/logs.ts`, App `components/LogModal.tsx` (forms per type with one-tap defaults), `app/(tabs)/log.tsx` (history shows type-specific summaries).
**Interfaces:** `logChanges(domain: RankedDomain, logType: string, data: unknown, forbidden: boolean): ChangeSpec[]`; `LOG_TYPES: Record<RankedDomain, { type: string; label: string; defaults: object }[]>`; `summarizeLog(log): string` (e.g. `Sleep 7.5h · quality 4`).
- [ ] Tests for every driver row in Global Constraints with exact numbers (e.g. `workout intensity 5 at streak 0 → 2.8`; `focus 45 min distraction 4 → round1(2.5*0.6*0.7)=1.1`; `sleep 5h → −1.0 activity`), invalid data → 400 → implement → PASS → commit `feat: structured log types and PRD score drivers`.

### Task 2: Finance module
**Files:** schema + migration: `profiles.currency text default 'INR'`, `profiles.savingsTarget real default 0.2`, `budgets` (`userId`, `category`, `monthlyLimit real`, pk both), `recurring_income` (`id`, `userId`, `label`, `amount`, `dayOfMonth 1..28`, `active`), `financial_goals` (`id`, `userId`, `title ≤ 80`, `targetAmount`, `savedAmount default 0`, `deadline date`, `status active|achieved|abandoned`), `net_worth_snapshots` (`userId`, `month text YYYY-MM`, `amount`, pk both); `lib/engine/src/finance.ts` (+ test: `weeklyFinanceChanges(summary, budgets, target)`), `routes/finance.ts`, rollover hook (week close + recurring income auto-logs on `dayOfMonth` as `income` logs with `data.recurring=true`); App `app/finance/index.tsx` (savings rate, budgets per category with spent/limit bars, goals, net worth monthly), `app/finance/budget.tsx`, `app/finance/goal.tsx`.
**Interfaces:** `GET /api/finance/summary?month=YYYY-MM` → `{ currency, income, expenses, savingsRate, target, byCategory: { category, spent, limit|null }[], goals, netWorth: { month, amount }[] (last 12) }`; `PUT /api/finance/budgets` `{ items: { category, monthlyLimit }[] }`; `POST/PATCH /api/finance/goals`; `POST /api/finance/goals/:id/contribute` `{ amount }` (also creates a `saving` log); `PUT /api/finance/net-worth` `{ month, amount }`; `PATCH /api/profile` gains `currency`, `savingsTarget (0..0.9)`. Expense categories (default list): `food, transport, housing, utilities, shopping, entertainment, health, education, subscriptions, other`. The weekly verdict line for the nightly debrief on week close: `You logged {discretionary} in discretionary spending this week against a stated budget of {budget}. Your WEALTH score {moved} {delta} points. The math is not complicated.` (discretionary = shopping + entertainment + food).
- [ ] Tests: savings rate math, budget penalties capped at −2.0, no WEALTH log that week → no evaluation, recurring income posts once per month, goal achieved when saved ≥ target → implement → commit `feat: finance module with weekly WEALTH evaluation`.

### Task 3: SOCIAL domain and peer ratings
**Files:** schema + migration `peer_ratings` (`raterId`, `rateeId`, `weekKey`, `rating int`, pk all three); `routes/social-ratings.ts`; rollover week-close hook; App `app/clan/rate.tsx` (list clanmates, 1–5, "Ratings are anonymous. Rate the output, not the person."), SOCIAL appears in every domain list (already from P3) and in onboarding (P3).
**Interfaces:** `POST /api/clans/ratings` `{ rateeUserId, rating }`; `GET /api/clans/ratings/mine` → `{ weekKey, given: { rateeHandle, rating }[], remaining }`.
- [ ] Tests: limits (Review Focus 3), week-close delta `(avg−3)` with ≥ 3 ratings only, ratee never sees rater ids → implement → commit `feat: SOCIAL peer ratings`.

### Task 4: CUSTOM domains
**Files:** schema + migration `custom_domains` (`id`, `userId`, `name`, `unit`, `logLabel`, `baseline real`, `target real`, `isPublic boolean`, `score real default 50`, `streak`, `lastLogDate`, `archivedAt`), `custom_logs` (`id`, `userId`, `customDomainId`, `clientId`, `value real`, `note`, `occurredAt`, `localDate`; unique `(userId, clientId)`); `routes/custom-domains.ts`; App section in the log modal ("CUSTOM") + `app/custom/[id].tsx` (progress to target).
**Interfaces:** `GET/POST /api/custom-domains` (limit 3 free / 20 PRO → 402 `pro_required` beyond 3), `PATCH`, `DELETE` (archive); `POST /api/custom-domains/:id/logs` `{ clientId, value, note?, occurredAt? }` → `{ score, streak }`. Public custom domains appear on the user's profile projection for followers (name + score only).
- [ ] Tests: 4th domain for free → 402; custom log doesn't create `score_events` for ranked domains and doesn't change hidden score → implement → commit `feat: custom domains`.

### Task 5: Free-form and voice logging
**Files:** `lib/engine/src/parse.ts` (+ test: keyword parser — e.g. "slept 6 hours" → BODY sleep {hours 6, quality 3}; "spent 450 on food" → WEALTH expense {450, food}; "read 30 pages" → MIND reading; "90 min deep work" → MIND focus 90; "called mom" → SOCIAL interaction meaningful), `services/ai-parse.ts` (Gemini JSON output validated against the log-type schemas; drop invalid proposals), `routes/logs.ts` (`/parse`, `/voice`), App `components/FreeFormLog.tsx` (text box + proposal cards with confirm/edit/drop) and a hold-to-record mic button (`expo-audio`, PRO-gated with the paywall link from P7 — until P7, show "PRO" lock).
- [ ] Tests: keyword parser cases above; AI output with an invalid domain is dropped; voice 413/415 (Review Focus 4); parse never writes logs → implement → commit `feat: free-form and voice logging`.

### Task 6: Retroactive logging rules
**Files:** `routes/logs.ts`, `services/scoring.ts` (activity on past dates), App log modal date/time picker (Today / Yesterday / pick up to 2 days back; PRO up to 30).
- [ ] Tests: 47 h ok, 49 h free → 422, 49 h PRO ok, 31 days PRO → 422, Review Focus 5 → implement → commit `feat: retroactive logging limits`.
