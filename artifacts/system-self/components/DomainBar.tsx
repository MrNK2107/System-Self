import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import type { Domain } from "@/context/AppContext";

interface DomainBarProps {
  domain: Domain;
  score: number;
  streak: number;
  showStreak?: boolean;
}

const DOMAIN_ICONS: Record<Domain, string> = {
  BODY: "◈",
  MIND: "◉",
  WEALTH: "◆",
  DISCIPLINE: "▲",
};

export function DomainBar({ domain, score, streak, showStreak = true }: DomainBarProps) {
  const colors = useColors();
  const animatedWidth = useRef(new Animated.Value(0)).current;

  const domainColor = colors.domain[domain];

  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: score,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [score]);

  const width = animatedWidth.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.labelRow}>
          <Text style={[styles.icon, { color: domainColor }]}>{DOMAIN_ICONS[domain]}</Text>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{domain}</Text>
        </View>
        <View style={styles.rightRow}>
          {showStreak && streak > 0 && (
            <Text style={[styles.streak, { color: colors.mutedForeground }]}>
              {streak}D
            </Text>
          )}
          <Text style={[styles.score, { color: colors.foreground, fontFamily: "SpaceMono" }]}>
            {score.toFixed(1)}
          </Text>
        </View>
      </View>
      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              width,
              backgroundColor: domainColor,
            }
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  icon: {
    fontSize: 11,
  },
  label: {
    fontSize: 10,
    fontWeight: "600" as const,
    letterSpacing: 2,
  },
  rightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  streak: {
    fontSize: 9,
    letterSpacing: 1,
  },
  score: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  track: {
    height: 2,
    borderRadius: 1,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 1,
  },
});
