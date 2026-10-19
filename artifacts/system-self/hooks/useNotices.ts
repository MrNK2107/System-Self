// Unseen server notices, one modal group at a time. A notice is marked seen only after its modal is dismissed.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGameStateQuery, useGameUserId } from "@/hooks/useGameState";
import { api } from "@/lib/api/client";
import { fetchNotices, markNoticesSeen, newClientId } from "@/lib/game/actions";
import { noticesKey } from "@/lib/game/keys";
import { mergeNotices, nextNoticeGroup, noticeView, parseNotices, type NoticeGroup, type NoticeView } from "@/lib/game/notices";

interface MorePage {
  items: unknown[];
  hasMore: boolean;
}

export function useNotices(): { group: NoticeGroup | null; view: NoticeView | null; dismiss: () => Promise<void> } {
  const queryClient = useQueryClient();
  const userId = useGameUserId();
  const stateQ = useGameStateQuery();
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(() => new Set());
  const [more, setMore] = useState<MorePage | null>(null);
  const unsent = useRef(new Set<string>());
  const busy = useRef(false);

  // A different account starts from a clean slate.
  useEffect(() => {
    setAcknowledged(new Set());
    setMore(null);
    unsent.current.clear();
  }, [userId]);

  const fromState = useMemo(() => parseNotices(stateQ.data?.unseenNotices ?? []), [stateQ.data]);
  const fromMore = useMemo(() => parseNotices(more?.items ?? []), [more]);
  const notices = useMemo(() => mergeNotices(fromState.notices, fromMore.notices), [fromState, fromMore]);
  const hasMore = more ? more.hasMore : (stateQ.data?.hasMoreNotices ?? false);

  /** Sends every id not yet confirmed by the server. True when nothing is left unsent. */
  const sendSeen = useCallback(async (ids: readonly string[]): Promise<boolean> => {
    ids.forEach((id) => unsent.current.add(id));
    const batch = [...unsent.current];
    if (batch.length === 0) return true;
    const { handled, error } = await markNoticesSeen(api, batch, newClientId("seen"));
    handled.forEach((id) => unsent.current.delete(id)); // only what the server confirmed; the rest is retried
    return error === null; // retried with the next dismissal or state refresh
  }, []);

  // Kinds this build does not know are skipped by parseNotices and left unseen for a newer client.

  // A fresh state means the server is reachable again: retry seen marks that failed earlier.
  useEffect(() => {
    if (stateQ.dataUpdatedAt && unsent.current.size > 0) void sendSeen([]);
  }, [stateQ.dataUpdatedAt, sendSeen]);

  const nextGroup = useMemo(() => nextNoticeGroup(notices, acknowledged), [notices, acknowledged]);
  // A state refetch rebuilds the notice objects; the modal must not see a new payload for the same notices
  // (FailureModal would restart its animation and re-request its AI message). Identity follows the ids.
  const groupKey = nextGroup ? nextGroup.notices.map((n) => n.id).join(",") : "";
  const current = useMemo(
    () => (nextGroup ? { group: nextGroup, view: noticeView(nextGroup) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupKey],
  );
  const group = current?.group ?? null;
  const view = current?.view ?? null;

  const dismiss = useCallback(async () => {
    if (!group || busy.current) return;
    busy.current = true;
    try {
      const ids = group.notices.map((n) => n.id);
      const nextAcknowledged = new Set([...acknowledged, ...ids]);
      setAcknowledged(nextAcknowledged);
      const sent = await sendSeen(ids);
      // The server holds more unseen notices than it returned: fetch the next page once these are marked seen.
      if (sent && hasMore && !nextNoticeGroup(notices, nextAcknowledged)) {
        try {
          const page = await queryClient.fetchQuery({
            queryKey: noticesKey(userId),
            queryFn: () => fetchNotices(api),
            staleTime: 0,
          });
          setMore(page);
        } catch {
          // Offline: the next state refresh carries them.
        }
      }
    } finally {
      busy.current = false;
    }
  }, [group, acknowledged, sendSeen, hasMore, notices, queryClient, userId]);

  return { group, view, dismiss };
}
