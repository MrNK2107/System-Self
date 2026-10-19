import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { fetchBriefing, fetchQuietHours } from "@/lib/game/dungeon";
import { dungeonBriefingKey, quietHoursKey } from "@/lib/game/keys";
import { useGameUserId } from "@/hooks/useGameState";

const deviceToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** GET /api/gym/briefing. With no date the server picks the user's local today; the cache key follows the device day. */
export function useBriefing(date?: string) {
  const userId = useGameUserId();
  return useQuery({
    queryKey: dungeonBriefingKey(userId, date ?? `today:${deviceToday()}`),
    queryFn: () => fetchBriefing(api, date),
    enabled: !!userId,
  });
}

/** GET /api/gym/quiet-hours: the slot picker's suggestions (own scout reports only). */
export function useQuietHours(enabled = true) {
  const userId = useGameUserId();
  return useQuery({ queryKey: quietHoursKey(userId), queryFn: () => fetchQuietHours(api), enabled: enabled && !!userId });
}
