# Image prompts for the SYSTEM // SELF redesign

Generate these anywhere you like and save each file into:

`artifacts/system-self/design/generated/`

using the **exact file name** given for each. Nothing is blocked on them: the app uses placeholders until a file appears, and I'll wire each one in when you tell me it's there.

General rules for every image:
- No text, letters, logos or watermarks in the image (the app draws all text itself).
- Flat, cold, minimal. No warm gradients, no lens flare, no glow halos, no anime characters' faces.
- PNG. Transparent background where noted; otherwise opaque.

---

## 1. App icon — `app-icon.png`
- Size: 1024 x 1024, opaque, square (Android masks it).
- Prompt: *A stark app icon: a single bold capital letter "S" built from two interlocking angular strokes, cut like a blade, centred on a flat near-black navy field (#070B14). The strokes are a cold steel blue (#5AA9FF) with one thin white edge. Geometric, sharp corners, no gradients, no glow, no texture. Minimal, iconic, readable at 48px.*
- Note: if the model insists on adding text, ask for "a monogram mark, no letters" instead.

## 2. Adaptive icon foreground — `adaptive-icon-foreground.png`
- Size: 1024 x 1024, **transparent background**.
- Prompt: the same "S" mark as above only, centred inside the middle 60% of the canvas, transparent everywhere else.

## 3. Splash mark — `splash-mark.png`
- Size: 512 x 512, **transparent background**.
- Prompt: *The same angular "S" mark in cold steel blue (#5AA9FF) with a thin white edge, alone on a transparent background, flat, no glow.*

## 4. Rank emblems — `rank-e.png`, `rank-d.png`, `rank-c.png`, `rank-b.png`, `rank-a.png`, `rank-s.png`
- Size: 512 x 512 each, **transparent background**.
- Prompt template (change only the rank letter and colour):
  *A flat, angular rank emblem: a hexagonal plate with notched corners and a thin double outline, the capital letter "{RANK}" cut out of its centre in a heavy geometric face. Single colour {COLOUR} on transparent background, flat vector look, no glow, no gradient, no texture, sharp edges, readable at 64px.*
- Colours: E `#8A93A6` (grey steel), D `#4A90D9` (blue), C `#2BA36B` (green), B `#C9A227` (gold), A `#E05555` (red), S `#E8D5A3` (white-gold).

## 5. Empty-state marks — `empty-quests.png`, `empty-logs.png`, `empty-rivals.png`, `empty-clan.png`
- Size: 600 x 600 each, **transparent background**.
- Prompt template: *A minimal line illustration in thin cold-blue (#5AA9FF) strokes on a transparent background: {SUBJECT}. Geometric, sparse, technical-drawing feel, no people, no text, no fill colours, no glow.*
- Subjects:
  - empty-quests: *an empty rectangular frame with notched corners and a single blinking cursor bar inside it*
  - empty-logs: *a vertical timeline line with one empty circle marker at the top*
  - empty-rivals: *two thin silhouetted chevrons facing each other across a vertical divider*
  - empty-clan: *five small empty hexagons arranged in a loose arc, one slightly brighter*

## 6. Onboarding background — `onboarding-bg.png`
- Size: 1080 x 2400 (portrait), opaque.
- Prompt: *A near-black navy field (#070B14) with an extremely faint fine grid of thin lines (#5AA9FF at 6% opacity), slightly darker toward the edges. Flat, cold, empty, no objects, no light rays, no glow, no text.*
