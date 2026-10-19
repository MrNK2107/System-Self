// The nightly debrief: GET /api/debrief/today (polled on mount, on foreground and when it opens), shown once per
// date until acknowledged with POST /api/debrief/:date/ack.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useApp, type DebriefData } from "@/context/AppContext";
import { useGameUserId } from "@/hooks/useGameState";
import { api, ApiError } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import { debriefKey } from "@/lib/game/keys";
import { ackDebrief, fetchDebriefToday, toDebriefData, type DebriefToday } from "@/lib/game/messages";

const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
const FLUSH_WAIT_MS = 5_000;

/** Flushes the outbox, waiting at most FLUSH_WAIT_MS; never throws. */
async function flushBriefly(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, FLUSH_WAIT_MS);
  });
  const flush = getOutbox()
    .flush()
    .then(() => undefined, () => undefined);
  try {
    await Promise.race([flush, cap]);
  } finally {
    clearTimeout(timer);
  }
}

export function useNightlyDebrief(): {
  pendingDebrief: DebriefData | null;
  acknowledgeDebrief: () => Promise<void>;
  /** Today's debrief text once the debrief is open (acknowledged or not); null before that. */
  debriefText: string | null;
} {
  const queryClient = useQueryClient();
  const userId = useGameUserId();
  const { shadowSelf } = useApp();
  const q = useQuery({
    queryKey: debriefKey(userId),
    queryFn: async () => {
      // Today's debrief is written from today's logs: send queued ones first. Best-effort: offline, a stuck
      // queue or a slow link (capped wait) still loads whatever the server has.
      await flushBriefly();
      return fetchDebriefToday(api);
    },
    enabled: !!userId,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const refetch = q.refetch;

  // Dates acknowledged on this device but possibly not yet confirmed by the server.
  const [ackedDates, setAckedDates] = useState<ReadonlySet<string>>(() => new Set());
  const unsent = useRef(new Set<string>());
  const busy = useRef(false);

  useEffect(() => {
    setAckedDates(new Set());
    unsent.current.clear();
  }, [userId]);

  const sendAcks = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (const date of [...unsent.current]) {
        try {
          const r = await ackDebrief(api, getOutbox(), date, `debrief-ack-${date}`);
          if (!r.ok) break; // older logs still queued: retry on the next foreground
          unsent.current.delete(date);
        } catch (e) {
          // 404/409 never succeed on retry: drop the date. Network and 5xx errors retry on the next foreground.
          if (e instanceof ApiError && e.kind === "http" && (e.status === 404 || e.status === 409)) {
            unsent.current.delete(date);
            continue;
          }
          break;
        }
      }
    } finally {
      busy.current = false;
      void queryClient.invalidateQueries({ queryKey: debriefKey(userId) });
    }
  }, [queryClient, userId]);

  // Foreground: look for a newly opened debrief and retry acknowledgements that did not go through.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void refetch();
      if (unsent.current.size > 0) void sendAcks();
    });
    return () => sub.remove();
  }, [userId, refetch, sendAcks]);

  // While the debrief is closed, look again when it opens.
  const data: DebriefToday | undefined = q.data;
  const availableAt = data && !data.available ? data.availableAt : null;
  useEffect(() => {
    if (!availableAt) return;
    const wait = new Date(availableAt).getTime() - Date.now();
    if (!Number.isFinite(wait)) return;
    const timer = setTimeout(() => void refetch(), Math.min(Math.max(wait, 1000), MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [availableAt, refetch]);

  const debrief = data && data.available ? data.debrief : null;
  const pendingDebrief = useMemo(
    () => (debrief && !debrief.acknowledged && !ackedDates.has(debrief.date) ? toDebriefData(debrief, shadowSelf.gap) : null),
    [debrief, ackedDates, shadowSelf.gap],
  );

  const acknowledgeDebrief = useCallback(async () => {
    if (!debrief) return;
    const date = debrief.date;
    unsent.current.add(date);
    setAckedDates((prev) => new Set([...prev, date])); // the modal closes at once; the ack is retried if it fails
    await sendAcks();
  }, [debrief, sendAcks]);

  return { pendingDebrief, acknowledgeDebrief, debriefText: debrief?.text ?? null };
}
