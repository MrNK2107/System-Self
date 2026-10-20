// "YOU // DAY 1": the user's own baseline next to now. Read-only; the main comparison for anyone struggling.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PastSelfResponse } from "@workspace/contracts";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { gymLine, pastSelfLine, pastSelfRows, pastSelfTitle } from "@/lib/game/progress";

export function PastSelfCard({ data }: { data: PastSelfResponse }) {
  const colors = useColors();
  const tone = { up: colors.success, down: colors.destructive, flat: colors.mutedForeground } as const;
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]} accessibilityLabel={pastSelfTitle(data.label)}>
      <Text style={[type.label, { color: colors.primary }]} accessibilityRole="header">
        {pastSelfTitle(data.label)}
      </Text>
      {pastSelfRows(data).map((r) => (
        <View key={r.domain} style={styles.row} accessible accessibilityLabel={`${r.domain}: ${pastSelfLine(r)}`}>
          <View style={[styles.dot, { backgroundColor: DOMAIN_COLORS[r.domain as keyof typeof DOMAIN_COLORS] ?? colors.subtle }]} />
          <Text style={[type.label, styles.domain, { color: colors.mutedForeground }]}>{r.domain}</Text>
          <Text style={[type.body, { color: colors.foreground, fontVariant: ["tabular-nums"] }]}>
            {`${r.baseline} to ${r.current} `}
            <Text style={{ color: tone[r.direction] }}>({r.delta})</Text>
          </Text>
        </View>
      ))}
      <Text style={[type.meta, { color: colors.mutedForeground }]}>{`Gym: ${gymLine(data.gym)}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: space.md, gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  domain: { flex: 1 },
});
