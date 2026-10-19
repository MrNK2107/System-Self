// "YOU // DAY 1": the user's own baseline next to now. Read-only; the main comparison for anyone struggling.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PastSelfResponse } from "@workspace/contracts";
import { useColors } from "@/hooks/useColors";
import { gymLine, pastSelfLine, pastSelfRows, pastSelfTitle } from "@/lib/game/progress";

export function PastSelfCard({ data }: { data: PastSelfResponse }) {
  const colors = useColors();
  const tone = { up: colors.primary, down: colors.destructive, flat: colors.mutedForeground } as const;
  return (
    <View style={[styles.card, { borderColor: colors.primary + "60", backgroundColor: colors.card }]} accessibilityLabel={pastSelfTitle(data.label)}>
      <Text style={[styles.header, { color: colors.primary }]}>{pastSelfTitle(data.label)}</Text>
      {pastSelfRows(data).map((r) => (
        <View key={r.domain} style={styles.row} accessibilityLabel={`${r.domain}: ${pastSelfLine(r)}`}>
          <Text style={[styles.domain, { color: colors.mutedForeground }]}>{r.domain}</Text>
          <Text style={[styles.nums, { color: colors.foreground }]}>
            {r.baseline} → {r.current} <Text style={{ color: tone[r.direction] }}>({r.delta})</Text>
          </Text>
        </View>
      ))}
      <Text style={[styles.gym, { color: colors.mutedForeground }]}>GYM {gymLine(data.gym)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: 16, gap: 8, marginBottom: 16 },
  header: { fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  domain: { fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  nums: { fontSize: 13, fontWeight: "700", fontFamily: "monospace" },
  gym: { fontSize: 10, letterSpacing: 1, marginTop: 4 },
});
