# Client game engine inventory (as of 2026-10-19, before the server port)

Source: `artifacts/system-self/context/AppContext.tsx` (1370 lines), `features/gym/**`, `hooks/*.ts`. Line refs are to that commit.
This is the reference for porting the rules into `lib/engine` (P2) and for replacing local state (P3).

## Scoring constants
- `BASE_SCORE_DELTAS` (L397): BODY 2.5, MIND 2.5, WEALTH 2.0, DISCIPLINE 3.0.
- Streak multiplier (L217): `min(2.0, 1.0 + streak*0.1)`, using the streak *before* the update; applied only when the bonus flag is set and delta > 0. `actualDelta = round1(delta*mult)`; score clamped to 0..100.
- Streak tiers (L221): 0 none, 1–2 low, 3–6 mid, 7–9 high, ≥10 max.
- Log (`addLog`): normal → `+BASE[domain]` with bonus. Forbidden → `+5` to its domain (no bonus), then `−2` DISCIPLINE (no bonus).
- Quest complete: `+3.0` DISCIPLINE with bonus. Quest refuse: `−1.5` DISCIPLINE, no bonus. Quest failed: no penalty (gap).
- Gym (`computeGymPoints`): per planned block, `min(block.sets, completedSetsForExercise) * 1.2`, `+1.5` if the block is finished, `+2.0` if every block is finished. Added to BODY with no bonus. Only the primary body part gets body-part points. Sets outside the plan are ignored. Days with no plan score 0.
- PR: Big5 completed sets only; `e1RM = weight*(1+reps/30)`; best per exercise; replaces the record if greater.
- Startup streak break (L700–720): a domain is broken if `streak>0 && lastLog < yesterday` (UTC). `penalty = min(6, 2*brokenCount)` off DISCIPLINE (skipped when DISCIPLINE is itself broken: bug). Broken streaks reset to 0. No other decay exists.

## Rank and hidden score (the "ranking part"; port unchanged)
- `computeHiddenScore` (L489): `(B*0.20 + M*0.20 + W*0.15 + D*0.45) * mult`, mult = 1.1 if D ≥ 75, 0.85 if D < 50, else 1.0.
- `computeRankFromScore` (L473): ≥86 S, ≥71 A, ≥56 B, ≥41 C, ≥26 D, else E.
- Rank only goes up. When the hidden-score rank > `user.rank` and no rank-up is pending → `pendingRankUp {fromRank,toRank,newCodename}`. `user.rank` changes only on `acknowledgeRankUp`, which awards the `rank_<x>` achievement for the target rank only.
- Codename: `${PREFIX} // ${3 base36 upper}-${1..9}`, prefixes E GHOST, D VECTOR, C CIPHER, B PHANTOM, A WRAITH, S ORACLE.
- Trajectory (L482): plain average of the 4 scores, > 55 up, < 45 down, else stable.
- Rank bands for prep UI: E 0–25, D 26–40, C 41–55, B 56–70, A 71–85, S 86–100; the prep panel shows at ≥75% through the band.

## Shadow Self
- `initializeShadowSelf` (onboarding): initial = `min(100, score+12)` per domain, rates BODY 1.4, MIND 1.2, WEALTH 1.0, DISCIPLINE 1.8 per day, codename `SHADOW // <USERNAME>`, active immediately.
- Shadow scores: `min(100, initial + daysElapsed*rate)`, with fractional days. Gap = avg(shadow) − avg(user).
- Phase: DORMANT (inactive); AWAKENED (<3 days and gap<5); HUNTING (<14 days and gap<20); else DOMINANT.
- Shadow rank = rank of the *plain average* of shadow scores.
- Quest-screen pressure: gap > 20 critical, > 10 elevated, > 0 active.

## Achievements (19) and milestones
`first_log` (≥1 log), `streak_7`/`streak_30` (max streak), `quest_10`/`quest_50` (completed quests), `forbidden_log`, `challenge_win`/`challenge_5` (wins), `domain_80`/`domain_100` (any domain), `all_domains_60`, `discipline_master` (D ≥ 90), `beat_shadow` (shadow active and every domain ≥ shadow), `seven_days_straight` (every streak ≥ 7), `rank_d…rank_s` (on rank-up acknowledge). Titles/icons in `ACHIEVEMENT_DEFS` (L184–204).
Milestone tiers 60/70/80/90/100 per domain with titles `MILESTONE_TITLES` (L208–213). Fires on crossing; only one per update (bug: tiers can be lost).

## Quest chains
`PREDEFINED_CHAINS` (L252–293): PHYSICAL PROTOCOL (BODY), MIND SHARPENING ARC (MIND), WEALTH ACCUMULATION CHAIN (WEALTH), DISCIPLINE FORGE (DISCIPLINE), each 3 steps; reward strings are display-only. Starting a chain creates an arc quest (14-day expiry). Bug: completion never creates the next step's quest.

## Quest scheduler (`hooks/useQuestScheduler.ts`)
Generates when the gen record's date ≠ today, the board is empty, or there are no active dailies. Expired active dailies → failed (event posted, deduplicated). Expiries: daily = tomorrow 04:00 local, weekly = +7 days 04:00, arc = +21 days 04:00. Adds a weekly/arc only if none is active. Fallback quests on AI error: "Address your <weakest> score" (daily), "Log your sleep" (BODY daily), "90-minute deep work" (MIND daily), "7-day logging streak" (DISCIPLINE weekly).

## Nightly debrief (`hooks/useNightlyDebrief.ts`)
Triggers on dashboard mount/foreground after `user.nightlyTime` (default 21:00) when not yet done today. Deltas = score − today's baseline. Verdict: PATHETIC if (avg ≤ 0 and questRate = 0) or (avg < −1 and rate < 0.25); ACCEPTABLE if avg ≥ 2.0 and DISCIPLINE delta ≥ 0 and rate ≥ 0.5; else INSUFFICIENT.

## Rivals and challenges (client-simulated)
Two default rivals: `RIVAL // ECHO-7` (D; 52.3/48.1/55.0/49.5; up; shadow off), `RIVAL // PHANTOM-3` (D; 47.8/53.2/44.5/51.0; stable; shadow on).
Daily drift: up `0.35+r*0.45`, down `−(0.25+r*0.35)`, stable `(r−0.5)*0.18`; per domain `baseDrift*(0.4+r*0.6)`, clamped 1..99. Rival composite uses the hidden-score formula. Leaderboard status: THREATENING (ahead and up), AHEAD, CLOSING (within 8 and up), BEHIND.
Challenge: 7 days, one domain; winner = larger gain from start; record wins/losses/draws. (Resolution only at load; no score effect.)

## Onboarding
Assessment: ratings 1–10 per domain (default 5), primary goal (10 presets or custom > 5 chars), weakness domain. Identity: username ≥ 3 chars, identity `anonymous | semi-public (default) | public`. Calibrating: initial score = `rating*4` per domain, shadow at `rating*4+12`. Schedule: morning 05:00–09:00 (default 07:00), nightly 19:30–23:00 (default 21:00).

## AI message types (14)
morning_briefing, nightly_debrief, quest_assignment, rank_change, shadow_self, milestone, failure_response, streak_break, shadow_confrontation, rival_taunt, chain_complete, domain_milestone, forbidden_log, rank_up_prep.

## Known bugs to fix in the port (not ranking changes)
1. The streak increments on negative updates (refuse, forbidden −2, onboarding). It should increment only on positive logging actions in that domain.
2. The DISCIPLINE streak-break penalty is skipped when DISCIPLINE itself broke.
3. Quest chains never advance to the next step.
4. complete/refuse have no status guard.
5. Milestones skip tiers on multi-tier jumps; only one achievement surfaces when several unlock.
6. `dayNumber` is never incremented.
7. Shadow BODY rate inconsistent (default 1.5 vs init 1.4). Use 1.4.
8. Recap counts are all-time instead of weekly.
9. Gym sessions create no log entry.
10. Mixed UTC and local dates. Use the user's timezone everywhere.
11. The API token is bundled in the client (replaced by accounts in P1).
