import { Feather } from "@expo/vector-icons";
import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Domain or state colour shown as a small dot before the title. */
  dot?: string;
  /** Right-hand content (a value, a time, a toggle). */
  trailing?: ReactNode;
  /** Show a chevron (navigates somewhere). */
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

/** One line of a list: at least 64dp tall, ripple on press, hairline divider below. */
export function ListRow({ title, subtitle, dot, trailing, chevron, onPress, accessibilityLabel }: ListRowProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={onPress ? { color: "rgba(168,121,255,0.12)" } : undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      style={[s.row, { borderBottomColor: colors.border }]}
    >
      {dot ? <View style={[s.dot, { backgroundColor: dot }]} /> : null}
      <View style={s.text}>
        <Text style={[type.body, { color: colors.foreground }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? <Feather name="chevron-right" size={20} color={colors.subtle} /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { flex: 1, gap: 2 },
});
