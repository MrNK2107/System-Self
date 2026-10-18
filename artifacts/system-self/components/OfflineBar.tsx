import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

/** Thin bar under the status bar: offline (cached data) and/or a mutation held back behind queued logs. */
export function OfflineBar() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { offline, syncBlocked } = useApp();
  if (!offline && !syncBlocked) return null;

  const parts = [offline ? "OFFLINE — CACHED" : null, syncBlocked ? "Sync pending. Reconnect to continue." : null].filter(Boolean);

  return (
    <View
      pointerEvents="none"
      style={[styles.bar, { top: insets.top, backgroundColor: colors.muted, borderColor: colors.border }]}
      accessibilityRole="alert"
    >
      <Text style={[styles.text, { color: colors.mutedForeground }]} numberOfLines={1}>
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
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  text: { fontSize: 8, fontWeight: "700", letterSpacing: 2 },
});
