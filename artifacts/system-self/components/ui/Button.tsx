import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

type Variant = "filled" | "tonal" | "text" | "destructive";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

/** Material button in the Shadow Monarch voice: 48dp tall, ripple feedback, caps label. */
export function Button({ label, onPress, variant = "filled", disabled, loading, block, style, accessibilityLabel }: ButtonProps) {
  const colors = useColors();
  const inactive = disabled || loading;
  const fill =
    variant === "filled" ? colors.accentFill : variant === "tonal" ? colors.muted : variant === "destructive" ? colors.destructive : "transparent";
  const ink =
    variant === "filled" ? colors.primaryForeground : variant === "destructive" ? colors.destructiveForeground : colors.primary;

  return (
    <View style={[s.clip, block && s.block, inactive && s.inactive, style]}>
      <Pressable
        onPress={onPress}
        disabled={inactive}
        android_ripple={{ color: variant === "filled" ? "rgba(0,0,0,0.18)" : "rgba(168,121,255,0.18)" }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: !!inactive, busy: !!loading }}
        style={[s.button, { backgroundColor: fill }, variant === "text" && s.textButton]}
      >
        {loading ? <ActivityIndicator color={ink} /> : <Text style={[type.label, { color: ink }]}>{label.toUpperCase()}</Text>}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  clip: { borderRadius: 4, overflow: "hidden", alignSelf: "flex-start" },
  block: { alignSelf: "stretch" },
  inactive: { opacity: 0.45 },
  button: { minHeight: 48, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" },
  textButton: { paddingHorizontal: 12 },
});
