// React Query hooks over the game endpoints, plus a live view of the outbox.
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api/client";
import { getOutbox, type FailedOutboxItem, type OutboxItem } from "@/lib/api/outbox";
import { fetchChains, fetchGameState, fetchLogs, fetchQuests } from "@/lib/game/actions";
import { chainsKey, gameStateKey, logsKey, questsKey } from "@/lib/game/keys";

/** The signed-in user's id, or null. Game queries run only while this is set. */
export function useGameUserId(): string | null {
  const { status, user } = useAuth();
  return status === "signed_in" ? (user?.id ?? null) : null;
}

/** GET /api/state. Task 3 seeds this key right after onboarding. */
export function useGameStateQuery() {
  const userId = useGameUserId();
  return useQuery({ queryKey: gameStateKey(userId), queryFn: () => fetchGameState(api), enabled: !!userId });
}

export function useLogsQuery() {
  const userId = useGameUserId();
  return useQuery({ queryKey: logsKey(userId), queryFn: () => fetchLogs(api), enabled: !!userId });
}

export function useQuestsQuery() {
  const userId = useGameUserId();
  return useQuery({ queryKey: questsKey(userId), queryFn: () => fetchQuests(api), enabled: !!userId });
}

export function useChainsQuery() {
  const userId = useGameUserId();
  return useQuery({ queryKey: chainsKey(userId), queryFn: () => fetchChains(api), enabled: !!userId, staleTime: 5 * 60_000 });
}

export interface OutboxSnapshot {
  pending: OutboxItem[];
  failed: FailedOutboxItem[];
}

const EMPTY: OutboxSnapshot = { pending: [], failed: [] };
let snapshot: OutboxSnapshot = EMPTY;

function refreshSnapshot() {
  const outbox = getOutbox();
  snapshot = { pending: outbox.pending(), failed: outbox.failed() };
}

function subscribe(onChange: () => void): () => void {
  const outbox = getOutbox();
  const unsubscribe = outbox.subscribe(() => {
    refreshSnapshot();
    onChange();
  });
  // The outbox loads from storage asynchronously; publish its state once it is ready.
  void outbox
    .ready()
    .then(() => {
      refreshSnapshot();
      onChange();
    })
    .catch(() => undefined);
  return unsubscribe;
}

/** The signed-in user's queued and failed outbox items, re-rendering on every change. */
export function useOutboxSnapshot(): OutboxSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}
