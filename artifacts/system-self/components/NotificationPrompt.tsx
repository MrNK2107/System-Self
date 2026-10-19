import React, { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";

import { AuthButton, AuthLink } from "@/components/AuthShell";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useGameStateQuery } from "@/hooks/useGameState";
import { currentPermissionAction, markPrompted, requestPermission } from "@/lib/notifications";
import { PERMISSION_EXPLANATION } from "@/lib/notifications-core";

/**
 * Asked once, right after onboarding: the SYSTEM explanation first, then the OS dialog. After either answer the app
 * never asks by itself again; the notification settings screen links to the OS settings after a denial.
 */
export function NotificationPrompt() {
  const colors = useColors();
  const { status, user } = useAuth();
  const onboarded = !!useGameStateQuery().data?.profile.onboarded;
  const userId = status === "signed_in" ? (user?.id ?? null) : null;
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId || !onboarded) {
      setVisible(false);
      return;
    }
    let cancelled = false;
    void currentPermissionAction(userId).then((action) => {
      if (!cancelled) setVisible(action === "explain");
    });
    return () => {
      cancelled = true;
    };
  }, [userId, onboarded]);

  if (!userId) return null;

  const close = async (ask: boolean) => {
    if (busy) return;
    setBusy(true);
    await markPrompted(userId);
    setVisible(false);
    if (ask) await requestPermission();
    setBusy(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void close(false)}>
      <View style={s.backdrop}>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.tag, { color: colors.mutedForeground }]}>SYSTEM // NOTIFICATIONS</Text>
          <Text style={[s.line, { color: colors.foreground }]}>{PERMISSION_EXPLANATION}</Text>
          <AuthButton label="ALLOW" loading={busy} onPress={() => void close(true)} />
          <AuthLink label="NOT NOW" onPress={() => void close(false)} />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", padding: 24 },
  card: { borderWidth: 1, borderRadius: 4, padding: 20, gap: 16 },
  tag: { fontSize: 9, letterSpacing: 2.5, fontWeight: "700" },
  line: { fontSize: 16, lineHeight: 24, fontWeight: "600" },
});
