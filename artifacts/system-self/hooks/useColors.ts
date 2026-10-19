import { useColorScheme } from "react-native";

import colors from "@/constants/colors";
import { useTheme } from "@/context/ThemeContext";

/**
 * Returns the design tokens for the current color scheme, with the adaptive-UI theme layered on top:
 * `background`, `tint`, `primary` and `accent` follow the server's `uiState` (STABLE for free users and while
 * state loads), so every screen picks the palette up without changing its call sites.
 *
 * Falls back to the light palette when no dark key is defined in constants/colors.ts.
 */
export function useColors() {
  const scheme = useColorScheme();
  const theme = useTheme();
  const palette =
    scheme === "dark" && "dark" in colors
      ? (colors as Record<string, typeof colors.light>).dark
      : colors.light;
  return {
    ...palette,
    background: theme.background,
    // Text/icon accent (readable on the background). Use accentFill for button fills and bars.
    tint: theme.accentText,
    primary: theme.accentText,
    accentFill: theme.accent,
    primaryForeground: theme.onAccent,
    accent: theme.accentText,
    accentForeground: theme.onAccent,
    radius: colors.radius,
  };
}
