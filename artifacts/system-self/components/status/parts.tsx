// Small building blocks for the Status area: the NAME/JOB/TITLE field, a domain row, a section heading,
// a thin progress line and the week-change figure.
import { Feather } from "@expo/vector-icons";
import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { changeTone, formatChange } from "@/lib/status/status";

/** NAME  player_zero: a caps label on the left, the value on the right. */
export function StatField({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={s.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[type.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[type.body, s.fieldValue, { color: colors.foreground }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** Week change: green up, red down, muted when flat or unknown ("new" before a week of history). */
export function ChangeText({ value }: { value: number | null }) {
  const colors = useColors();
  const tone = changeTone(value);
  const color = tone === "up" ? colors.success : tone === "down" ? colors.destructive : colors.mutedForeground;
  return <Text style={[type.meta, s.change, { color }]}>{value === null ? "new" : formatChange(value)}</Text>;
}

/** One domain inside the STATUS window: dot, NAME, score, week change, chevron. */
export function DomainStatusRow({
  name,
  color,
  score,
  change,
  onPress,
}: {
  name: string;
  color: string;
  score: number;
  change: number | null;
  onPress: () => void;
}) {
  const colors = useColors();
  const changeLabel = change === null ? "no week of history yet" : `${formatChange(change)} this week`;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: "rgba(168,121,255,0.12)" }}
      accessibilityRole="button"
      accessibilityLabel={`${name} ${score.toFixed(1)}, ${changeLabel}`}
      style={[s.domainRow, { borderTopColor: colors.border }]}
    >
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={[type.bodyStrong, s.domainName, { color: colors.foreground }]}>{name.toUpperCase()}</Text>
      <Text style={[type.number, { color: colors.foreground }]}>{score.toFixed(1)}</Text>
      <ChangeText value={change} />
      <Feather name="chevron-right" size={20} color={colors.subtle} />
    </Pressable>
  );
}

/** A section heading with more space above than below. */
export function Section({ title, children, trailing }: { title: string; children: ReactNode; trailing?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={[type.label, s.flex, { color: colors.mutedForeground }]} accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** A 2dp track with a fill, for rank progress and step progress. */
export function ProgressLine({ value, color, width }: { value: number; color: string; width?: number }) {
  const colors = useColors();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={[s.track, { backgroundColor: colors.muted }, width ? { width } : s.flex]}>
      <View style={[s.fill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

/** A plain System line for empty and waiting states. */
export function SystemLine({ children, tone }: { children: ReactNode; tone?: "muted" | "error" }) {
  const colors = useColors();
  return <Text style={[type.body, { color: tone === "error" ? colors.destructive : colors.mutedForeground }]}>{children}</Text>;
}

/** A label/value pair laid out in a row of figures (DAYS 12 · LOGS 40). */
export function Figure({ label, value, color }: { label: string; value: string | number; color?: string }) {
  const colors = useColors();
  return (
    <View style={s.figure} accessible accessibilityLabel={`${label} ${value}`}>
      <Text style={[type.number, { color: color ?? colors.foreground }]}>{value}</Text>
      <Text style={[type.label, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  field: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, minHeight: 28 },
  fieldValue: { flexShrink: 1, textAlign: "right" },
  change: { width: 40, textAlign: "right" },
  domainRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  domainName: { flex: 1 },
  section: { gap: space.sm, paddingTop: space.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", minHeight: 24 },
  track: { height: 2, borderRadius: 1, overflow: "hidden" },
  fill: { height: "100%" },
  figure: { flex: 1, alignItems: "center", gap: 2 },
});
