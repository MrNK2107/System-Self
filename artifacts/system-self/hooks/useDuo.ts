// Party of Two from the server: polled every minute while the screen is focused. Every mutation is a plain request
// sent after the outbox; each refetches the duo view afterwards.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { DuoCheckinKind } from "@workspace/contracts";
import { useGameUserId } from "@/hooks/useGameState";
import { useScreenFocused } from "@/hooks/useSocial";
import { api } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import { answerDuoInvite, fetchDuo, inviteToDuo, leaveDuo, sendDuoCheckin } from "@/lib/duo/duo";
import { duoKey } from "@/lib/duo/keys";
import { newClientId, type MutationResult } from "@/lib/game/actions";
import { socialRefetchInterval } from "@/lib/social/social";

export function useDuoQuery() {
  const userId = useGameUserId();
  const focused = useScreenFocused();
  return useQuery({
    queryKey: duoKey(userId),
    queryFn: () => fetchDuo(api),
    enabled: !!userId,
    refetchInterval: socialRefetchInterval(focused),
  });
}

export function useDuoActions() {
  const queryClient = useQueryClient();
  const userId = useGameUserId();
  const outbox = getOutbox();
  const run = useCallback(
    async <T>(prefix: string, send: (clientId: string) => Promise<MutationResult<T>>): Promise<MutationResult<T>> => {
      try {
        return await send(newClientId(prefix));
      } finally {
        await queryClient.invalidateQueries({ queryKey: duoKey(userId) });
      }
    },
    [queryClient, userId],
  );
  return {
    invite: (username: string) => run("duo-invite", (id) => inviteToDuo(api, outbox, username, id)),
    answer: (inviteId: string, verb: "accept" | "decline") => run(`duo-${verb}`, (id) => answerDuoInvite(api, outbox, inviteId, verb, id)),
    leave: () => run("duo-leave", (id) => leaveDuo(api, outbox, id)),
    checkin: (kind: DuoCheckinKind) => run("duo-checkin", (id) => sendDuoCheckin(api, outbox, kind, id)),
  };
}
