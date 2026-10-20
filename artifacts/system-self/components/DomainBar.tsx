import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { getStreakMultiplier, getStreakTier, type Domain } from "@/context/AppContext";

interface DomainBarProps {
  domain: Domain;
  score: number;
  streak: number;
  showStreak?: boolean;
  height?: number;
}

/** A domain's score as a thin bar: dot, name, streak (and its multiplier from mid tier up), score. */
export function DomainBar({ domain, score, streak, showStreak = true, height = 2 }: DomainBarProps) {
  const colors = useColors();
  const animatedWidth = useRef(new Animated.Value(0)).current;

  const domainColor = colors.domain[domain];
  const tier = getStreakTier(streak);
  const multiplier = getStreakMultiplier(streak);

  useEffect(() => {
    Animated.timing(animatedWidth, { toValue: score, duration: 600, useNativeDriver: false }).start();
  }, [score]);

  const width = animatedWidth.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"], extrapolate: "clamp" });
  // Streak is a fact about the domain, so it takes the domain colour; the top tier earns the warn (gold) accent.
  const streakColor = tier === "max" ? colors.warn : tier === "low" ? colors.mutedForeground : domainColor;
  const streakText = tier === "low" ? `${streak}d streak` : `${streak}d streak · x${multiplier.toFixed(1)}`;

  return (
    <View style={styles.container} accessible accessibilityLabel={`${domain} ${score.toFixed(1)}${showStreak && tier !== "none" ? `, ${streakText}` : ""}`}>
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: domainColor }]} />
        <Text style={[type.label, styles.label, { color: colors.foreground }]}>{domain}</Text>
        {showStreak && tier !== "none" && <Text style={[type.meta, { color: streakColor }]}>{streakText}</Text>}
        <Text style={[type.number, { color: colors.foreground }]}>{score.toFixed(1)}</Text>
      </View>
      <View style={[styles.track, { height, backgroundColor: colors.muted }]}>
        <Animated.View style={[styles.fill, { width, height, backgroundColor: domainColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.xs },
  header: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { flex: 1 },
  track: { overflow: "hidden", borderRadius: 1 },
  fill: { position: "absolute", left: 0, top: 0 },
});
