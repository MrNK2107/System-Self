import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space, type } from "@/constants/type";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

/** Thin bar under the status bar: offline (cached data) and/or a mutation held back behind queued logs. */
export function OfflineBar() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { offline, syncBlocked } = useApp();
  if (!offline && !syncBlocked) return null;

  // Held back while offline: reconnecting clears it. Held back while online: a queued log is stuck (5xx and
  // the like) and the outbox keeps retrying it.
  const syncLine = syncBlocked ? (offline ? "Sync pending. Reconnect to continue." : "Sync stalled. Retrying.") : null;
  const parts = [offline ? "Offline. Showing saved data." : null, syncLine].filter(Boolean);

  return (
    <View
      pointerEvents="none"
      style={[styles.bar, { top: insets.top, backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="alert"
    >
      <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
        {parts.join("  ·  ")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    minHeight: 24,
    paddingHorizontal: space.md,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
});
