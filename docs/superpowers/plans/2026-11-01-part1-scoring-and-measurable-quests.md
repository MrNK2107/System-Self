# Part 1: Slower scoring and measurable quests (implementation plan)

> For agentic workers: executed natively in-session (owner asked to build immediately). Steps use checkbox syntax.

**Goal:** Scores climb at a real-life pace (70s in 1–2 months, S rank no sooner than ~3 months for a user who proves everything), quests carry a difficulty and a measurable target, and quest credit goes to the quest's own domain.

**Architecture:** Pure rules in `lib/engine` (headroom, streak, caps, quest spec inference, completion changes, upkeep), and a pacing simulation test that pins the targets. The server applies daily caps from today's `score_events`, adds daily upkeep at rollover, and stores `difficulty` and `target` on quests (inferred at `createQuests`, the one insert path). The app shows difficulty and target on quest cards. Manual completion stays until the Part 2+ proof methods ship (spec 10a.1).

**Spec:** `docs/superpowers/specs/2026-11-01-proof-and-scoring-design.md` (sections 6, 7, 10a, 12)

## Global constraints
- No attribution trailers in commits; author MrNK2107.
- Existing scores are kept (no recompute).
- Old APKs must keep working: new quest fields are additive.

## Tuned numbers (from a 180-day simulation; see Task 1)
| Name | Value |
|---|---|
| headroom | `max(0.02, (1 − score/100)^1.8)` on positive deltas (onboarding exempt) |
| streak multiplier | `min(1.5, 1 + 0.05 × streak)` |
| quest base by difficulty | easy 2, normal 3.5, hard 5.5 (to the quest's domain) |
| commitment | +0.8 DISCIPLINE per completed quest |
| clean day | +1.2 DISCIPLINE when every non-bonus daily quest of the day is complete |
| daily gain cap | 4 per domain per local day (log, quest, gym, clean-day reasons) |
| log cap | 0.5 per domain per day from self-reported logs (inside the 4) |
| upkeep | −0.1 per domain per rollover day (not during a Rank Freeze; scores keep one decimal) |
| fail penalties | daily 1.5, weekly 4, arc 8 |

## Review focus
1. A domain already at the daily cap: further gains report actualDelta 0 and no crash.
2. Score near 100: gains shrink but never go negative or above 100.
3. Quest rows created before the migration: difficulty defaults to normal, target null, DTO still valid.
4. AI quest text with no number in it: inferred target uses the domain's default, never throws.
5. Bonus quests: still no score events, and not counted for the clean day.

## Tasks
- [ ] 1. Engine: constants, `headroom`, new `streakMultiplier`, `applyDelta(..., { capRemaining })`, `questCompletionChanges(domain, difficulty)`, `upkeepChanges()`, `inferQuestSpec(q)`, and `pacing.test.ts` asserting: all-proven hidden at day 30 in [50,70], day 60 in [68,82], first S day in [90,180]; half-proven day 180 in [45,68]; logs-only day 30 < 30. Update existing engine tests to the new numbers.
- [ ] 2. DB: `quests.difficulty text not null default 'normal'`, `quests.target jsonb`; migration via `pnpm --filter @workspace/db generate`.
- [ ] 3. Contracts: `QuestDifficultySchema`, `QuestTargetSchema`; `QuestSchema` gains `difficulty` and `target` (nullable).
- [ ] 4. Server: `createQuests` stores `inferQuestSpec`; `toQuestDto` maps it; complete route uses `questCompletionChanges` plus clean-day bonus; `applyChanges` enforces the daily and log caps from today's score_events; rollover applies upkeep; ScoreReason adds `clean_day` and `upkeep`. Update server tests.
- [ ] 5. App: quest card and quest sheet show the difficulty and target ("HARD · 45 min").
- [ ] 6. Full suites (engine, db, contracts, server, app), typecheck, commit, push, new APK.
