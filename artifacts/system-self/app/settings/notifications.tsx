import { useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useState } from "react";
import { AppState, StyleSheet, Switch, Text, View } from "react-native";
import type { NotificationPrefs } from "@workspace/contracts";

import { AuthButton, AuthNotice, AuthShell } from "@/components/AuthShell";
import { Separator, SettingsCard, SettingsRow } from "@/components/SettingsParts";
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
    <AuthShell tag="SETTINGS" title="Notifications" back>
      {permission?.status === "granted" ? null : permission?.status === "undetermined" ? (
        <SettingsCard>
          <View style={s.panel}>
            <Text style={[s.line, { color: colors.foreground }]}>{PERMISSION_EXPLANATION}</Text>
            <AuthButton label="ALLOW" loading={asking} onPress={() => void allow()} />
          </View>
        </SettingsCard>
      ) : permission ? (
        <SettingsCard>
          <SettingsRow icon="settings" label="Notifications are off for this device" value="OPEN SETTINGS" onPress={() => void openOsSettings()} />
        </SettingsCard>
      ) : null}

      {prefsQ.data ? (
        <SettingsCard>
          {ROWS.map((row, i) => (
            <React.Fragment key={row.key}>
              {i > 0 ? <Separator /> : null}
              <View style={s.toggleRow}>
                <View style={s.toggleText}>
                  <Text style={[s.label, { color: colors.foreground }]}>{row.label}</Text>
                  <Text style={[s.detail, { color: colors.mutedForeground }]}>{row.detail}</Text>
                </View>
                <Switch
                  value={prefsQ.data[row.key]}
                  onValueChange={(v) => void toggle(row.key, v)}
                  accessibilityLabel={row.label}
                  trackColor={{ true: colors.primary, false: colors.muted }}
                />
              </View>
            </React.Fragment>
          ))}
        </SettingsCard>
      ) : (
        <AuthNotice
          tone={prefsQ.isError ? "error" : "info"}
          message={prefsQ.isError ? "The system is out of reach." : "Loading."}
          onRetry={prefsQ.isError ? () => void prefsQ.refetch() : undefined}
        />
      )}

      {error ? <AuthNotice message={error} /> : null}
      <Text style={[s.detail, { color: colors.mutedForeground }]}>At most three per day, reminders included.</Text>
    </AuthShell>
  );
}

const s = StyleSheet.create({
  panel: { paddingVertical: 16, gap: 14 },
  line: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingVertical: 10 },
  toggleText: { flex: 1, gap: 2 },
  label: { fontSize: 13 },
  detail: { fontSize: 11, lineHeight: 16 },
});
