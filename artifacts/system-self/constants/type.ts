// Type scale: four sizes only (12 label, 15 body, 20 title, display for the one hero figure per screen).
// Chakra Petch carries display, numbers and labels; Noto Sans carries body copy (owner's choice, 2026-10-20).
import type { TextStyle } from "react-native";

export const fonts = {
  display: "ChakraPetch_600SemiBold",
  displayBold: "ChakraPetch_700Bold",
  label: "ChakraPetch_500Medium",
  body: "NotoSans_400Regular",
  bodyStrong: "NotoSans_600SemiBold",
} as const;

export const type = {
  /** Section labels, chips, tab labels, meta. Caps with light tracking. */
  label: { fontFamily: fonts.label, fontSize: 12, lineHeight: 16, letterSpacing: 1.2 } satisfies TextStyle,
  /** Secondary lines, row subtitles. */
  meta: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 } satisfies TextStyle,
  /** Body copy and row titles. */
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 } satisfies TextStyle,
  // Android picks the weight from the family name, not fontWeight.
  bodyStrong: { fontFamily: fonts.bodyStrong, fontSize: 15, lineHeight: 22 } satisfies TextStyle,
  /** Screen titles and THE SYSTEM's lines. */
  title: { fontFamily: fonts.display, fontSize: 20, lineHeight: 28 } satisfies TextStyle,
  /** Numbers that sit in a row (scores, rewards) at title size. */
  number: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, fontVariant: ["tabular-nums"] } satisfies TextStyle,
  /** The one hero figure per screen. */
  display: { fontFamily: fonts.displayBold, fontSize: 56, lineHeight: 60 } satisfies TextStyle,
} as const;

/** 8dp grid. */
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
