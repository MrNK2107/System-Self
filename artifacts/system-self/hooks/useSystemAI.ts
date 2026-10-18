// SYSTEM messages from POST /api/messages. The server builds the context; every failure falls back quietly.
import { useCallback } from "react";
import { api } from "@/lib/api/client";
import { fetchMessage, tryFetchMessage, type MessageType } from "@/lib/game/messages";

export type { MessageType };

export function useSystemAI() {
  const generateMessage = useCallback(
    (type: MessageType, opts?: { extraContext?: string }): Promise<string> => fetchMessage(api, type, opts),
    [],
  );

  const generateRivalTaunt = useCallback(
    async (params: { rivalCodename: string; rivalRank: string; rivalTrajectory: string }): Promise<string> => {
      const text = await tryFetchMessage(api, "rival_taunt", {
        extraContext: `Rival codename: ${params.rivalCodename}, Rival rank: ${params.rivalRank}`,
      });
      return text ?? getRivalTauntFallback(params.rivalCodename, params.rivalTrajectory);
    },
    [],
  );

  return { generateMessage, generateRivalTaunt };
}

function getRivalTauntFallback(rivalCodename: string, trajectory: string): string {
  const name = rivalCodename.split(" // ")[1] ?? rivalCodename;
  const taunts = [
    `Your logs are inconsistent. Mine are not. — ${name}`,
    `You missed yesterday. I did not. The gap grows. — ${name}`,
    `Watching your scores plateau from here. — ${name}`,
    `I was where you are. I didn't stay there. — ${name}`,
    trajectory === "up"
      ? `I'm accelerating. You'll see the gap in your dashboard. — ${name}`
      : `Even at stable I'm ahead of you. — ${name}`,
  ];
  return taunts[Math.floor(Math.random() * taunts.length)]!;
}
