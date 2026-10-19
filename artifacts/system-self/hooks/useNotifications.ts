// Keeps the device's notification state in step with the account: local reminders follow the briefing/debrief times and
// the prefs, the push token follows the permission, and everything of ours is cancelled once the session ends.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useGameStateQuery } from "@/hooks/useGameState";
import { api } from "@/lib/api/client";
import {
  cancelOurReminders,
  fetchNotificationPrefs,
  initNotifications,
  notificationPrefsKey,
  onPermissionRequested,
  registerPushToken,
  syncReminders,
} from "@/lib/notifications";

export function useNotificationPrefsQuery() {
  const { status, user } = useAuth();
  const userId = status === "signed_in" ? (user?.id ?? null) : null;
  return useQuery({
    queryKey: notificationPrefsKey(userId),
    queryFn: () => fetchNotificationPrefs(api),
    enabled: !!userId,
  });
}

export function useNotificationSync(): void {
  const { status, user } = useAuth();
  const game = useGameStateQuery().data;
  const profile = game?.profile ?? null;
  const today = game?.today ?? null;
  const prefs = useNotificationPrefsQuery().data ?? null;
  const [tick, setTick] = useState(0);

  // Re-plan when the app returns to the foreground (the window is 14 days) or the permission was just granted.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && setTick((n) => n + 1));
    const off = onPermissionRequested(() => setTick((n) => n + 1));
    return () => {
      sub.remove();
      off();
    };
  }, []);

  useEffect(() => {
    void initNotifications();
  }, []);

  useEffect(() => {
    if (status === "signed_out") void cancelOurReminders();
  }, [status]);

  const timezone = user?.timezone ?? null;
  const morningTime = profile?.morningTime;
  const nightlyTime = profile?.nightlyTime;
  const dayNumber = profile?.dayNumber;
  useEffect(() => {
    if (status !== "signed_in" || !timezone || !morningTime || !nightlyTime || dayNumber === undefined || !today || !prefs) return;
    void syncReminders({
      timezone,
      morningTime,
      nightlyTime,
      morning: prefs.morning,
      nightly: prefs.nightly,
      anchor: { date: today, dayNumber },
    });
    void registerPushToken(api);
  }, [status, timezone, morningTime, nightlyTime, dayNumber, today, prefs?.morning, prefs?.nightly, tick]);
}
