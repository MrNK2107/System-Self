import { useState } from "react";
import type { Domain } from "@/context/AppContext";

interface DomainScores {
  BODY: number;
  MIND: number;
  WEALTH: number;
  DISCIPLINE: number;
}

type MessageType =
  | "morning_briefing"
  | "nightly_debrief"
  | "quest_assignment"
  | "rank_change"
  | "shadow_self"
  | "milestone"
  | "failure_response"
  | "streak_break"
  | "shadow_confrontation";

interface GeneratedQuest {
  title: string;
  description: string;
  domain: Domain;
  type: "daily" | "weekly";
}

async function fetchApi<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "";
  const res = await fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
}

export function useSystemAI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateMessage = async (params: {
    messageType: MessageType;
    username: string;
    rank: string;
    domainScores: DomainScores;
    trajectory: string;
    shadowActive: boolean;
    shadowGap: number;
    questCount: number;
    completedQuestCount: number;
    primaryGoal: string;
    dayNumber: number;
    rivalMovement?: string | null;
  }): Promise<string> => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ message: string }>("/system/message", params);
      return data.message;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return getFallbackMessage(params.messageType, params);
    } finally {
      setLoading(false);
    }
  };

  const generateQuests = async (params: {
    username: string;
    rank: string;
    domainScores: DomainScores;
    primaryGoal: string;
    weakestDomain: string;
    recentLogs: string[];
  }): Promise<GeneratedQuest[]> => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ quests: GeneratedQuest[] }>("/system/quests", params);
      return data.quests;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return getDefaultQuests(params.weakestDomain as Domain);
    } finally {
      setLoading(false);
    }
  };

  return { generateMessage, generateQuests, loading, error };
}

function getFallbackMessage(
  type: MessageType,
  params: { dayNumber: number; domainScores: DomainScores; questCount: number }
): string {
  const fallbacks: Record<MessageType, string> = {
    morning_briefing: `Day ${params.dayNumber}. Three quests active. Your scores are being watched. Today's verdict begins now.`,
    nightly_debrief: `BODY: ${params.domainScores.BODY.toFixed(1)}. MIND: ${params.domainScores.MIND.toFixed(1)}. DISCIPLINE: ${params.domainScores.DISCIPLINE.toFixed(1)}. ${params.questCount} quests logged. Verdict: Insufficient.`,
    quest_assignment: `New quests assigned. Check your board.`,
    rank_change: `Rank updated. Noted.`,
    shadow_self: `Your Shadow Self has been initialized. It is already ahead of you. This is information.`,
    milestone: `Progress logged. Continue.`,
    failure_response: `Quest failure logged. The timestamp is permanent.`,
    streak_break: `Streak data erased. The gap with your Shadow Self just widened. This is recorded.`,
    shadow_confrontation: `You are still behind. That gap does not close on its own. Log something.`,
  };
  return fallbacks[type];
}

function getDefaultQuests(weakestDomain: Domain): GeneratedQuest[] {
  return [
    {
      title: `Address your ${weakestDomain} score`,
      description: `Complete one logged activity in your weakest domain today.`,
      domain: weakestDomain,
      type: "daily",
    },
    {
      title: "Log your sleep",
      description: "Log your sleep duration and quality rating tonight.",
      domain: "BODY",
      type: "daily",
    },
    {
      title: "90-minute deep work",
      description: "Complete one uninterrupted 90-minute focus session. Log it.",
      domain: "MIND",
      type: "daily",
    },
    {
      title: "7-day logging streak",
      description: "Log at least one entry per day for the next 7 days without missing.",
      domain: "DISCIPLINE",
      type: "weekly",
    },
  ];
}
