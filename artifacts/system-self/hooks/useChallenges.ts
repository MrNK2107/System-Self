// Named challenges from the server: polled every minute while a challenge screen is focused. Create, accept and
// ignore are plain mutations sent after the outbox; each refetches the list afterwards.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { RankedDomain } from "@workspace/engine";
import { useGameUserId } from "@/hooks/useGameState";
import { useScreenFocused } from "@/hooks/useSocial";
import { api } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import { newClientId, type MutationResult } from "@/lib/game/actions";
import { acceptChallenge, createChallenge, fetchChallenges, ignoreChallenge, type ChallengeDraft } from "@/lib/challenges/challenges";
import { challengesKey } from "@/lib/challenges/keys";
import { socialRefetchInterval } from "@/lib/social/social";

export function useChallengesQuery() {
  const userId = useGameUserId();
  const focused = useScreenFocused();
  return useQuery({
    queryKey: challengesKey(userId),
    queryFn: () => fetchChallenges(api),
    enabled: !!userId,
    refetchInterval: socialRefetchInterval(focused),
  });
}

export function useChallengeActions() {
  const queryClient = useQueryClient();
  const userId = useGameUserId();
  const outbox = getOutbox();
  const run = useCallback(
    async <T>(prefix: string, send: (clientId: string) => Promise<MutationResult<T>>): Promise<MutationResult<T>> => {
      try {
        return await send(newClientId(prefix));
      } finally {
        await queryClient.invalidateQueries({ queryKey: challengesKey(userId) });
      }
    },
    [queryClient, userId],
  );
  return {
    create: (opponent: string, domain: RankedDomain, days: ChallengeDraft["days"]) =>
      run("challenge-create", (id) => createChallenge(api, outbox, { opponent, domain, days }, id)),
    accept: (challengeId: string) => run("challenge-accept", (id) => acceptChallenge(api, outbox, challengeId, id)),
    ignore: (challengeId: string) => run("challenge-ignore", (id) => ignoreChallenge(api, outbox, challengeId, id)),
  };
}
