import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { fonts, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import type { Rank } from "@/context/AppContext";

interface RankBadgeProps {
  rank: Rank;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const RANK_LABELS: Record<Rank, string> = {
  E: "UNRANKED",
  D: "AWARE",
  C: "CONSISTENT",
  B: "DISCIPLINED",
  A: "ELITE",
  S: "SYSTEM-LEVEL",
};

// Letter sizes stay on the type scale: 12 (label), 20 (number/title).
const SIZES = {
  sm: { badge: 28, font: type.label.fontSize, line: type.label.lineHeight },
  md: { badge: 40, font: type.number.fontSize, line: type.number.lineHeight },
  lg: { badge: 56, font: type.number.fontSize, line: type.number.lineHeight },
} as const;

/** Small square rank chip for rows and lists. The hexagon RankEmblem is the hero version on Status. */
export function RankBadge({ rank, size = "md", showLabel = false }: RankBadgeProps) {
  const colors = useColors();
  const rankColor = colors.rank[rank] ?? colors.mutedForeground;
  const { badge, font, line } = SIZES[size];

  return (
    <View style={styles.container} accessible accessibilityLabel={`Rank ${rank}${showLabel ? `, ${RANK_LABELS[rank]}` : ""}`}>
      <View style={[styles.badge, { width: badge, height: badge, borderColor: rankColor, backgroundColor: colors.card }]}>
        <Text style={[styles.letter, { fontSize: font, lineHeight: line, color: rankColor }]}>{rank}</Text>
      </View>
      {showLabel && <Text style={[type.label, { color: rankColor }]}>{RANK_LABELS[rank]}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 4 },
  badge: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 4 },
  letter: { fontFamily: fonts.displayBold },
});
