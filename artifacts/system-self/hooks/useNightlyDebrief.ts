import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useRef } from "react";
import { useApp, type Domain, type DebriefVerdict, STORAGE_KEYS } from "@/context/AppContext";
import { useSystemAI } from "@/hooks/useSystemAI";

const DOMAINS: Domain[] = ["BODY", "MIND", "WEALTH", "DISCIPLINE"];

function computeVerdict(
  deltas: Record<Domain, number>,
  questCompleted: number,
  questTotal: number
): DebriefVerdict {
  const avgDelta = DOMAINS.reduce((s, d) => s + deltas[d], 0) / DOMAINS.length;
  const disciplineDelta = deltas.DISCIPLINE;
  const questRate = questTotal > 0 ? questCompleted / questTotal : 0;

  // Pathetic: no improvement and no quests done
  if (avgDelta <= 0 && questRate === 0) return "PATHETIC";
  // Also pathetic: negative progress overall with very poor quest completion
  if (avgDelta < -1 && questRate < 0.25) return "PATHETIC";

  // Acceptable: real measurable progress, discipline holding, decent quest rate
  if (avgDelta >= 2.0 && disciplineDelta >= 0 && questRate >= 0.5) return "ACCEPTABLE";

  return "INSUFFICIENT";
}

function isPastDebriefTime(nightlyTime: string): boolean {
  const parts = nightlyTime.split(":");
  const debriefHour = parseInt(parts[0] ?? "21", 10);
  const debriefMinute = parseInt(parts[1] ?? "0", 10);
  const now = new Date();
  return (
    now.getHours() > debriefHour ||
    (now.getHours() === debriefHour && now.getMinutes() >= debriefMinute)
  );
}

export function useNightlyDebrief() {
  const {
    user,
    domainScores,
    quests,
    shadowSelf,
    trajectory,
    dailyBaseline,
    pendingDebrief,
    setPendingDebrief,
    acknowledgeDebrief,
  } = useApp();
  const { generateMessage } = useSystemAI();
  const checking = useRef(false);

  const checkAndTriggerDebrief = useCallback(async () => {
    if (!user || pendingDebrief || checking.current) return;
    checking.current = true;

    try {
      const today = new Date().toISOString().split("T")[0]!;

      // Already debriefed today?
      const lastDebrief = await AsyncStorage.getItem(STORAGE_KEYS.LAST_DEBRIEF);
      if (lastDebrief === today) return;

      // Past the user's scheduled nightly time?
      if (!isPastDebriefTime(user.nightlyTime || "21:00")) return;

      // Compute domain deltas from today's baseline
      const baseline = dailyBaseline;
      const domainDeltas: Record<Domain, number> = {
        BODY: 0,
        MIND: 0,
        WEALTH: 0,
        DISCIPLINE: 0,
      };
      if (baseline && baseline.date === today) {
        for (const d of DOMAINS) {
          const current = domainScores.find(s => s.domain === d)?.score ?? 50;
          domainDeltas[d] = parseFloat((current - (baseline.scores[d] ?? 50)).toFixed(1));
        }
      }

      const questCompleted = quests.filter(q => q.status === "complete").length;
      const questTotal = quests.length;
      const verdict = computeVerdict(domainDeltas, questCompleted, questTotal);
      const shadowGap = shadowSelf.gap;

      // Build domain scores object for API
      const scores = {
        BODY: domainScores.find(s => s.domain === "BODY")?.score ?? 50,
        MIND: domainScores.find(s => s.domain === "MIND")?.score ?? 50,
        WEALTH: domainScores.find(s => s.domain === "WEALTH")?.score ?? 50,
        DISCIPLINE: domainScores.find(s => s.domain === "DISCIPLINE")?.score ?? 50,
      };

      const aiText = await generateMessage({
        messageType: "nightly_debrief",
        username: user.username,
        rank: user.rank,
        domainScores: scores,
        trajectory,
        shadowActive: shadowSelf.active,
        shadowGap,
        questCount: questTotal,
        completedQuestCount: questCompleted,
        primaryGoal: user.primaryGoal,
        dayNumber: user.dayNumber,
      });

      await setPendingDebrief({
        date: today,
        domainDeltas,
        questCompleted,
        questTotal,
        shadowGap,
        aiText,
        verdict,
      });
    } finally {
      checking.current = false;
    }
  }, [
    user,
    pendingDebrief,
    domainScores,
    quests,
    shadowSelf,
    trajectory,
    dailyBaseline,
    generateMessage,
    setPendingDebrief,
  ]);

  return { checkAndTriggerDebrief, pendingDebrief, acknowledgeDebrief };
}
