# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users
Ages 16–32, India-first. Highly self-aware, competitive, dissatisfied with their current output; familiar with anime (Solo Leveling, One Punch Man, Classroom of the Elite), gaming or productivity culture. They have tried habit trackers, journals and finance apps and found them too soft; they want to be held to account, not nudged. Secondary: competitive athletes, students, young professionals, founders. Not for people in active mental-health crisis (a crisis resource link lives in Settings → Need support).

The daily job: tell THE SYSTEM what you did (log), take the quests it issues, see where you stand against your past self and rivals, and come back tomorrow.

## Product Purpose
A "Life Operating System": every dimension of life is logged, scored (five domains: BODY, MIND, WEALTH, SOCIAL, DISCIPLINE, plus custom domains), ranked (E → D → C → B → A → S) and judged by THE SYSTEM, framed as a transmission from the user's future self. Success: users keep logging daily and become "unwilling to be mediocre" because the gap between who they are and who they said they wanted to be is visible.

## Positioning
Ego and comparison as the engine, not encouragement: hidden composite score, a Shadow Self (the version of you that didn't stop), silent rivals matched at the same starting point, clans with dead-weight flagging, rank that only moves on sustained performance (14 days to promote, 7 to demote).

## Operating Context
Used on a phone, often one-handed, in short sessions: a morning briefing, logging after an activity (typed or voice), checking quests, a nightly debrief. Logging is the core loop. Notifications are capped (PRD: 3/day).

## Capabilities and Constraints
- Expo (SDK 54) React Native app in `artifacts/system-self`, expo-router; server-backed (API in `artifacts/api-server`). Expo Go is the dev runtime; store builds through EAS.
- Features that exist and must survive a redesign: email auth, intake onboarding (assessment, objective, weakness, identity visibility, life context, schedule), home briefing, free-form + voice logging (PRO voice) with Confirm/Edit/Drop proposals, manual log form, Forbidden Log, quests (daily, bonus, weekly, arcs, refusal, lock-the-slot, briefing), gym tracker (plans, floor sessions, dungeon briefing, Big-5 PRs), rivals (SIM/ghost rivals, rival challenges, taunts, Shadow Self), clans (create/join/rate/raids), following/search/profiles, named challenges (PRO), Party of Two (duo), finance (budgets, goals, net worth, recurring income), custom domains, weekly recap, settings (account, life, notifications, support), PRO paywall (RevenueCat; ₹499/month, ₹3,999/year), legal docs, data export and deletion.
- Terminology: THE SYSTEM, domains, rank, Shadow Self, quests, Forbidden Log, clan, raid, rivals (SIM = simulated).

## Brand Commitments
- Name: SYSTEM // SELF.
- Voice (binding): THE SYSTEM speaks in second person, sparse, cold, no filler, no "Great job!", praise is rare and minimal ("That was acceptable."). References the user's own goals and logs. Time-aware.
- Tone decision (owner, 2026-10-20): **cold rewards**. Progress is shown as system output (e.g. "+2.5 BODY. Logged.", a rank that visibly reacts, scores that tick) — feedback without cheerleading. No confetti-style celebration, no emoji.
- The PRD's visual rules (four adaptive states Falling/Stable/Climbing/Peak, ≤4px corners, monospace numbers, no warm gradients) are a reference, not binding: the owner allows changing them as long as the result is an improvement. The adaptive-state idea (the interface reacts to performance) is part of the product concept.
- Five domain colours exist and are recognised by both reviews as an asset.

## Evidence on Hand
- PRD: `attached_assets/SYSTEM_SELF_PRD_1777727383321.md`.
- Critique of 2026-10-20 (16/40; roast 4/10): `.impeccable/critique/`.
- No real users, testimonials, metrics or press exist yet; do not fabricate any. Rivals shown to new users are simulated and must be labelled as such.
- Images: no image-generation API may be used (owner, 2026-10-20). When images are needed, write prompts to `artifacts/system-self/design/image-prompts.md`; the owner generates them and drops results into `artifacts/system-self/design/generated/`.

## Product Principles
1. The gap is the product: always show where the user stands against their past self, their goal and their rivals, honestly.
2. Never lie in status: no progress, rank-up or "live" claim the data doesn't support.
3. Logging must be the fastest thing in the app.
4. Cold, not cruel: consequences are information, never shaming of empty states or mental-health breaks.
5. Feedback is earned and shown as system output.

## Accessibility & Inclusion
Readable at phone distance for a young audience on mid-range Android phones: text meets WCAG AA contrast, touch targets ≥48dp, labels on navigation, works with larger system font sizes. Crisis resources reachable from Settings.
