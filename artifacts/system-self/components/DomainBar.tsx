import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { getStreakMultiplier, getStreakTier, type Domain } from "@/context/AppContext";
import { DOMAIN_GLYPHS as DOMAIN_ICONS } from "@/constants/domains";

interface DomainBarProps {
  domain: Domain;
  score: number;
  streak: number;
  showStreak?: boolean;
  height?: number;
}

const STREAK_TIER_COLORS = {
  none: null,
  low: "#6B7280",
  mid: null, // uses domain color
  high: null, // uses domain color bright
  max: "#D4B483", // gold
};

export function DomainBar({ domain, score, streak, showStreak = true, height = 2 }: DomainBarProps) {
  const colors = useColors();
  const animatedWidth = useRef(new Animated.Value(0)).current;
  const pulseOpacity = useRef(new Animated.Value(0.5)).current;

  const domainColor = colors.domain[domain];
  const tier = getStreakTier(streak);
  const multiplier = getStreakMultiplier(streak);

  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: score,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [score]);

  // Pulse animation for mid+ streaks
  useEffect(() => {
    if (tier === "none" || tier === "low") {
      pulseOpacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(pulseOpacity, { toValue: 0.4, duration: 900, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [tier]);

  const width = animatedWidth.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  // Streak indicator color
  const streakColor =
    tier === "max" ? "#D4B483" :
    tier === "high" ? domainColor :
    tier === "mid" ? domainColor :
    STREAK_TIER_COLORS.low ?? "#6B7280";

  // Bar glow for high+ streaks
  const barGlowOpacity = tier === "max" ? 0.5 : tier === "high" ? 0.35 : 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.labelRow}>
          <Text style={[styles.icon, { color: domainColor }]}>{DOMAIN_ICONS[domain]}</Text>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{domain}</Text>
        </View>

        <View style={styles.rightRow}>
          {showStreak && tier !== "none" && (
            <Animated.View style={[styles.streakBadge, { opacity: tier === "low" ? 1 : pulseOpacity }]}>
              {(tier === "mid" || tier === "high" || tier === "max") && (
                <Feather
                  name="zap"
                  size={8}
                  color={streakColor}
                />
              )}
              <Text style={[styles.streakCount, { color: streakColor }]}>
                {streak}D
              </Text>
              {tier !== "low" && (
                <Text style={[styles.multiplier, { color: streakColor }]}>
                  ×{multiplier.toFixed(1)}
                </Text>
              )}
            </Animated.View>
          )}
          <Text style={[styles.score, { color: colors.foreground }]}>
            {score.toFixed(1)}
          </Text>
        </View>
      </View>

      {/* Bar track */}
      <View style={[styles.trackWrap, { height }]}>
        <View style={[styles.track, { backgroundColor: colors.muted }]} />
        <Animated.View
          style={[
            styles.fill,
            {
              width,
              height,
              backgroundColor: domainColor,
            },
          ]}
        />
        {/* Glow cap at fill end for high+ streaks */}
        {barGlowOpacity > 0 && (
          <Animated.View
            style={[
              styles.glowCap,
              {
                left: width,
                width: 12,
                height,
                backgroundColor: domainColor,
                opacity: pulseOpacity,
                shadowColor: domainColor,
              },
            ]}
          />
        )}
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
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  streakCount: {
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
  multiplier: {
    fontSize: 9,
    fontWeight: "800" as const,
    letterSpacing: 0.5,
  },
  score: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  trackWrap: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 1,
  },
  track: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 1,
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    borderRadius: 1,
  },
  glowCap: {
    position: "absolute",
    top: 0,
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
});
