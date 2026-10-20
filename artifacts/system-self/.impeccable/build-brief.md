# Build brief: SYSTEM // SELF redesign (shared by every screen agent)

Read first: `PRODUCT.md`, `.impeccable/surfaces/app.md` (direction contract), and the reference sketches
`.impeccable/mocks/decision/aw-monarch-today.png`, `aw-monarch-status.png`, `aw-monarch-quests.png` (Read them as images).

## The owner's core complaint
"Information should not be cluttered in one page; it should be structured properly." Every screen does ONE job.
Secondary content moves behind a tap (a row with a chevron, a detail screen, a bottom sheet). If a screen today
shows five things, pick the one it exists for, keep it prominent, and move or collapse the rest. Never delete a
feature: relocate it and keep it reachable.

## The world (Shadow Monarch / System windows)
- Use the kit in `components/ui/`: `Screen` (app bar + scroll, keyboard-safe, pads for the tab bar with `tab`),
  `IconButton`, `SystemWindow` (THE SYSTEM's messages and the STATUS panel only, not every card), `Button`
  (filled / tonal / text / destructive, 48dp, ripple), `ListRow` (64dp rows with a domain dot, subtitle, trailing,
  chevron), `Segmented`, `RankEmblem`. Read each before use. Do NOT edit files in `components/ui/`, `constants/`,
  `hooks/useColors.ts`, `hooks/useLogSheet.tsx`, `app/(tabs)/_layout.tsx` or `app/_layout.tsx`; if the kit lacks
  something, build it locally in your own files and say so in your report.
- Colours: only `useColors()` tokens (`background, foreground, card, panel, frame, surface, primary,
  primaryForeground, accentFill, muted, mutedForeground, subtle, border, destructive, warn, success, domain.*,
  rank.*`). Replace every hard-coded hex in your files (old palette: #E05555, #3A7BD5, #4B8B6F, #C4873A, #8B1A1A,
  #6B7280, #1A1D24 ...). Domain colours come from `DOMAIN_COLORS` / `colors.domain`.
- Type: only the roles in `constants/type.ts` (`type.label` 12 caps, `type.meta` 12, `type.body` 15,
  `type.bodyStrong`, `type.title` 20, `type.number` 20, `type.display` for the single hero figure of a screen).
  No other font sizes. No fontSize below 12. letterSpacing only via `type.label`. Remove "SpaceMono"/"monospace".
- Spacing on the 8dp grid (`space` in constants/type.ts). More space above a section than below its heading.
- Buttons/rows/icons: touch targets >= 48dp, `android_ripple` feedback (use the kit). Replace TouchableOpacity in
  your files with the kit or `Pressable` + ripple.
- Banned (craft floor): small caps "kicker"/eyebrow labels sitting above a heading; coloured left borders thicker
  than 1px on cards/rows; cards nested in cards; same-size icon+heading+text card grids as structure; emoji or
  unicode glyphs as icons (use Feather); gradient text; decorative glow (glow only on the rank emblem); a modal
  for something that doesn't need to interrupt.
- Copy: keep THE SYSTEM's voice (cold, terse, second person). Plain words for UI labels. Remove jargon that isn't
  explained (e.g. "SHADOW GAP 0.0" needs a one-line meaning or a tap-to-explain).
- Empty states: one System line plus one primary action, never a red "failing" or a dead end.
- Honest status: never show a claim the data doesn't support (no "80% to promotion" on day 1, no "LIVE" over
  simulated rivals, no "seven days reviewed" before day 7).
- Android: system Back must work; no content under the status bar (the `Screen` app bar handles it).

## Structure (approved)
Tabs: Today (`app/(tabs)/index.tsx`), Quests (`app/(tabs)/quests.tsx`), Log (centre; opens the log sheet via
`useLogSheet().openLog()`), Arena (`app/(tabs)/arena.tsx`: Rivals / Clan / Challenges via `Segmented`), Status
(`app/(tabs)/status.tsx`: STATUS window; tap a domain for its detail; BODY detail links Gym, WEALTH links
Finance; settings gear in the app bar; links to log history, achievements, recap). Non-tab routes now live at
`/gym`, `/stats`, `/history`, `/rivals`, `/clan`.

## Rules of engagement
- Only edit the files you own (listed in your task). Ask nothing; decide, and list decisions in your report.
- Keep every behaviour, API call, query key and test passing. Pure logic lives in `lib/` with tests: if you change
  logic (e.g. an honesty fix), change it in `lib/` and update/add a test there.
- When done: `npx tsc -p tsconfig.json --noEmit` from `artifacts/system-self` must show no errors in YOUR files
  (other agents are editing in parallel; ignore errors in files you don't own), and
  `npx tsx --test --test-concurrency=1 "lib/**/*.test.ts"` must pass for tests touching your logic.
- Do not commit. Do not run the dev server or touch the phone.
- Report: files changed, what moved where, logic changes with tests, anything you could not do.
