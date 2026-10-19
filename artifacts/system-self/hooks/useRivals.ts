// Rivals from the server: GET /api/rivals polled every minute while the Rivals tab is focused. Challenge,
// acknowledge, transmission and read marks are plain mutations sent after the outbox (queued logs land first).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { RankedDomain } from "@workspace/contracts";
import { useGameUserId } from "@/hooks/useGameState";
import { useScreenFocused } from "@/hooks/useSocial";
import { api } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import { newClientId, type MutationResult } from "@/lib/game/actions";
import { gameStateKey, noticesKey } from "@/lib/game/keys";
import { rivalsKey } from "@/lib/social/keys";
import { ackRivalChallenge, declareRivalChallenge, fetchRivals, markTauntsRead, tauntRival } from "@/lib/social/rivals";
import { socialRefetchInterval } from "@/lib/social/social";

export function useRivalsQuery() {
  const userId = useGameUserId();
  const focused = useScreenFocused();
  return useQuery({
    queryKey: rivalsKey(userId),
    queryFn: () => fetchRivals(api),
    enabled: !!userId,
    refetchInterval: socialRefetchInterval(focused),
  });
}

export function useRivalActions() {
  const queryClient = useQueryClient();
  const userId = useGameUserId();
  const outbox = getOutbox();
  const run = useCallback(
    async <T>(prefix: string, send: (clientId: string) => Promise<MutationResult<T>>): Promise<MutationResult<T>> => {
      try {
        return await send(newClientId(prefix));
      } finally {
        await queryClient.invalidateQueries({ queryKey: rivalsKey(userId) });
      }
    },
    [queryClient, userId],
  );
  return {
    challenge: (assignmentId: string, domain: RankedDomain) =>
      run("rival-challenge", (id) => declareRivalChallenge(api, outbox, assignmentId, domain, id)),
    acknowledge: async (challengeId: string) => {
      const r = await run("rival-ack", (id) => ackRivalChallenge(api, outbox, challengeId, id));
      // The ack also marks the result notice seen: refresh what carries unseen notices.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: gameStateKey(userId) }),
        queryClient.invalidateQueries({ queryKey: noticesKey(userId) }),
      ]);
      return r;
    },
    taunt: (assignmentId: string) => run("rival-taunt", (id) => tauntRival(api, outbox, assignmentId, id)),
    markRead: () => run("rival-read", (id) => markTauntsRead(api, outbox, id)),
  };
}
