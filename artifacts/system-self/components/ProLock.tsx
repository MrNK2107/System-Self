// The lock a PRO-gated action shows once the server answers 402 pro_required (see lib/api/pro.ts).
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { useColors } from "@/hooks/useColors";
import { PAYWALL_ROUTE, PRO_LOCK_LABEL } from "@/lib/api/pro";

export function ProLock({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={() => router.push(PAYWALL_ROUTE)}
      accessibilityRole="button"
      accessibilityLabel={label ? `${label}: ${PRO_LOCK_LABEL} required` : `${PRO_LOCK_LABEL} required`}
      style={[s.lock, { borderColor: colors.primary + "60" }]}
    >
      <Feather name="lock" size={11} color={colors.primary} />
      <Text style={[s.text, { color: colors.primary }]}>{label ? `${label} // ${PRO_LOCK_LABEL}` : PRO_LOCK_LABEL}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  lock: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" },
  text: { fontSize: 9, fontWeight: "800", letterSpacing: 2 },
});
