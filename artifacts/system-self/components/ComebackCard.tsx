// Dashboard card for today's comeback: the SYSTEM acknowledges the return and lists three ordinary actions.
// Recognition only. Finishing it adds a returner mark and pays no points.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  gapDays: number;
  checklist: { key: string; label: string; done: boolean }[];
}

export function ComebackCard({ gapDays, checklist }: Props) {
  const colors = useColors();
  const done = checklist.filter((c) => c.done).length;
  return (
    <View style={[styles.card, { borderColor: colors.primary + "60", backgroundColor: colors.card }]}>
      <Text style={[styles.header, { color: colors.primary }]}>REDEMPTION ARC</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>You returned. Most don't.</Text>
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>
        {gapDays} empty days. {done}/{checklist.length} done today.
      </Text>
      {checklist.map((c) => (
        <View key={c.key} style={styles.row} accessibilityLabel={`${c.label}: ${c.done ? "done" : "open"}`}>
          <Feather name={c.done ? "check-square" : "square"} size={14} color={c.done ? colors.primary : colors.mutedForeground} />
          <Text style={[styles.item, { color: c.done ? colors.foreground : colors.mutedForeground }]}>{c.label}</Text>
        </View>
      ))}
      <Text style={[styles.note, { color: colors.mutedForeground }]}>Recognition only. It pays no points.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: 16, gap: 8 },
  header: { fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  title: { fontSize: 15, fontWeight: "700", letterSpacing: 1 },
  meta: { fontSize: 11 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  item: { fontSize: 12, fontWeight: "600" },
  note: { fontSize: 10, marginTop: 2 },
});
