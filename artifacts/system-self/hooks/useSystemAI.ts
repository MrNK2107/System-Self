// SYSTEM messages from POST /api/messages. The server builds the context; every failure falls back quietly.
import { useCallback } from "react";
import { api } from "@/lib/api/client";
import { fetchMessage, type MessageType } from "@/lib/game/messages";

export type { MessageType };

export function useSystemAI() {
  const generateMessage = useCallback(
    (type: MessageType, opts?: { extraContext?: string }): Promise<string> => fetchMessage(api, type, opts),
    [],
  );

  return { generateMessage };
}
