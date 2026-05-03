import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useApp, type Quest } from "@/context/AppContext";
import { useSystemAI } from "./useSystemAI";

const QUEST_GEN_KEY = "@system_self:quest_gen_record";
const FAILED_EVENT_SENT_KEY = "@system_self:failed_quest_event_sent_ids";

interface GenRecord {
  date: string;
  time: string;
  rank: string;
  weakestDomain: string;
  shadowGap: number;
}

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function isExpiredActive(quest: Quest): boolean {
  return quest.status === "active" && new Date(quest.expiresAt) < new Date();
}

async function postQuestCompletionEvent(params: {
  username: string;
  questId: string;
  status: "complete" | "failed" | "refused";
  domain: Quest["domain"];
  questType: Quest["type"];
}) {
  try {
    const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
      : "";
    const token = process.env.EXPO_PUBLIC_API_TOKEN;
    await fetch(`${baseUrl}/api/system/quest-completion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        ...params,
        completedAt: new Date().toISOString(),
        source: "app",
      }),
    });
  } catch {
    // Non-blocking.
  }
}

async function getFailedEventSentIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(FAILED_EVENT_SENT_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return new Set<string>();
  }
}

async function saveFailedEventSentIds(ids: Set<string>) {
  const trimmed = Array.from(ids).slice(-500);
  await AsyncStorage.setItem(FAILED_EVENT_SENT_KEY, JSON.stringify(trimmed));
}

export function useQuestScheduler() {
  const {
    user, quests, domainScores, shadowSelf, logs,
    getWeakestDomain, setQuests, getShadowScores,
  } = useApp();
  const { generateQuests } = useSystemAI();

  const [generating, setGenerating] = useState(false);
  const [lastGenRecord, setLastGenRecord] = useState<GenRecord | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Track quests in a ref so AppState listener sees fresh data
  const questsRef = useRef(quests);
  useEffect(() => { questsRef.current = quests; }, [quests]);

  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const triggerGeneration = useCallback(async (forceRefresh = false) => {
    const currentUser = userRef.current;
    if (!currentUser || generating) return;
    setGenerating(true);

    try {
      const scores = {
        BODY: domainScores.find(s => s.domain === "BODY")?.score ?? 50,
        MIND: domainScores.find(s => s.domain === "MIND")?.score ?? 50,
        WEALTH: domainScores.find(s => s.domain === "WEALTH")?.score ?? 50,
        DISCIPLINE: domainScores.find(s => s.domain === "DISCIPLINE")?.score ?? 50,
      };

      const shadowScores = getShadowScores();
      const shadowAvg = (Object.values(shadowScores) as number[]).reduce((a, b) => a + b, 0) / 4;
      const userAvg = Object.values(scores).reduce((a, b) => a + b, 0) / 4;
      const shadowGap = shadowAvg - userAvg;

      const weakest = getWeakestDomain();
      const recentLogs = logs.slice(-10).map(l => `${l.domain}: ${l.type}`);

      // Expire active dailies and keep weeklies/arcs
      const now = new Date();
      const currentQuests = questsRef.current;
      const newlyFailedQuests = currentQuests.filter(
        q => q.type === "daily" && isExpiredActive(q),
      );

      // Mark expired active dailies as failed
      const preservedQuests: Quest[] = currentQuests
        .map(q => {
          if (q.type === "daily" && isExpiredActive(q)) {
            return { ...q, status: "failed" as const };
          }
          return q;
        })
        // Keep non-active or non-expired
        .filter(q => {
          // Drop old failed/refused dailies to keep board clean (keep last 3)
          if ((q.status === "failed" || q.status === "refused") && q.type === "daily") {
            return false;
          }
          return true;
        });

      // Keep active weekly + arc quests that haven't expired
      const activeWeeklies = preservedQuests.filter(
        q => (q.type === "weekly" || q.type === "arc") && q.status === "active" && !isExpiredActive(q)
      );
      const completedToday = preservedQuests.filter(q => {
        const logDate = new Date(q.expiresAt);
        const isToday = logDate.toDateString() === now.toDateString() ||
          // Daily quests expire tomorrow, so completed ones that expire tomorrow are today's
          (q.type === "daily" && q.status === "complete");
        return isToday;
      });

      // Generate new quests
      const generated = await generateQuests({
        username: currentUser.username,
        rank: currentUser.rank,
        domainScores: scores,
        primaryGoal: currentUser.primaryGoal,
        weakestDomain: weakest,
        recentLogs,
        shadowGap,
        dayNumber: currentUser.dayNumber,
      });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(4, 0, 0, 0); // Reset at 4am

      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextWeek.setHours(4, 0, 0, 0);

      const threeWeeks = new Date();
      threeWeeks.setDate(threeWeeks.getDate() + 21);
      threeWeeks.setHours(4, 0, 0, 0);

      const newQuests: Quest[] = generated.map(q => ({
        id: generateId(),
        type: q.type,
        title: q.title,
        description: q.description,
        domain: q.domain,
        status: "active" as const,
        expiresAt: q.type === "daily"
          ? tomorrow.toISOString()
          : q.type === "arc"
          ? threeWeeks.toISOString()
          : nextWeek.toISOString(),
        generatedBySystem: true,
      }));

      // Final board: new dailies + preserved weeklies/arcs (no duplicates) + completed today
      const needNewWeekly = activeWeeklies.filter(q => q.type === "weekly").length === 0;
      const needNewArc = activeWeeklies.filter(q => q.type === "arc").length === 0;

      const filteredNew = newQuests.filter(q => {
        if (q.type === "daily") return true;
        if (q.type === "weekly") return needNewWeekly;
        if (q.type === "arc") return needNewArc;
        return false;
      });

      const finalQuests = [
        ...filteredNew,
        ...activeWeeklies,
        ...completedToday.filter(c => !filteredNew.find(n => n.id === c.id)),
      ];

      await setQuests(finalQuests);

      if (newlyFailedQuests.length > 0) {
        const sentIds = await getFailedEventSentIds();
        for (const quest of newlyFailedQuests) {
          if (sentIds.has(quest.id)) continue;
          void postQuestCompletionEvent({
            username: currentUser.username,
            questId: quest.id,
            status: "failed",
            domain: quest.domain,
            questType: quest.type,
          });
          sentIds.add(quest.id);
        }
        await saveFailedEventSentIds(sentIds);
      }

      const today = new Date().toISOString().split("T")[0]!;
      const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const record: GenRecord = {
        date: today,
        time: timeStr,
        rank: currentUser.rank,
        weakestDomain: weakest,
        shadowGap: Math.round(shadowGap * 10) / 10,
      };
      await AsyncStorage.setItem(QUEST_GEN_KEY, JSON.stringify(record));
      setLastGenRecord(record);
    } catch {
      // Silent — board retains previous quests
    } finally {
      setGenerating(false);
    }
  }, [domainScores, logs, getShadowScores, getWeakestDomain, generateQuests, setQuests, generating]);

  const runScheduler = useCallback(async () => {
    const currentUser = userRef.current;
    if (!currentUser) return;

    const today = new Date().toISOString().split("T")[0]!;
    let stored: GenRecord | null = null;
    try {
      const raw = await AsyncStorage.getItem(QUEST_GEN_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {}

    setLastGenRecord(stored);

    const isNewDay = stored?.date !== today;
    const hasNoQuests = questsRef.current.length === 0;
    const hasNoActiveDailies = questsRef.current.filter(
      q => q.type === "daily" && q.status === "active"
    ).length === 0;

    if (isNewDay || hasNoQuests || hasNoActiveDailies) {
      await triggerGeneration();
    }

    setInitialized(true);
  }, [triggerGeneration]);

  // Initial check
  useEffect(() => {
    if (user && !initialized) {
      runScheduler();
    }
  }, [user, initialized, runScheduler]);

  // Foreground check
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => {
      if (state === "active" && userRef.current && initialized) {
        runScheduler();
      }
    });
    return () => sub.remove();
  }, [initialized, runScheduler]);

  return { generating, lastGenRecord, triggerGeneration: () => triggerGeneration(true) };
}
