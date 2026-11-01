# Proof-backed quests and slower scoring

Date: 2026-11-01. Owner: MrNK2107. Status: draft for owner approval.

## 1. Why

Today a quest is "done" when the user taps complete (`POST /quests/:id/complete` checks only ownership and expiry), and every completion gives DISCIPLINE +3 times a streak multiplier of up to 2.0x. With 3 dailies a day, a user starting at 20 reaches DISCIPLINE 100 in about a week. After that the number means nothing, and nothing stops someone ticking quests they never did.

The owner's words: a user "should not feel like they've reached their max potential in just a week". "Just relying on scores or just relying on the fact that I'll complete the task is not going to benefit much." Add "real-time trackers and validation", mapped to real life.

The product (PRODUCT.md) is about an honest gap between who you are and who you said you'd be. A score you can fake, or max out in a week, breaks that promise.

## 2. Goals

1. **Real-life pacing.** Progress is fast early and slow near the top. Targets for a consistent user who proves every quest: DISCIPLINE in the 70s after 1–2 months, rank S (hidden score ≥ 86) after 3–6 months at the earliest. A user who proves half their quests should settle around the middle of the scale.
2. **Proof, not claims.** A scored quest counts only when backed by evidence. The owner's rule is **no partial credit**: a quest is proven or not proven. When one kind of proof fails, the app offers other kinds ("find ways"), never a reduced score.
3. **Real-time tracking.** Workouts, study sessions and money are tracked live while they happen, with a screen showing the evidence building up.
4. **Zero cost.** Everything runs on free tiers, free public data, on-device processing or the owner's laptop (local Ollama `gemma4:latest`, see `start-server.cmd`).

## 3. Non-goals

- iOS. Android only (testers install an APK; iOS needs a paid Apple account).
- Forensic anti-cheat. Rooted phones and determined cheaters can fake sensors. The goal is that honest effort is easy to prove and casual faking is harder than doing the activity.
- The RBI Account Aggregator network. It requires a licensed financial entity to receive bank data and is not free. Leave a slot for it (section 9.5), but don't build it.
- Reading SMS. The owner rejected it: many users, including the owner, get no bank SMS.

## 4. Anti-goals (a failure even if it technically works)

- Proof that is more annoying than the activity itself: forms, many taps, or a photo of every rep.
- Silent failure: tracking that stops in the background without telling the user, then denies a quest they really did.
- Raw personal data (location trails, payment notifications, statements) sitting on the server.
- A score that still hits the ceiling within weeks.
- Quests the app can't verify still being generated as scored quests.

## 5. Constraints

- Monorepo: `lib/engine` (pure scoring logic plus tests), `lib/db` (Drizzle schema), `lib/contracts` (shared zod types), `artifacts/api-server` (Express API, worker), `artifacts/system-self` (Expo SDK 54 app, expo-router).
- New native capabilities (location, sensors, Health Connect, notification access, on-device OCR) mean those features **no longer run in Expo Go**. Testing them needs an APK from EAS (free plan, limited builds a month; the `share` profile in `eas.json`). Local Windows release builds fail (HOLD H-10). Batch native changes to save builds.
- The server is the owner's laptop on a Tailscale Funnel (`https://phantom.tailabe292.ts.net`). The server may be offline at times, so the app must queue proofs and send them later (there is already an outbox for logs).
- India-first: ₹, UPI apps (GPay, PhonePe, Paytm, BHIM, bank apps).
- Commits must carry no attribution trailers. The only contributor is MrNK2107.

## 6. Part A — Scoring rebalance (engine)

All in `lib/engine/src/scoring.ts`, `constants.ts`, and the callers listed in the code map (`logs.ts:205`, `quests.ts:309`, `gym.ts:387`, finance, peer ratings, challenges).

1. **Diminishing gains.** A positive delta is scaled by how much headroom is left: `gain = base × headroom(score)`, where headroom falls from 1 at score 0 towards a small floor near 100. Starting proposal: `max(0.1, 1 − score/100)`. Losses are not scaled.
2. **Quest credit goes to the quest's own domain.** A proven workout quest raises BODY, a study quest MIND, and so on, plus a small DISCIPLINE amount for keeping the commitment. Today all completions go to DISCIPLINE. *(My call: it matches real life better and stops DISCIPLINE from being the only thing that moves.)*
3. **Difficulty tiers.** Each quest has a difficulty (easy, normal, hard), with a higher base for harder ones. Starting proposal: 1.5 / 3 / 5.
4. **Lapses cost more than single wins.** A failed daily costs more than a proven daily earns at mid-range scores. Starting proposal: daily −2, weekly −4, arc −8. Keep the existing refusal rules.
5. **A gentler streak.** Slower ramp, capped at 1.5x instead of 2.0x.
6. **Daily cap.** A cap on total positive gain per domain per day, so one huge day can't jump a user up.
7. **Pacing is a test, not a guess.** Add an engine simulation test that runs simulated users for 180 days (all quests proven, half proven, a burst then quitting) and asserts the pacing targets in Goal 1. The builder tunes the numbers above until the simulation passes.
8. **Existing users keep their scores.** No retroactive recompute. New rules apply from deploy.

**Self-reported logs.** Free-form and voice logs stay (they are the core loop), but because they are unverified they earn little: a small per-domain daily cap. Proven quests and proven sessions earn the bulk. *(My call, flagged for the owner in section 12.)*

## 7. Part B — Measurable quests

Quests today carry only a title and description. Targets like "25 minutes" are prose.

1. Add structured fields to quests and generated quests:
   - `difficulty`
   - `target`: `{ kind, metric, value, unit }`. Kinds: `workout`, `steps`, `study`, `money_save`, `money_cap`, `no_spend`, `social_meet`. Examples: `{workout, active_minutes, 30, min}`, `{study, minutes, 45, min}` plus a topic chosen at start, `{money_cap, spent, 1500, INR}` per week.
   - `proofMethods`: the allowed methods, in order.
2. The AI generator (`services/quests.ts`) and templates (`lib/ai-fallback.ts`) must output these fields. Validate with zod and fall back to templates on bad output, as today.
3. **Every scored quest must have at least one proof method the user can actually use**, given which permissions they've granted. If a quest kind can't be proven for this user (for example a money quest with no money tracking enabled), don't generate it as a scored quest. Offer the matching setup instead ("Turn on money tracking to unlock WEALTH quests").
4. Existing active quests at deploy keep the old manual completion until they expire.

## 8. Part C — Proof system

### 8.1 Model

- New table `quest_proofs`: `questId`, `userId`, `method`, `status` (`pending`, `accepted`, `rejected`, `awaiting_review`), a summary JSON (no raw traces), a reason text shown to the user, and timestamps.
- `POST /quests/:id/complete` requires an accepted proof for scored quests. Verdict functions are pure and live in `lib/engine` (for example `verifyWorkout(summary, target, places)`), so they are unit-testable. The server re-runs the verdict on the summary and never trusts a client "accepted" flag.
- On rejection, the user sees exactly what was missing and which other methods are still open. Example: "Phone still for 38 min and not at a known gym. Save this place as your gym, or ask a clan member to vouch."
- The completion window ([ QUEST COMPLETE ]) lists the evidence: "Proof: 41 active min · at Gold's Gym · 3,120 steps".

### 8.2 Live sessions (the real-time tracker)

One live-session screen used for workouts and study, building on `workout_sessions` (it already has startedAt and completedAt).

- **Start:** one tap from the quest ("START"). Android runs a foreground service with a persistent notification ("THE SYSTEM is watching · 12:04"), so tracking survives the screen turning off.
- **Live screen:** timer, active minutes, steps, at-a-known-place status, and the quest target with progress towards it.
- **Workout sensors (on the phone):**
  - step counter;
  - accelerometer summarised into "active minutes" (one-minute windows whose movement variance is above a threshold);
  - location sampled at start, every few minutes and at the end.
- **Upload:** only a summary goes to the server: duration, active minutes, steps, the matched place id or none, minimum distance to that place, and a flag if a mock location was detected (reject mocked fixes).
- **Workout verdict:** proven if the duration meets the target **and either**
  - active minutes reach a threshold share of the target (moving workouts, runs), **or**
  - the phone was at a known gym or sports place for most of the session (phone in a locker).

### 8.3 Known places (gym detection)

The owner's rule: if the phone is in a locker, the locker is at a gym, so use the coordinates. Three sources, checked server-side:

1. **Saved places:** the user saves "my gym", "my ground", "my library" (coordinates and a radius). These are stored on the server.
2. **OpenStreetMap:** a free public map. Query the Overpass API for gyms, sports centres, pitches, stadiums, swimming pools, and libraries and colleges for study. Cache results per map tile so each area is fetched rarely, and respect Overpass rate limits.
3. **Learned places:** when sessions from at least 3 different users cluster within about 75 m over 30 days, mark the spot as a learned place of that kind (gym or study). For this, sessions report a coarse location (rounded to roughly 100 m), never exact trails.

### 8.4 Health Connect (optional)

If the user grants it, read exercise sessions and steps for the session window (watch and fitness-app data). An exercise session in Health Connect that covers the quest target is accepted proof.

### 8.5 Study sessions and the quiz

1. Start a study session with a topic (free text, for example "Thermodynamics, 2nd law"). The timer runs as in 8.2. Location is used only to match a study place if one exists; it isn't required.
2. When it ends, THE SYSTEM gives a quiz on the topic: 5 questions, a mix of multiple choice and short answers. Generated by the local model; short answers are graded by the model.
3. **When the AI is down:** use a stored question bank (seed data in the repo) organised by subject and topic, covering at least the common school, college and programming subjects. *(My call: start with about 15 subjects × 30 questions; the builder can generate the seed with the local model and commit it.)*
4. **When the topic isn't in the bank:** ask the user to explain the topic in their own words (a few sentences). The proof goes to `awaiting_review`, and the worker grades it with the AI when it's back. The quest stays pending, not failed, until graded. Grading finishes within 24 h or before the quest's expiry, whichever is later.
5. **Pass mark:** 3 of 5, or a passing explanation. Questions must be specific enough that a session timer alone can't pass them.

### 8.6 Vouching (friend or clan)

The owner likes this as another proof method; it is full proof, not partial credit.

- **Who can be asked:** a clan member, a duo partner, or a mutual follow.
- **Request:** the requester sends one from the quest with a short note ("Football with me, 6–8 pm"). The voucher gets a notice and push and taps Confirm or Deny. Requests expire in 24 h.
- **Eligibility, the owner's rule:** a voucher is eligible only if their own quest that day is proven. If their quest is itself proven only by a vouch, follow the chain upward until it reaches someone proven directly (sensors, place, Health Connect, quiz or money data). The chain is at most 3 people deep. No direct proof at the top means the vouch doesn't count.
- **Limits:** each person can confirm at most a few vouches a week (proposal: 3). The same pair can't vouch for each other more than once a week in each direction. *(My calls: the numbers.)*
- **Co-location** strengthens social quests: if both people run a live session at the same time, within about 100 m of each other, that alone is proof. The existing duo check-ins (`duoCheckins`) can carry this.

### 8.7 Money (optional, private, free)

Points are based on **consistency, not amount**: ₹200 counts the same as ₹20,000.

1. **Live: payment-app notifications.** With the user's permission (Android notification access), read notifications only from an allowlist of finance apps: GPay, PhonePe, Paytm, BHIM and major bank apps.
   - Extract the amount and the direction (paid or received) on the phone.
   - Keep transactions only on the phone. Upload daily totals: spent, received, and moved to savings (transfers to payees the user labels on-device as "my savings").
   - The notification text never leaves the phone. Some custom Android code is needed (a native module); whether to use an existing library or a small in-repo module is the builder's call.
2. **Paused tracking is visible.** Android and battery savers revoke background access. The app checks that the listener is alive. If it isn't, it shows "Money tracking paused. Tap to turn back on." and falls back to options 3–4. A day with tracking paused can't prove a `no_spend` quest.
3. **Statement upload.** The monthly bank statement (PDF or CSV) is shared to the app and parsed into totals, then the file is deleted immediately. Where parsing happens is the builder's call; the file must never be kept.
4. **Screenshot.** A UPI receipt or balance screenshot is read by on-device text recognition (free, offline), then checked for amount, date and own-account payee.
5. **Bank sync slot.** Money proof sits behind a single interface, so a licensed Account Aggregator provider can be added later without changing quests.

## 9. Privacy

- Every tracker is opt-in, with a plain-words screen explaining what is read, what stays on the phone and what is sent. *(My call: the owner didn't answer the "what makes friends uninstall" question, so these are defaults.)*
- **Never on the server:** raw location trails, notification text, statements, screenshots.
- **On the server:** session summaries, saved places, coarse (~100 m) session locations for learned places, daily money totals, quiz results.
- Data export and account deletion (existing features) cover all new tables.
- Legal text (HOLD H-06) must mention location, activity, notification access and the local AI. Flag it in `docs/HOLD.md`.

## 10. Order of work

Each part ships on its own. Parts 2–6 need an EAS APK to test.

1. Scoring rebalance plus measurable quests (A and B, no native code). Self-reported logs get capped.
2. Live sessions and workouts: sensors, location, known places (OSM, saved, learned), live screen, proof model.
3. Study sessions: quiz, question bank, awaiting-review grading.
4. Vouching with the proof chain, and co-location.
5. Money: notification listener, paused detection, statement and screenshot.
6. Health Connect.

## 10a. Calls made after the builder review (mine, not the owner's)

1. **Switch-over per quest kind.** Until a kind's proof method ships, quests of that kind keep manual completion under the new scoring (Part A). When the part for that kind ships, its quests switch to proof-only. A flag per target kind (`proofRequired`) controls this, so `/complete` is gated kind by kind, not all at once. The pacing simulation models the end state, where everything is proof-only.
2. **Quest families with no target kind:**
   - **DISCIPLINE quests** ("log every day", "complete a quest every day for 21 days") are no longer generated. DISCIPLINE now rises from keeping commitments: a small amount per proven quest, plus a "clean day" bonus when every daily quest that day is proven. It falls on failures, refusals and streak breaks as today. Goal 1's DISCIPLINE target is measured with this model.
   - **Home bodyweight sessions and Floor routines** become `workout` quests proven by a live session (active minutes; at home, no place needed).
   - **Chain steps** take the target kind of their step.
   - **User-created custom quests** are scored only if the user picks a target kind; otherwise they're unscored, like PRO bonus quests today.
   - **Challenges, raids and dungeons** score through the proven quests and sessions underneath them, never on their own claims.
3. **Weekly and arc quests.** Proof is recorded per session. A weekly or arc `target` adds a count and a window (for example 4 workout sessions of 30+ active min within the ISO week). Every accepted session proof counts towards all open quests it matches, so one session can prove a daily and count towards a weekly. A weekly or arc quest fails only when its window ends unmet, not on the first missed day.
4. **Study quiz when the server is offline.** The question bank lives on the server, never in the APK, so answers can't be read out of the app. If the server is unreachable when a session ends, the session summary is queued (outbox), and the quiz opens when the app reconnects. It must be taken within 12 h of the session ending, or the session expires unproven. The quest stays pending in the meantime.

## 11. Left to the builder

The exact scoring numbers (tuned to pass the pacing simulation), thresholds (active-minute variance, place radius, mock detection), the Overpass tag list and caching, library choices for each native capability, question-bank contents and format, screen layouts (following `artifacts/system-self/DESIGN.md` and `.impeccable/` rules), and the migration details.

## 12. Decisions on the open questions (made by Claude; the owner said to build without further questions)

- **Self-reported logs** keep giving points, capped at a small daily amount per domain.
- **SOCIAL** is proven only by a vouch or co-location. No call-log reading. Users with no friends on the app see "Invite someone to unlock SOCIAL quests" instead of social quests.
- **Rank** keeps all five domains. A domain the user never turns on stays at its value and still counts, so the gap stays honest. The pacing targets in Goal 1 are measured for a user with every tracker on.
