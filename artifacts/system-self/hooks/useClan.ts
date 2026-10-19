// Clans from the server: the user's clan polled every minute while a clan screen is focused. Create, join, leave,
// remove and transfer are plain mutations sent after the outbox; each refetches every clan query afterwards.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useGameUserId } from "@/hooks/useGameState";
import { useScreenFocused } from "@/hooks/useSocial";
import { api } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import { newClientId, type MutationResult } from "@/lib/game/actions";
import { clanLeaderboardKey, clanRootKeys, clanSearchKey, myClanKey } from "@/lib/clan/keys";
import {
  createClan,
  fetchClanLeaderboard,
  fetchMyClan,
  joinClanByCode,
  joinClanById,
  leaveClan,
  removeClanMember,
  searchClans,
  transferClanLeader,
  type ClanDraft,
} from "@/lib/clan/clan";
import { socialRefetchInterval } from "@/lib/social/social";

export function useMyClanQuery() {
  const userId = useGameUserId();
  const focused = useScreenFocused();
  return useQuery({
    queryKey: myClanKey(userId),
    queryFn: () => fetchMyClan(api),
    enabled: !!userId,
    refetchInterval: socialRefetchInterval(focused),
  });
}

export function useClanLeaderboardQuery() {
  const userId = useGameUserId();
  const focused = useScreenFocused();
  return useQuery({
    queryKey: clanLeaderboardKey(userId),
    queryFn: () => fetchClanLeaderboard(api),
    enabled: !!userId,
    refetchInterval: socialRefetchInterval(focused),
  });
}

/** Clans matching `q` (an empty q lists clans by rank). */
export function useClanSearchQuery(q: string) {
  const userId = useGameUserId();
  const trimmed = q.trim();
  return useQuery({
    queryKey: clanSearchKey(userId, trimmed),
    queryFn: () => searchClans(api, trimmed),
    enabled: !!userId,
  });
}

export function useClanActions() {
  const queryClient = useQueryClient();
  const userId = useGameUserId();
  const outbox = getOutbox();
  const run = useCallback(
    async <T>(prefix: string, send: (clientId: string) => Promise<MutationResult<T>>): Promise<MutationResult<T>> => {
      try {
        return await send(newClientId(prefix));
      } finally {
        await Promise.all(clanRootKeys(userId).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      }
    },
    [queryClient, userId],
  );
  return {
    create: (draft: ClanDraft) => run("clan-create", (id) => createClan(api, outbox, draft, id)),
    joinById: (clanId: string) => run("clan-join", (id) => joinClanById(api, outbox, clanId, id)),
    joinByCode: (code: string) => run("clan-join-code", (id) => joinClanByCode(api, outbox, code, id)),
    leave: () => run("clan-leave", (id) => leaveClan(api, outbox, id)),
    remove: (memberUserId: string) => run("clan-remove", (id) => removeClanMember(api, outbox, memberUserId, id)),
    transfer: (memberUserId: string) => run("clan-leader", (id) => transferClanLeader(api, outbox, memberUserId, id)),
  };
}
