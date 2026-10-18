// P3-T6: replaced by GET /api/debrief/today + POST /api/debrief/:date/ack. Until then the debrief stays a
// device-side summary (baseline and verdict below are display only; the server never reads them).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useRef, useState } from "react";
import { scoreRecord, useApp, type DebriefData, type Domain, type DebriefVerdict } from "@/context/AppContext";
import { ALL_DOMAINS as DOMAINS } from "@/constants/domains";
import { useSystemAI } from "@/hooks/useSystemAI";

const LAST_DEBRIEF_KEY = "@system_self:last_debrief";
const BASELINE_KEY = "@system_self:baseline";

interface DailyBaseline {
  date: string;
  scores: Record<Domain, number>;
}

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
  const { user, domainScores, quests, shadowSelf, trajectory } = useApp();
  const { generateMessage } = useSystemAI();
  const checking = useRef(false);
  const [pendingDebrief, setPendingDebrief] = useState<DebriefData | null>(null);

  const acknowledgeDebrief = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0]!;
    await AsyncStorage.setItem(LAST_DEBRIEF_KEY, today);
    await AsyncStorage.setItem(BASELINE_KEY, JSON.stringify({ date: today, scores: scoreRecord(domainScores) }));
    setPendingDebrief(null);
  }, [domainScores]);

  const checkAndTriggerDebrief = useCallback(async () => {
    if (!user || pendingDebrief || checking.current) return;
    checking.current = true;

    try {
      const today = new Date().toISOString().split("T")[0]!;

      // Already debriefed today?
      const lastDebrief = await AsyncStorage.getItem(LAST_DEBRIEF_KEY);
      if (lastDebrief === today) return;

      // The first check of the day records the morning baseline the deltas are measured from.
      let baseline: DailyBaseline | null = null;
      try {
        const raw = await AsyncStorage.getItem(BASELINE_KEY);
        baseline = raw ? (JSON.parse(raw) as DailyBaseline) : null;
      } catch {
        baseline = null;
      }
      if (!baseline || baseline.date !== today) {
        baseline = { date: today, scores: scoreRecord(domainScores) };
        await AsyncStorage.setItem(BASELINE_KEY, JSON.stringify(baseline));
      }

      // Past the user's scheduled nightly time?
      if (!isPastDebriefTime(user.nightlyTime || "21:00")) return;

      // Compute domain deltas from today's baseline
      const domainDeltas = {} as Record<Domain, number>;
      for (const d of DOMAINS) {
        const current = domainScores.find(s => s.domain === d)?.score ?? 0;
        domainDeltas[d] = parseFloat((current - (baseline.scores[d] ?? current)).toFixed(1));
      }

      const questCompleted = quests.filter(q => q.status === "complete").length;
      const questTotal = quests.length;
      const verdict = computeVerdict(domainDeltas, questCompleted, questTotal);
      const shadowGap = shadowSelf.gap;

      // Build domain scores object for API
      const scores = {
        BODY: domainScores.find(s => s.domain === "BODY")?.score ?? 0,
        MIND: domainScores.find(s => s.domain === "MIND")?.score ?? 0,
        WEALTH: domainScores.find(s => s.domain === "WEALTH")?.score ?? 0,
        DISCIPLINE: domainScores.find(s => s.domain === "DISCIPLINE")?.score ?? 0,
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

      setPendingDebrief({
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
    generateMessage,
  ]);

  return { checkAndTriggerDebrief, pendingDebrief, acknowledgeDebrief };
}
