// Type scale: four sizes only (12 label, 15 body, 20 title, display for the one hero figure per screen).
// Chakra Petch carries display, numbers and labels; body copy uses the Android system face (Roboto).
import type { TextStyle } from "react-native";

export const fonts = {
  display: "ChakraPetch_600SemiBold",
  displayBold: "ChakraPetch_700Bold",
  label: "ChakraPetch_500Medium",
} as const;

export const type = {
  /** Section labels, chips, tab labels, meta. Caps with light tracking. */
  label: { fontFamily: fonts.label, fontSize: 12, lineHeight: 16, letterSpacing: 1.2 } satisfies TextStyle,
  /** Secondary lines, row subtitles. */
  meta: { fontSize: 12, lineHeight: 16 } satisfies TextStyle,
  /** Body copy and row titles. */
  body: { fontSize: 15, lineHeight: 22 } satisfies TextStyle,
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: "600" } satisfies TextStyle,
  /** Screen titles and THE SYSTEM's lines. */
  title: { fontFamily: fonts.display, fontSize: 20, lineHeight: 28 } satisfies TextStyle,
  /** Numbers that sit in a row (scores, rewards) at title size. */
  number: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, fontVariant: ["tabular-nums"] } satisfies TextStyle,
  /** The one hero figure per screen. */
  display: { fontFamily: fonts.displayBold, fontSize: 56, lineHeight: 60 } satisfies TextStyle,
} as const;

/** 8dp grid. */
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
