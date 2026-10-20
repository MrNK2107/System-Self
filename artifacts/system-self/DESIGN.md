---
name: SYSTEM // SELF
description: Solo Leveling's System as a premium native Android app; THE SYSTEM speaks in framed windows and each screen does one job.
colors:
  ink-ground: "#07060B"
  nav-surface: "#0E0C15"
  row-card: "#120F1A"
  window-panel: "rgba(38,28,64,0.55)"
  window-panel-solid: "#1A1430"
  window-frame: "rgba(176,140,255,0.55)"
  monarch-violet: "#A879FF"
  monarch-violet-text: "#B48CFF"
  on-monarch: "#0B0812"
  tonal-fill: "#1C1726"
  hairline: "#2A2340"
  text-primary: "#F1ECF7"
  text-secondary: "#B5ACC4"
  text-tertiary: "#8E85A0"
  warn-amber: "#F2B544"
  success-green: "#3DD68C"
  destructive-red: "#F0606B"
  on-destructive: "#140608"
  domain-body: "#E8604C"
  domain-mind: "#4F8FE0"
  domain-wealth: "#2FA36B"
  domain-social: "#D4A62A"
  domain-discipline: "#C77DDB"
  rank-e: "#8A93A6"
  rank-s: "#E8D5A3"
typography:
  display:
    fontFamily: "Chakra Petch"
    fontSize: "56px"
    fontWeight: 700
    lineHeight: "60px"
  title:
    fontFamily: "Chakra Petch"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
  number:
    fontFamily: "Chakra Petch"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
    fontFeature: "tnum"
  body:
    fontFamily: "Noto Sans"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
  body-strong:
    fontFamily: "Noto Sans"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
  meta:
    fontFamily: "Noto Sans"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  label:
    fontFamily: "Chakra Petch"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "1.2px"
rounded:
  sm: "4px"
  pill: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
components:
  button-filled:
    backgroundColor: "{colors.monarch-violet}"
    textColor: "{colors.on-monarch}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 24px"
    height: "48px"
  button-tonal:
    backgroundColor: "{colors.tonal-fill}"
    textColor: "{colors.monarch-violet-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 24px"
    height: "48px"
  button-text:
    textColor: "{colors.monarch-violet-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "48px"
  button-destructive:
    backgroundColor: "{colors.destructive-red}"
    textColor: "{colors.on-destructive}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 24px"
    height: "48px"
  system-window:
    backgroundColor: "{colors.window-panel}"
    textColor: "{colors.text-primary}"
    padding: "16px"
  system-window-solid:
    backgroundColor: "{colors.window-panel-solid}"
    textColor: "{colors.text-primary}"
    padding: "16px"
  card:
    backgroundColor: "{colors.row-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "16px"
  list-row:
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    padding: "12px 16px"
    height: "64px"
  segmented-selected:
    backgroundColor: "{colors.monarch-violet}"
    textColor: "{colors.on-monarch}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "48px"
  segmented-unselected:
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    height: "48px"
  nav-bar:
    backgroundColor: "{colors.nav-surface}"
    height: "80px"
  nav-item-active:
    backgroundColor: "{colors.tonal-fill}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    width: "64px"
    height: "32px"
  nav-log-action:
    backgroundColor: "{colors.monarch-violet}"
    textColor: "{colors.on-monarch}"
    rounded: "{rounded.pill}"
    width: "48px"
    height: "32px"
  app-bar:
    backgroundColor: "{colors.ink-ground}"
    textColor: "{colors.text-primary}"
    typography: "{typography.title}"
    height: "56px"
---

# Design System: SYSTEM // SELF

## Overview

**Creative North Star: "The System Window"**

The app is Solo Leveling's System rendered as a premium native Android app. The ground is near-black ink with a violet cast; on it sit quiet solid rows and cards that hold the user's own data, and, rarely, a translucent violet window with a hairline frame and 45° notched corners. That window is reserved for THE SYSTEM: when it speaks (a morning briefing, a status readout, a quest-complete reply), it speaks inside a frame headed by a bracketed, letter-spaced title such as "[ STATUS ]". Everything else stays flat and plain so the window keeps its weight.

Each screen does one job. Today answers "what do I do next" with one briefing and one quest; Quests lists; Log is a sheet; Arena compares; Status shows who the user is. Secondary content sits behind a row with a chevron, a sheet, or a detail screen. Density is moderate: a 24dp gap between blocks, 64dp rows, 48dp targets. Rewards are cold. Progress arrives as System output ("+3.3 DISCIPLINE. Logged."), never as celebration, and nothing on screen claims more than the data supports.

The visual rejections confirmed by the owner are generic neon blue and the stacked dashboard, where rank, stats, briefing and quests share one scroll.

**Key Characteristics:**
- Ink-black ground, violet-tinted neutrals, a single Monarch violet accent.
- System windows for THE SYSTEM's voice only. They are translucent in flow and opaque when they float.
- Chakra Petch for display, numbers and labels; Noto Sans for reading.
- Four type sizes (12 / 15 / 20) plus one display figure per screen.
- Five domain colours that belong to their dot, chip and label only.
- Flat surfaces. Depth comes from tone and frame, and the only glow is on the rank emblem.

## Colors

The palette is a violet-black night with one royal-violet accent and five saturated domain hues used only as small marks.

### Primary
- **Monarch Violet** (#A879FF): the fill of pressable things. This covers the filled button, the selected segment, the centre Log action and the pull-to-refresh spinner. It is never used as a surface tint or decoration.
- **Monarch Violet, readable** (#B48CFF): the same violet lifted for text and icons on the ink ground, used for text buttons, window titles and links. It is ≥4.5:1 on the ground.
- **On Monarch** (#0B0812): label ink on violet fills.

### Secondary
- **Domain hues**: BODY Ember (#E8604C), MIND Signal Blue (#4F8FE0), WEALTH Ledger Green (#2FA36B), SOCIAL Brass (#D4A62A), DISCIPLINE Orchid (#C77DDB). A domain colour owns its 8dp dot, its caps label and a domain-scoped window frame. It never fills a card or a button.
- **Rank hues**: E Steel (#8A93A6), D blue, C green, B brass and A ember (shared with the domain hues), S Pale Gold (#E8D5A3). Used for the rank emblem stroke and its glow, and for rank badges.

### Tertiary
- **Warn Amber** (#F2B544): deadlines that are close or slots that were missed, and the label of a warning banner.
- **Success Green** (#3DD68C): done checks and positive deltas.
- **Destructive Red** (#F0606B): failures and destructive actions.

### Neutral
- **Ink Ground** (#07060B): the screen background and the app bar.
- **Nav Surface** (#0E0C15): the bottom navigation bar.
- **Row Card** (#120F1A): solid cards, sheets and grouped rows.
- **Window Panel** (rgba(38,28,64,0.55)), composited to **Window Panel Solid** (#1A1430) when floating: the fill of a System window.
- **Window Frame** (rgba(176,140,255,0.55)): the 1px notched frame and the hairline under a window's title bar.
- **Tonal Fill** (#1C1726): tonal buttons, the active nav pill and inactive tracks.
- **Hairline** (#2A2340): card borders, row dividers and the segmented outline. Use it for lines only, never text.
- **Text** Bone (#F1ECF7), Lilac Grey (#B5ACC4), Dusk (#8E85A0): primary, secondary and tertiary text. All three are ≥4.5:1 on the ground and on cards.

### Adaptive state palettes
The server's `uiState` swaps the ground and accent across the whole app (lib/theme/theme.ts). FALLING bleeds to crimson (accent #B3263A, text #F06A78, ground #080506). STABLE is Monarch violet (the values above). CLIMBING brightens it (#C4A2FF). PEAK turns white-gold (#E8D5A3, ground #0A0907) and adds a faint grid texture. The pace of THE SYSTEM's typewriter follows the state too: 45, 25, 18 and 20 ms per character. Screens never hard-code the accent; they read it from `useColors()`.

### Named Rules
**The Pressable Violet Rule.** Monarch violet fills only things you can press, plus the one hero highlight. If it is violet and filled, a tap does something.

**The Domain Owns Its Mark Rule.** A domain colour appears as the dot, the caps label or the frame of something scoped to that domain. It never becomes a background.

## Typography

**Display Font:** Chakra Petch (600 SemiBold, 700 Bold)
**Body Font:** Noto Sans (400 Regular, 600 SemiBold)
**Label Font:** Chakra Petch (500 Medium)

**Character:** Chakra Petch's chamfered, squarish forms carry THE SYSTEM's voice, its numbers and its labels, and their cut corners echo the notched window frame. Noto Sans keeps sentences quiet and readable.

### Hierarchy
- **Display** (700, 56/60): one hero figure per screen. Today's reward ("+3") is one; on Status the rank emblem letter takes the role, scaled to the emblem.
- **Title** (600, 20/28): app bar titles, sheet titles, quest titles and THE SYSTEM's lines inside windows (briefing, standing, echo).
- **Number** (600, 20/26, tabular figures): scores and rewards that sit in rows.
- **Body** (400, 15/22) and **Body Strong** (600, 15/22): row titles, descriptions and section heads written in sentence case.
- **Meta** (400, 12/16): subtitles, timestamps, deadline lines and hints.
- **Label** (500, 12/16, 1.2 tracking, uppercase): button labels, segments, domain chips, window titles and caps section labels over lists.

### Named Rules
**The Three-Plus-One Rule.** Only 12, 15 and 20 exist, plus one display figure per screen. No other font size and nothing below 12. Letter-spacing comes only from the label role; the nav label's 0.4 tracking is the one exception, and it is owned by the kit.

**The Android Weight Rule.** Weight is chosen by font family name (ChakraPetch_700Bold, NotoSans_600SemiBold), never by `fontWeight`.

## Layout

Single column, native Android. Content is inset 16dp from the screen edges and sits on an 8dp grid (4 / 8 / 16 / 24 / 32 / 48). A screen stacks its blocks with a 24dp gap. Inside a card or window the gap is 8dp and the padding 16dp. There is more space above a section than below its heading.

The frame is fixed. At the top is a 56dp opaque app bar on the ink ground under the status bar, so content never scrolls behind the clock. Tab roots align the title to the 16dp content edge; other screens get a 48dp back button. At the bottom is an 80dp navigation bar (plus the inset) with five destinations: Today, Quests, Log at the centre (it opens the log sheet rather than a screen), Arena and Status. Tab screens pad their scroll by the bar height plus 24dp. Arena splits Rivals, Clan and Challenges with a segmented control rather than three tabs.

Progressive disclosure is structural. A row with a chevron leads to a detail screen, actions on a quest open in a bottom sheet, and a screen that has five things picks the one it exists for.

## Elevation & Depth

The system is flat and depth is tonal. The ink ground sits beneath the nav surface, which sits beneath the solid cards, which sit beneath the violet window panel. The window is the only layer with a frame of its own. No drop shadows are drawn. Android `elevation` appears only as z-ordering on floating layers (the echo and the notice banner) and is never seen as shadow, and the nav bar sets elevation to 0. Floating layers become opaque instead of casting shadow, and modal backdrops dim the screen behind them (rgba(0,0,0,0.6) for sheets, ink at 0.92 for System notices).

### Glow
- **Rank glow** (text-shadow, rank colour, radius 18, zero offset): only the rank emblem's letter carries it.

### Named Rules
**The Solid-When-Floating Rule.** A System window in the flow is translucent over the ink. A window that floats over content (the echo, notices) uses the opaque #1A1430 fill, so nothing shows through behind THE SYSTEM's words.

**The One Glow Rule.** Glow belongs to the rank emblem. Nothing else is lit.

## Shapes

Shapes are tight and cut, never soft. Cards, buttons, segmented controls and inputs share a 4dp corner. A System window has no radius; instead it has 45° notched corners (a 10dp chamfer) drawn as an SVG octagon with a 1px stroke inset half a pixel so it stays crisp. Its title sits in a full-width title bar closed by a hairline rule in the frame colour. The rank emblem is a hexagon with an inner hexagon at 35% stroke opacity. The only round forms are 8dp domain dots, the 16dp-radius pills of the navigation bar, and the sheet grip. Borders are 1px or hairline and never thicker.

## Components

### Buttons
The buttons are blunt and decisive, labelled in caps.
- **Shape:** 4dp corners, at least 48dp tall, with the ripple clipped inside the radius.
- **Filled:** a Monarch violet fill with On Monarch caps label, 24dp side padding. It is the one primary action in a block and often stretches to full width.
- **Tonal:** Tonal Fill with a readable-violet label, for secondary actions that still need a body.
- **Text:** a transparent background with a readable-violet label and 12dp padding, for quiet secondary actions under a primary ("MARK COMPLETE").
- **Destructive:** Destructive Red fill with dark ink.
- **Feedback:** Android ripple, black at 18% on filled and violet at 18% on the others. Disabled or loading drops to 45% opacity, and loading swaps the label for a spinner in the label colour.

### Segmented control
- **Style:** a 1px hairline outline with 4dp corners. Segments are equal width and 48dp tall, with caps labels.
- **State:** the selected segment fills with Monarch violet and On Monarch ink. Unselected segments keep Lilac Grey text with no fill.

### Cards / Containers
- **Corner Style:** 4dp.
- **Background:** Row Card (#120F1A).
- **Border:** 1px Hairline.
- **Internal Padding:** 16dp, with an 8dp gap.
- **Use:** the user's own data, such as the next quest card, grouped rival rows and empty states. Cards never nest inside cards.

### List rows
- **Style:** at least 64dp tall, 16dp side padding, a hairline divider below. An optional 8dp domain dot leads, the title is in body and the subtitle in meta Lilac Grey, followed by trailing content and an optional 20dp Dusk chevron.
- **Feedback:** violet ripple at 12%, only when the row has an action.

### Sheets
- **Style:** a Row Card fill slides up over a dimmed backdrop, with a 1px hairline top border and a 32×4 grip. The title uses the title role, and the one primary action is pinned in a footer. Android Back and a backdrop tap close it, except while a request is in flight.

### Navigation
- **App bar:** 56dp on the ink ground with the title in the title role. Icon buttons are 48dp with a borderless violet ripple and 22dp Feather icons.
- **Bottom bar:** Nav Surface with a hairline top border, and labels always visible (Chakra Petch 12). The active item puts its icon in a 64×32 Tonal Fill pill, with icon and label in Bone. Inactive items are Lilac Grey. The centre Log item is a 48×32 Monarch violet pill with a plus, labelled in readable violet, and it opens the log sheet.
- **Icons:** Feather line icons only.

### System Window (signature)
This is THE SYSTEM's voice. It is a translucent violet panel with a 1px notched frame and an optional title bar showing the bracketed caps title ("[ MORNING BRIEFING ]") centred in readable violet over a hairline rule. The body is padded 16dp. THE SYSTEM's line is set in the title role and typed out letter by letter with a violet block cursor, at the pace of the uiState. A domain-scoped window can take its domain colour for the frame and title. It is used for the briefing, the STATUS panel, the Arena standing and server notices, and never as a generic card.

### System Echo (signature)
This is THE SYSTEM answering an action. A solid System window titled "[ QUEST COMPLETE ]" rises 32dp into place 8dp above the tab bar (280ms, ease-out cubic, with a 200ms fade). It types its line in the number role, centred, and reports the amount the server applied ("+3.3 DISCIPLINE. Logged."). It holds for 2.6s after typing, fades over 220ms, ignores touches, is replaced by any newer echo, fires a success haptic and is announced to screen readers. With reduce motion on, it appears complete and without movement.

### Rank Emblem (signature)
This is the hero figure on Status. A hexagon in the rank colour (a 1.5px outer stroke over the window panel fill, a 1px inner hexagon at 35%) surrounds the rank letter in Chakra Petch Bold, set in Bone and lit by the rank-colour glow.

## Do's and Don'ts

### Do:
- **Do** take every colour from `useColors()` and every type style from `constants/type.ts`. The accent follows the adaptive uiState.
- **Do** give each screen one job. Move secondary content behind a chevron row, a sheet or a detail screen, and keep every feature reachable.
- **Do** put THE SYSTEM's messages, and only those, in a System window with a bracketed caps title. Use the `solid` fill whenever the window floats.
- **Do** answer a completed quest with the [ QUEST COMPLETE ] echo above the tab bar, reporting the amount the server applied.
- **Do** keep rewards cold: state the delta and the domain, then "Logged." Nothing more.
- **Do** label simulated or partial data honestly ("SIMULATED", "Base. Your streak adds more.", "new").
- **Do** make every touch target at least 48dp with Android ripple feedback, keep system Back working, and respect reduce motion.
- **Do** write empty states as one System line plus one primary action.

### Don't:
- **Don't** use generic neon blue or build a stacked dashboard that puts rank, stats, briefing and quests on one scroll.
- **Don't** wrap ordinary data cards in System windows. The frame belongs to THE SYSTEM's voice.
- **Don't** use any font size other than 12, 15, 20 and the single display figure, or any size below 12.
- **Don't** fill surfaces or buttons with a domain colour, or fill anything that cannot be pressed with Monarch violet.
- **Don't** put a small caps eyebrow over a heading. Bracketed window titles and caps labels heading a list are the world's own devices; a kicker above a title is not.
- **Don't** use coloured side borders thicker than 1px, cards nested in cards, gradient text, emoji or unicode glyphs as icons, or glow anywhere except the rank emblem.
- **Don't** show a claim the data does not support (no promotion percentage on day 1, no "LIVE" over simulated rivals, no review of seven days before day 7).
- **Don't** use a modal for something that does not need to interrupt.
