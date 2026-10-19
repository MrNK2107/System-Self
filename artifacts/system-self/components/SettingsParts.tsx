import { Feather } from "@expo/vector-icons";
import React, { type ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type IconName = React.ComponentProps<typeof Feather>["name"];

/** A bordered group of rows. */
export function SettingsCard({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>{children}</View>;
}

export function Separator() {
  const colors = useColors();
  return <View style={[s.separator, { backgroundColor: colors.border }]} />;
}

interface RowProps {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
  /** Trailing glyph. Default chevron-right. */
  trailing?: IconName | null;
  destructive?: boolean;
  disabled?: boolean;
  busy?: boolean;
  expanded?: boolean;
}

export function SettingsRow({ icon, label, value, onPress, trailing = "chevron-right", destructive, disabled, busy, expanded }: RowProps) {
  const colors = useColors();
  const tint = destructive ? colors.destructive : colors.mutedForeground;
  return (
    <TouchableOpacity
      style={s.row}
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy, ...(expanded === undefined ? {} : { expanded }) }}
    >
      <Feather name={icon} size={14} color={tint} />
      <Text style={[s.label, { color: destructive ? colors.destructive : colors.foreground }]}>{label}</Text>
      {value ? (
        <Text style={[s.value, { color: colors.mutedForeground }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing ? <Feather name={trailing} size={14} color={colors.mutedForeground} /> : null}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 16 },
  separator: { height: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 },
  label: { flex: 1, fontSize: 13 },
  value: { fontSize: 11, letterSpacing: 1, maxWidth: "50%" },
});
