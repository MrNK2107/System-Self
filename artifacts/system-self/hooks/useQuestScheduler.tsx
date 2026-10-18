// The server owns the quest board: it generates it (POST /api/quests/generate, a no-op once the local day's board
// exists) and expires quests itself. This hook asks once per local day, on mount and whenever the app returns to
// the foreground, and exposes a manual trigger for pull-to-refresh.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useApp } from "@/context/AppContext";

/** `YYYY-M-D` in the device's local calendar. */
function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

interface QuestScheduler {
  generating: boolean;
  triggerGeneration: () => Promise<boolean>;
}

function useSchedulerRunner(): QuestScheduler {
  const { user, generateQuests } = useApp();
  const [generating, setGenerating] = useState(false);
  const running = useRef(false);
  const lastDoneDay = useRef<string | null>(null);
  const userId = user?.id ?? null;

  /** Resolves true when the server answered (a board exists for today); false when held back or failed. */
  const triggerGeneration = useCallback(async (): Promise<boolean> => {
    if (!userId || running.current) return false;
    running.current = true;
    setGenerating(true);
    try {
      const result = await generateQuests();
      if (result.ok) lastDoneDay.current = localDay();
      return result.ok;
    } finally {
      running.current = false;
      setGenerating(false);
    }
  }, [userId, generateQuests]);

  // A different account asks again.
  useEffect(() => {
    lastDoneDay.current = null;
  }, [userId]);

  const runIfNewDay = useCallback(() => {
    if (lastDoneDay.current !== localDay()) void triggerGeneration();
  }, [triggerGeneration]);

  useEffect(() => {
    if (userId) runIfNewDay();
  }, [userId, runIfNewDay]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") runIfNewDay();
    });
    return () => sub.remove();
  }, [runIfNewDay]);

  return useMemo(() => ({ generating, triggerGeneration }), [generating, triggerGeneration]);
}

const SchedulerContext = createContext<QuestScheduler | null>(null);

/** Mounted once in the tabs layout so the daily board is requested whichever tab is showing. */
export function QuestSchedulerProvider({ children }: { children: React.ReactNode }) {
  const value = useSchedulerRunner();
  return <SchedulerContext.Provider value={value}>{children}</SchedulerContext.Provider>;
}

export function useQuestScheduler(): QuestScheduler {
  const ctx = useContext(SchedulerContext);
  if (!ctx) throw new Error("useQuestScheduler must be used within QuestSchedulerProvider");
  return ctx;
}
