// The lock a PRO-gated action shows once the server answers 402 pro_required (see lib/api/pro.ts).
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { PAYWALL_ROUTE, PRO_LOCK_LABEL } from "@/lib/api/pro";

/** A 48dp outlined pill that opens the paywall: "Older days · PRO". */
export function ProLock({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={[s.clip, { borderColor: colors.frame }]}>
      <Pressable
        onPress={() => router.push(PAYWALL_ROUTE)}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${PRO_LOCK_LABEL} required` : `${PRO_LOCK_LABEL} required`}
        android_ripple={{ color: "rgba(168,121,255,0.18)" }}
        style={s.lock}
      >
        <Feather name="lock" size={16} color={colors.primary} />
        <Text style={[type.label, { color: colors.primary }]}>{(label ? `${label} · ${PRO_LOCK_LABEL}` : PRO_LOCK_LABEL).toUpperCase()}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  clip: { borderWidth: 1, borderRadius: 4, overflow: "hidden", alignSelf: "flex-start" },
  lock: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md },
});
