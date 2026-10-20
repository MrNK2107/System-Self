import { useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useState } from "react";
import { AppState, StyleSheet, Switch, Text, View } from "react-native";
import type { NotificationPrefs } from "@workspace/contracts";

import { SettingsNote, SettingsSection } from "@/components/SettingsParts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useNotificationPrefsQuery } from "@/hooks/useNotifications";
import { api } from "@/lib/api/client";
import {
  getPermissionState,
  markPrompted,
  notificationPrefsKey,
  openOsSettings,
  requestPermission,
  updateNotificationPrefs,
  type PermissionState,
} from "@/lib/notifications";
import { PERMISSION_EXPLANATION } from "@/lib/notifications-core";

const ROWS: { key: keyof NotificationPrefs; label: string; detail: string }[] = [
  { key: "morning", label: "Morning briefing", detail: "Your briefing, at your briefing time." },
  { key: "nightly", label: "Nightly verdict", detail: "The day's verdict, at your debrief time." },
  { key: "events", label: "System events", detail: "Rank changes, rivals, raids and expiring quests. Few, and ranked by weight." },
];

export default function NotificationSettingsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const prefsQ = useNotificationPrefsQuery();
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const refresh = useCallback(() => void getPermissionState().then(setPermission), []);
  useEffect(() => {
    refresh();
    // Returning from the OS settings screen: read the permission again.
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);

  const toggle = async (key: keyof NotificationPrefs, value: boolean) => {
    if (!user || !prefsQ.data) return;
    setError(null);
    const keyQ = notificationPrefsKey(user.id);
    const before = prefsQ.data;
    queryClient.setQueryData(keyQ, { ...before, [key]: value });
    try {
      queryClient.setQueryData(keyQ, await updateNotificationPrefs(api, { [key]: value }));
    } catch {
      queryClient.setQueryData(keyQ, before);
      setError("The system is out of reach. The change was not saved.");
    }
  };

  const allow = async () => {
    if (!user || asking) return;
    setAsking(true);
    await markPrompted(user.id);
    setPermission(await requestPermission());
    setAsking(false);
  };

  return (
    <Screen title="Notifications" back>
      {permission?.status === "granted" ? null : permission?.status === "undetermined" ? (
        <SettingsSection label="THIS DEVICE">
          <View style={s.panel}>
            <Text style={[type.body, { color: colors.foreground }]}>{PERMISSION_EXPLANATION}</Text>
            <Button label="Allow" block loading={asking} onPress={() => void allow()} />
          </View>
        </SettingsSection>
      ) : permission ? (
        <SettingsSection label="THIS DEVICE">
          <ListRow title="Notifications are off for this device" subtitle="Open the system settings to turn them on" chevron onPress={() => void openOsSettings()} />
        </SettingsSection>
      ) : null}

      {prefsQ.data ? (
        <SettingsSection label="WHAT THE SYSTEM SENDS" footer="At most three per day, reminders included.">
          {ROWS.map((row) => (
            <ListRow
              key={row.key}
              title={row.label}
              subtitle={row.detail}
              onPress={() => void toggle(row.key, !prefsQ.data![row.key])}
              accessibilityLabel={`${row.label}, ${prefsQ.data![row.key] ? "on" : "off"}`}
              trailing={
                <Switch
                  value={prefsQ.data![row.key]}
                  onValueChange={(v) => void toggle(row.key, v)}
                  accessibilityLabel={row.label}
                  trackColor={{ true: colors.accentFill, false: colors.muted }}
                  thumbColor={colors.foreground}
                />
              }
            />
          ))}
        </SettingsSection>
      ) : (
        <SettingsNote
          tone={prefsQ.isError ? "error" : "info"}
          message={prefsQ.isError ? "The system is out of reach." : "Loading."}
          onRetry={prefsQ.isError ? () => void prefsQ.refetch() : undefined}
        />
      )}

      {error ? <SettingsNote message={error} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  panel: { padding: space.md, gap: space.md },
});
