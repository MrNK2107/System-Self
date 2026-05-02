import React from "react";
import { StyleSheet, Text, View } from "react-native";
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

export function RankBadge({ rank, size = "md", showLabel = false }: RankBadgeProps) {
  const colors = useColors();

  const rankColor = colors.rank[rank] ?? colors.mutedForeground;

  const sizeStyles = {
    sm: { badge: 28, font: 12, border: 1 },
    md: { badge: 40, font: 18, border: 1.5 },
    lg: { badge: 64, font: 28, border: 2 },
  };

  const { badge, font, border } = sizeStyles[size];

  return (
    <View style={styles.container}>
      <View style={[
        styles.badge,
        {
          width: badge,
          height: badge,
          borderColor: rankColor,
          borderWidth: border,
          backgroundColor: `${rankColor}18`,
        }
      ]}>
        <Text style={[styles.rankText, { fontSize: font, color: rankColor, fontFamily: "SpaceMono" }]}>
          {rank}
        </Text>
      </View>
      {showLabel && (
        <Text style={[styles.label, { color: rankColor }]}>
          {RANK_LABELS[rank]}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 4,
  },
  badge: {
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  label: {
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: "600" as const,
  },
});
