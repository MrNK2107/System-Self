---
target: System-Self mobile app (all screens)
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 4
target_identity: "file:C:\\Users\\nanda\\Desktop\\projects\\System-Self\\artifacts\\system-self"
timestamp: 2026-10-20T14-51-30Z
slug: artifacts-system-self
---
Method: design review only (detector not applicable, native platform) + independent roast reviewer. Evidence: 107 screenshots of 41 screens from an iQOO Neo 7 (Android 16) via adb.

Heuristics: 1 Status 1 | 2 Real world 2 | 3 Control 2 | 4 Consistency 1 | 5 Error prevention 1 | 6 Recognition 1 | 7 Efficiency 2 | 8 Aesthetic 2 | 9 Recovery 2 | 10 Help 2 = 16/40 Poor. Roast: 4/10.

Verdict: half-authored. Voice + domain colours are product-specific; visual layer is a generic dark card dashboard. Rank (the identity) is a grey letter in a box.

P0 First-run blocking "3 quests expire tonight" modal (lib/game/notices.ts, NoticeHost); no arrival moment after INITIALIZE.
P0 Log sheet: first tap swallowed (15 ScrollViews lack keyboardShouldPersistTaps), parser drops 2nd activity, CONFIRM vs LOG IT (logs default Workout/Strength).
P1 7 unlabeled tabs + duplicate FAB; Log tab is history.
P1 Status contradictions: rank-up prep 80% on day 1 (quests.tsx, stats.tsx), LIVE over SIM rivals, E vs UNRANKED, 0/5 vs 3 quests, recap "seven days" on day 1, Finance "Failing" with no data.
P1 Type/contrast: ~175 styles <=9px, 23 sizes; muted #6B7280 ~3.5-3.9:1; subtle #3A3D48 ~1.7:1 used for copy; heavy letterSpacing.
P1 Android: no ripple, 36dp back targets, content under transparent status bar, double titles.
P2 Domain red doubles as error/CTA red; green negative deltas on rivals.
P2 Dead-end empty states (challenges, duo, log, gym, clan).
Onboarding: welcome text overlaps circle; assessment hint wrong; long; identity question too early.
Keep: SYSTEM voice + typewriter briefing; domain colour system; free-text log with confirm/edit/drop.
