import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import type { UiState } from "@workspace/contracts";
import { useGameStateQuery } from "@/hooks/useGameState";
import { THEMES, resolveUiState, type ThemeTokens } from "@/lib/theme/theme";

export interface ThemeValue extends ThemeTokens {
  uiState: UiState;
}

const STABLE_VALUE: ThemeValue = { uiState: "STABLE", ...THEMES.STABLE };

// Outside a provider (and while state loads) the app renders as STABLE.
const ThemeContext = createContext<ThemeValue>(STABLE_VALUE);

/** Palette for the server's `uiState`. Free users always receive STABLE from the server. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const state = useGameStateQuery().data?.uiState;
  const uiState = resolveUiState(state);
  const value = useMemo<ThemeValue>(() => ({ uiState, ...THEMES[uiState] }), [uiState]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
