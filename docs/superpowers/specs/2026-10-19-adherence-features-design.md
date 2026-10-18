# Adherence Features — Design

**Date:** 2026-10-19
**Status:** Draft for review
**Relationship to the PRD:** Additive. `attached_assets/SYSTEM_SELF_PRD_*.md` is not changed. Everything here sits on top of it.

---

## 1. Why this exists

The PRD describes what the user needs: pressure, comparison, a cold SYSTEM that remembers. The founder's own experience shows where that pressure leaks out before it turns into action.

The founder gained weight during the COVID lockdown and, with a busy university schedule, struggles to train consistently. In their words: the pressure *"makes me feel get on it but still find ways to counter it"*. The counter-move is **"I'll do it tomorrow."**

On the last real attempt (about a month before this doc), they went to the gym once after a long gap and it fell apart because:
1. They didn't know what to do after the gap.
2. The place felt wrong; they felt out of place.
3. Other people were training in groups, rotating through machines, which made being there alone awkward.

None of these are motivation failures. The pressure worked; the follow-through had nowhere to land.

**This design closes the escape routes between "I should go" and actually doing it**, for any kind of user, not just students. It also aims to make the app something people feel good using. THE SYSTEM's voice stays cold; the *rules* are built so nobody falls into a hole they can't climb out of.

## 2. Goals, non-goals, anti-goals

**Goals**
- Make "tomorrow" cost something visible, and always offer a smaller "today" instead.
- Make the first gym visit after a gap survivable: the user walks in knowing exactly what to do.
- Make coming back after a break feel like a moment of respect, not shame.
- Fit the user's real life (student, professional, shift worker, parent, etc.) without giving them an excuse.

**Non-goals**
- Rewriting the PRD or changing THE SYSTEM's persona or voice rules.
- Softening tone. No "Great job!", no flame emojis.
- Replacing silent rivals, clans, Shadow Self or Shame Mode. These features add to them.

**Anti-goals (failure even if it technically works)**
- **Anything that changes how rank is earned** (see §3). This is a hard requirement from the founder.
- A feature that becomes a new escape route (e.g. a mode you flip on in the moment to dodge a quest).
- Making the gym-intimidation problem worse, e.g. surfacing other people's gym performance at the moment the user is already feeling judged.

## 3. Hard rule: rankings are untouched

The founder's requirement: *"make sure it doesn't affect the rankings part."*

**Every feature in this doc is rank-neutral.** Concretely:

The ranking rules these features must not touch are the PRD's, as implemented in `lib/engine` (see `docs/superpowers/specs/2026-10-19-production-architecture-design.md` §2 item 3):

1. No change to the hidden score formula, domain weights or DISCIPLINE multiplier.
2. No change to rank thresholds, promotion/demotion rules, or Rank Freeze (PRD §10).
3. No change to decay, quest failure penalties or refusal penalties (PRD §9, §11, §13).
4. No change to the streak multiplier or to how streaks break.
5. No change to rival matching or rival scores.
6. **No new feature grants, removes, multiplies or protects score points.** Score moves only through the paths that exist today: logs and quest outcomes, under the existing rules.
7. New rewards are **non-score**: achievements, marks, SYSTEM lines, unlocks inside the new features. None of them feed the hidden score.

If a builder finds a feature below that can only be built by bending one of these, the feature changes, not the rule.

**No new quest slots (my call).** `completeQuest` always pays +3 DISCIPLINE with the streak multiplier, so any extra quest would be a new source of points. These features **never add quests**. They only shape the *content* of the existing quest slots (3 daily, 1–2 weekly, 1 arc), or they prompt the user to make an ordinary log. A quest that fills an existing slot is completed through `completeQuest` under existing rules. Anything that isn't a quest (floor session, comeback steps) is not completed through `completeQuest`.

**What a "gym quest" is (my call).** Any quest with `domain: "BODY"`. There's no new structured quest type and no API schema change. Finishing a gym session does **not** auto-complete a quest; the two stay separate actions, as they are today.

## 4. Features

Twelve features in four groups.

### Group 1 — Kill "tomorrow"

**1.1 Deferral Ledger**
- Putting off a quest goes through the existing **refuse** path, so the existing refusal penalty applies unchanged.
- New: refusing requires a short typed reason ("why not today?"). It can't be blank; a one-word reason is allowed.
- THE SYSTEM keeps every reason and quotes them back in briefings and debriefs: *"You said 'tomorrow' 4 times this week. Your words: 'too tired', 'too tired', 'after exams', 'tomorrow'."*
- The ledger is visible to the user on a screen of its own (or a section of Stats). It is never shared with rivals or clans unless the user opts in.
- The reasons go into the AI prompt context for messages and quest generation, matching the PRD's "user's own past language" (PRD §13, input 5).

**1.2 Floor Quest**
- When a user defers a BODY/gym quest, THE SYSTEM immediately offers a downgraded version that can be done now: *"Not the gym. 12 minutes. Here. Now."* (e.g. a short bodyweight routine).
- Despite the name, the floor quest is **not a quest** (my call; see §3). It's a prompt with a ready-made short routine. When done, the user logs it as an ordinary BODY log (default) or as a gym session, and it earns exactly what that path earns today. The two paths already pay differently; that's existing behaviour and isn't changed here. No bonus, no `completeQuest`, and it doesn't cancel the refusal penalty.
- The point is that skipping becomes cheaper but never free, and the day never drops to zero by default.
- First version is BODY-only, since that's the founder's problem. Other domains are left to the builder as an extension.

**1.3 The Shadow Goes For You**
- When a quest is deferred, the Shadow Self "takes" that session: the Shadow card shows *"SHADOW completed: Push Day. You did not."* as a running tally.
- **Display and narrative only.** It does not change Shadow scores, the Shadow gap, activation or deactivation. Shadow is not part of rank anyway, but keeping its numbers untouched avoids side effects (e.g. the `beat_shadow` achievement).
- If the Shadow Self isn't active, the line still appears as a dormant "ghost" note. Exact wording is left to the builder within the voice rules.

**1.4 Lock the Slot**
- When a BODY quest is assigned, the user picks an exact time window for it by hand (my call: no timetable import or schedule capture in this work). Quiet-hour suggestions from Scout Reports (2.2) are shown if available.
- **In-app only (my call).** No push notifications: `expo-notifications` isn't installed, and the PRD (§20) caps system notifications and bans reminder-style ones. When the user opens the app after the slot, THE SYSTEM refers to it: *"You chose 17:30. It is 17:42."* Push is a later project.
- Locking a slot changes reminders and messages only. **When the quest fails stays exactly as it is now** (day-end expiry in `useQuestScheduler`).

### Group 2 — Get through the door

**2.1 Dungeon Briefing**
- Before a gym session there is a short mission card, built from the existing Gym module plan (`features/gym`: `WorkoutPlan` / `WorkoutDay` / `WorkoutBlock`):
  - 3–5 exercises in order, with sets, reps and rest
  - a **fallback for each exercise** if the machine is taken (*bench occupied → dumbbell press*)
  - a one-line "how to use it" for each machine
- Framed in Solo Leveling language: you're entering a dungeon with a clear route.
- Works for users without a plan: a sensible default beginner plan is generated or picked.

**2.2 Scout Reports**
- After a session the user can tap how crowded the gym was (quiet / normal / packed). One tap, optional.
- Over time the app learns that gym's quiet hours and suggests them when locking slots (1.4).
- Stored per user. First version has no shared or crowdsourced data.

**2.3 E-Rank Dungeons (home first)**
- After a long gap (or for a new user who opts in), the BODY quests in the existing daily slots are home/dorm sessions. No extra quests (§3).
- **Opt-in and soft (my call).** Returning users are *offered* the home path, not forced onto it. The "lock" only changes which BODY quests get generated. Gym session logging is never blocked, because blocking it would remove a way to earn BODY points.
- The gym "unlocks" (quests start pointing to the gym) after a number of completed home sessions. This is a **dungeon tier inside this feature, separate from E–S rank**, and it is never shown as or confused with rank. The names "E-Rank Dungeon" etc. are flavour. A builder may rename them to avoid confusion (e.g. "Tier I Dungeon").
- Users who already go to the gym can skip straight in.

### Group 3 — Feel good without going soft

**3.1 Harsh Voice, Fair Rules**
- A design principle, not a screen. Every rule in this doc must leave a way back. THE SYSTEM can be cold, but no state should be a dead end.
- Concretely: every failure message is paired with the next available action (floor quest, next slot, comeback quest).

**3.2 Redemption Arc**
- After a broken streak or a gap (threshold left to the builder; suggestion: 5+ days with no BODY log), the next return triggers a comeback sequence:
  - THE SYSTEM acknowledges the return: *"You returned. Most don't."*
  - a short comeback checklist of ordinary actions (e.g. log one BODY session, finish today's quests). My call: this is **not** a quest chain, because quest chains carry DISCIPLINE rewards. It can borrow `QuestChainCard`'s look but pays nothing itself.
  - a **non-score** reward: a "Returner" mark or achievement, which can stack (e.g. "Returned ×3")
- Returning pays **more in recognition than continuing would have, never more in points**. Scoring follows existing rules (§3).

**3.3 Rival = Past You**
- A "Day 1 vs. now" comparison view: the user's current domain scores and body/gym stats (PRs, sessions) next to their own baseline.
- **Baseline source (my call).** Store a new, never-overwritten snapshot: at the end of onboarding for new users, and on first launch after this update for existing users (labelled "since [date]", not "Day 1"). Don't use `STORAGE_KEYS.BASELINE`, which is overwritten daily.
- This is the main comparison for users who are struggling. Silent rivals and leaderboards are unchanged and still there.
- Read-only. No score effect.

**3.4 Party of Two (designed here, built later)**
- **Out of this build (my call).** The API has no user accounts (just static tokens from env vars), so there's no way to find or invite another user. Duo waits for the auth/accounts work in `docs/NEXT_STAGE_EXECUTION_PLAN.md` and gets its own plan then.
- A user can invite one friend as a duo partner.
- Partners see each other's check-ins ("checked in at the gym") and can tap "going now" to nudge the other.
- This deals with the "everyone's in groups" awkwardness: you walk in as a group yourself.
- No score effect, no shared rank. Separate from clans (PRD §15), and no clan is needed.
- Respects the identity setting (GHOST / OPERATIVE / OPEN) for what the partner sees.

### Group 4 — Life-context modes

**4.1 Life Context (set in onboarding)**
- Onboarding adds a "what does your life look like?" step, next to the existing identity and schedule screens.
- Contexts (starting set; the builder may add more):

| Context | How quests fit | Season mode |
|---|---|---|
| Student | slots in timetable gaps | **Exam Season** |
| Working professional | around working hours | **Crunch Week** |
| Shift worker | "today" follows shifts, not the calendar day | — |
| Athlete | fits training blocks | **Competition Week** (taper) |
| Founder / builder | irregular days; floor quest is the default fallback | **Launch Week** |
| Parent / carer | short windows; home sessions are a full path, not just a start | — |
| Traveling | hotel / bodyweight dungeons, no gym needed | **Away Mode** |

- **Contexts shape quests only (my call).** Schedules are not captured (no timetable, shift or work-hours data). The context goes into the quest-generation prompt and slot suggestions.
- **Shift workers (my call).** "Today follows shifts" only changes when quests are *suggested and displayed*. Quest expiry and streak dates stay on the calendar day, as they are now (§3).

**4.2 Season modes**
- A season mode changes the **size and kind** of quests (shorter sessions, home or bodyweight versions). It does **not** change quest count, scoring, penalties, decay, streaks or rank (§3). An Exam Season quest that's missed is penalised exactly like a normal one. It's just smaller and easier to hit.
- THE SYSTEM's tone doesn't change. It does acknowledge the season: *"Exam Season. The volume drops. The standard does not."*

**4.3 Mode switching (my call, not decided with the founder)**
- Season modes are **scheduled ahead**: switching takes effect from the next day, not immediately. This stops a mode being used as an in-the-moment escape.
- A season has a set length (suggestion: up to 14 days) and a cooldown before the next one. Exact numbers are left to the builder.
- Life context (4.1) can be changed in settings at any time; it changes only how future quests are shaped.

## 5. How it gets built

Builds on what exists. No new stack.
- **Mobile:** the existing Expo app (`artifacts/system-self`). State in the existing context pattern (`AppContext`, `GymContext`), saved to AsyncStorage like the rest.
- **AI:** existing API server with Gemini (`artifacts/api-server`). New prompt context: deferral reasons, life context, season mode, comeback status. Prompt version tags bump as they do today.
- **Backend persistence:** only where needed. The deferral reason can go on the existing quest-completion event (`refused` status) as an optional field. Duo (3.4) needs a server-side relationship and check-in feed. That's the only feature here that truly needs new backend work and real user identity, which is why it's deferred (3.4).
- **Identity names:** the spec's GHOST / OPERATIVE / OPEN are the onboarding labels. In code they're `anonymous` / `semi-public` / `public`.

## 6. Left to the builder

- Screen layouts, copy (within the PRD's voice rules), animations.
- Which features ship first. Suggested order, cheapest and highest-impact first: 1.1 Deferral Ledger → 1.2 Floor Quest → 2.1 Dungeon Briefing → 3.2 Redemption Arc → 1.4 Lock the Slot → 4.x Life Context → 1.3, 2.2, 2.3, 3.3. (3.4 Duo is deferred.)
- Thresholds: comeback gap length, home sessions needed to unlock the gym, season length and cooldown.
- The default beginner plan and fallback exercise mapping.
- Whether the floor quest extends beyond BODY later.

## 7. How we'll know it works

- Fewer refusals that end the day at zero BODY activity (floor quest uptake after a deferral).
- More second visits: users who log a gym session after a gap and log another within 7 days.
- Comeback rate: users who return after a 5+ day gap.
- Rank distribution unchanged by these features. A check: rank changes over the same period should still be fully explained by logs and quest outcomes under existing rules.
