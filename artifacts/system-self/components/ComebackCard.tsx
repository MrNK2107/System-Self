// Today card for a comeback: the SYSTEM acknowledges the return and lists three ordinary actions.
// Recognition only. Finishing it adds a returner mark and pays no points.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

interface Props {
  gapDays: number;
  checklist: { key: string; label: string; done: boolean }[];
}

export function ComebackCard({ gapDays, checklist }: Props) {
  const colors = useColors();
  const done = checklist.filter((c) => c.done).length;
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.head}>
        <Text style={[type.bodyStrong, { color: colors.foreground }]}>You returned. Most don't.</Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          {gapDays} empty days. {done} of {checklist.length} done today.
        </Text>
      </View>
      {checklist.map((c) => (
        <View key={c.key} style={styles.row} accessibilityLabel={`${c.label}: ${c.done ? "done" : "open"}`}>
          <Feather name={c.done ? "check-square" : "square"} size={20} color={c.done ? colors.success : colors.subtle} />
          <Text style={[type.body, styles.item, { color: c.done ? colors.foreground : colors.mutedForeground }]}>{c.label}</Text>
        </View>
      ))}
      <Text style={[type.meta, { color: colors.subtle }]}>Recognition only. It pays no points.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: space.md, gap: space.sm },
  head: { gap: 2, marginBottom: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm + 4, minHeight: 32 },
  item: { flex: 1 },
});
