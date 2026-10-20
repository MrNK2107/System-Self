import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { NoticeLine, NoticeShell } from "@/components/SystemNoticeModal";
import { Button } from "@/components/ui/Button";
import { space } from "@/constants/type";
import { useAuth } from "@/context/AuthContext";
import { useGameStateQuery } from "@/hooks/useGameState";
import { currentPermissionAction, markPrompted, requestPermission } from "@/lib/notifications";
import { PERMISSION_EXPLANATION } from "@/lib/notifications-core";

/**
 * Asked once, right after onboarding: the SYSTEM explanation first, then the OS dialog. After either answer the app
 * never asks by itself again; the notification settings screen links to the OS settings after a denial.
 */
export function NotificationPrompt() {
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
    <NoticeShell visible={visible} title="NOTIFICATIONS" onClose={() => void close(false)}>
      <NoticeLine text={PERMISSION_EXPLANATION} />
      <View style={s.actions}>
        <Button label="Allow" block loading={busy} onPress={() => void close(true)} />
        <Button label="Not now" variant="text" block disabled={busy} onPress={() => void close(false)} />
      </View>
    </NoticeShell>
  );
}

const s = StyleSheet.create({
  actions: { gap: space.xs, marginTop: space.sm },
});
