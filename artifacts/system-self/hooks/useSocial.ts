// React Query hooks over the social endpoints. Social screens poll every minute, only while focused.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { api } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import { newClientId, type MutationResult } from "@/lib/game/actions";
import { followersCountKey, followingKey, socialProfileKey, socialRootKeys, socialSearchKey } from "@/lib/social/keys";
import {
  blockPlayer,
  fetchFollowersCount,
  fetchFollowing,
  fetchSocialProfile,
  followPlayer,
  normalizeSearchQuery,
  reportPlayer,
  searchPlayers,
  socialRefetchInterval,
  unblockPlayer,
  unfollowPlayer,
} from "@/lib/social/social";
import { useGameUserId } from "@/hooks/useGameState";

/** True while the calling screen is focused (so polling stops when it is covered or backgrounded). */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}

export function useFollowingQuery() {
  const userId = useGameUserId();
  const focused = useScreenFocused();
  return useQuery({
    queryKey: followingKey(userId),
    queryFn: () => fetchFollowing(api),
    enabled: !!userId,
    refetchInterval: socialRefetchInterval(focused),
  });
}

export function useFollowersCountQuery() {
  const userId = useGameUserId();
  const focused = useScreenFocused();
  return useQuery({
    queryKey: followersCountKey(userId),
    queryFn: () => fetchFollowersCount(api),
    enabled: !!userId,
    refetchInterval: socialRefetchInterval(focused),
  });
}

/** Search results for `text` (nothing until it is at least 3 characters). */
export function useSearchQuery(text: string) {
  const userId = useGameUserId();
  const q = normalizeSearchQuery(text);
  return useQuery({
    queryKey: socialSearchKey(userId, q ?? ""),
    queryFn: () => searchPlayers(api, q!),
    enabled: !!userId && q !== null,
  });
}

export function useSocialProfileQuery(handle: string) {
  const userId = useGameUserId();
  const focused = useScreenFocused();
  return useQuery({
    queryKey: socialProfileKey(userId, handle),
    queryFn: () => fetchSocialProfile(api, handle),
    enabled: !!userId && handle.length > 0,
    refetchInterval: socialRefetchInterval(focused),
  });
}

/** Follow, unfollow, block, unblock and report. Each refetches the social views afterwards. */
export function useSocialActions() {
  const queryClient = useQueryClient();
  const userId = useGameUserId();
  const outbox = getOutbox();
  const refresh = useCallback(async () => {
    await Promise.all(socialRootKeys(userId).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  }, [queryClient, userId]);
  const run = useCallback(
    async <T>(send: (clientId: string) => Promise<MutationResult<T>>): Promise<MutationResult<T>> => {
      const r = await send(newClientId("social"));
      if (r.ok) await refresh();
      return r;
    },
    [refresh],
  );
  return {
    follow: (handle: string) => run((id) => followPlayer(api, outbox, handle, id)),
    unfollow: (handle: string) => run((id) => unfollowPlayer(api, outbox, handle, id)),
    block: (handle: string) => run((id) => blockPlayer(api, outbox, handle, id)),
    unblock: (handle: string) => run((id) => unblockPlayer(api, outbox, handle, id)),
    report: (handle: string, reason: string) => run((id) => reportPlayer(api, outbox, handle, reason, id)),
  };
}
