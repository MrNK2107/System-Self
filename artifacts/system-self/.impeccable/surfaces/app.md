---
version: 1
slug: "app"
primary_target: "app"
related_targets: []
---

## Scope
The whole SYSTEM // SELF Android app (Expo, `app/`): shell, navigation and every screen. Mode: Operate, with game expression. Code-led (no image generation; owner supplies raster assets from `design/image-prompts.md` into `design/generated/`, placeholders until then).

## Owner decisions (2026-10-20)
- Core complaint: information was cluttered on one page. One job per screen, progressive disclosure.
- Wanted: more anime/game, premium/sleek, bolder. No generic neon blue.
- Palette: Shadow Monarch. Structure: Today / Quests / Log / Arena / Status, approved.
- Tone: cold rewards (progress as System output, no cheerleading).

## Direction contract
THESIS: Solo Leveling's System, rendered as a premium native app: every message THE SYSTEM sends arrives as a framed System window, and each screen does exactly one job. Refuses the category default of a dashboard that stacks rank, stats, briefing and quests on one scroll.

OWN-WORLD: ink-black ground #07060B, nav surface #0E0C15, violet windows rgba(38,28,64,.55) (opaque #1A1430 where they float over content) with a 1px violet frame rgba(176,140,255,.55) and 45° notched corners, bracketed letter-spaced headers "[ STATUS ]". Monarch violet #A879FF only on pressable things and the one hero highlight. Text #F1ECF7 / #B5ACC4. Domains: BODY #E8604C, MIND #4F8FE0, WEALTH #2FA36B, SOCIAL #D4A62A, DISCIPLINE #C77DDB. Chakra Petch for display, numbers and labels; Roboto (the Android system face, Material's default) for body: chosen at build time over Noto Sans so body copy follows the system font-size setting and costs no bundle weight. Four sizes (12/15/20 + one display figure per screen).

STORY: The user opens the app, reads one System line, sees the one thing to do next, does it, and THE SYSTEM answers with a window: "[ QUEST COMPLETE ] +2.5 BODY". Status shows who they are; Arena shows who they're against.

FIRST VIEWPORT: Today: "DAY 12" kicker; a [ MORNING BRIEFING ] window with the System line at 20sp; one NEXT QUEST card (domain chip, title, duration, reward as the display figure, deadline in amber, full-width START, "Mark complete" text action); a quiet "2 more quests today ›" row. Material nav bar with labels; Log is the centre emphasised destination.

FORM: Solo Leveling System windows (candidate 7 of round-1 grounded list, assigned by the roll, user-evolved after two re-rolls toward anime/premium/structure). Raises kept: three-plus-one type sizes; domain colour owns its row tick and chip; 8dp grid; one giant figure per screen; accent only on pressables. seed: 4b358ee1a978ea84

SIGNATURE: System windows as the one moment of drama: [ QUEST COMPLETE ], [ RANK UP ], [ MORNING BRIEFING ] slide in with a typewriter line; the hexagon rank emblem on Status.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved
- Final raster assets (icon, rank emblems, empty states) pending from the owner.
