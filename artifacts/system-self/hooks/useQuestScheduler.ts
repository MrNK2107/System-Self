// P3-T5: minimal server-backed scheduler so the quest board compiles against the new context. Task 5 owns the
// full rewrite (once per local day on mount/foreground, refusal sheet, chain progress). The server generates
// the board (POST /api/quests/generate, at most once per local day) and expires quests itself.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useApp } from "@/context/AppContext";

interface GenRecord {
  date: string;
  time: string;
  rank: string;
  weakestDomain: string;
  shadowGap: number;
}

export function useQuestScheduler() {
  const { user, shadowSelf, getWeakestDomain, generateQuests } = useApp();
  const [generating, setGenerating] = useState(false);
  const [lastGenRecord, setLastGenRecord] = useState<GenRecord | null>(null);
  const running = useRef(false);
  const lastRunDate = useRef<string | null>(null);

  const triggerGeneration = useCallback(async () => {
    if (!user || running.current) return;
    running.current = true;
    setGenerating(true);
    try {
      const result = await generateQuests();
      if (result.ok) {
        const now = new Date();
        lastRunDate.current = now.toDateString();
        setLastGenRecord({
          date: now.toISOString().split("T")[0]!,
          time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          rank: user.rank,
          weakestDomain: getWeakestDomain(),
          shadowGap: Math.round(shadowSelf.gap * 10) / 10,
        });
      }
    } finally {
      running.current = false;
      setGenerating(false);
    }
  }, [user, generateQuests, getWeakestDomain, shadowSelf.gap]);

  const runIfNewDay = useCallback(() => {
    if (lastRunDate.current !== new Date().toDateString()) void triggerGeneration();
  }, [triggerGeneration]);

  const hasUser = !!user;
  useEffect(() => {
    if (hasUser) runIfNewDay();
  }, [hasUser]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") runIfNewDay();
    });
    return () => sub.remove();
  }, [runIfNewDay]);

  return { generating, lastGenRecord, triggerGeneration };
}
