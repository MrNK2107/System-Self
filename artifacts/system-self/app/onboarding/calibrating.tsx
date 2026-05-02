import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp, type Domain } from "@/context/AppContext";


const { width: SW } = Dimensions.get("window");

const DOMAIN_COLORS: Record<Domain, string> = {
  BODY: "#E05555",
  MIND: "#3A7BD5",
  WEALTH: "#4B8B6F",
  DISCIPLINE: "#C4873A",
};

const STEPS = [
  { icon: "database" as const, label: "Baseline recorded.", domain: null },
  { icon: "cpu" as const, label: "Analyzing domain performance...", domain: null },
  { icon: "award" as const, label: "Assigning initial rank: E", domain: null },
  { icon: "users" as const, label: "Initializing rival matching...", domain: null },
  { icon: "check-circle" as const, label: "Calibration complete.", domain: null },
];

export default function CalibratingScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { setUser, updateDomainScore, initializeShadowSelf } = useApp();

  const [stepIndex, setStepIndex] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const scanY = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    // Progress bar
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 3600,
      useNativeDriver: false,
    }).start();

    // Glow pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 0.55, duration: 1400, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0.2, duration: 1400, useNativeDriver: false }),
      ])
    ).start();

    // Scan line
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanY, { toValue: 300, duration: 2200, useNativeDriver: false }),
        Animated.timing(scanY, { toValue: 0, duration: 0, useNativeDriver: false }),
        Animated.delay(400),
      ])
    ).start();

    // Step reveals
    STEPS.forEach((_, i) => {
      setTimeout(() => setStepIndex(i), i * 720 + 200);
    });

    // Navigate out
    const t = setTimeout(async () => {
      await initUser();
      router.replace("/onboarding/schedule");
    }, 4400);

    return () => clearTimeout(t);
  }, []);

  const initUser = async () => {
    const ratings = params.ratings
      ? (JSON.parse(params.ratings as string) as Record<Domain, number>)
      : null;
    const username = (params.username as string) || "OPERATOR";
    const primaryGoal = (params.primaryGoal as string) || "Reach my potential";
    const weakness = ((params.weakness as Domain) || "DISCIPLINE") as Domain;
    const identity = (params.identity as "anonymous" | "semi-public" | "public") || "semi-public";

    await setUser({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      username,
      identitySetting: identity,
      rank: "E",
      primaryGoal,
      biggestWeakness: weakness,
      morningTime: "07:00",
      nightlyTime: "21:00",
      onboardingComplete: true,
      createdAt: new Date().toISOString(),
      dayNumber: 1,
    });

    if (ratings) {
      const domains: Domain[] = ["BODY", "MIND", "WEALTH", "DISCIPLINE"];
      for (const domain of domains) {
        const rating = ratings[domain] ?? 5;
        await updateDomainScore(domain, rating * 4 - 50);
      }
      // Compute the actual starting scores for shadow initialization
      const startScores: Record<Domain, number> = {
        BODY: 50 + (ratings.BODY ?? 5) * 4 - 50,
        MIND: 50 + (ratings.MIND ?? 5) * 4 - 50,
        WEALTH: 50 + (ratings.WEALTH ?? 5) * 4 - 50,
        DISCIPLINE: 50 + (ratings.DISCIPLINE ?? 5) * 4 - 50,
      };
      await initializeShadowSelf(startScores, username);
    } else {
      await initializeShadowSelf(
        { BODY: 50, MIND: 50, WEALTH: 50, DISCIPLINE: 50 },
        username
      );
    }
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  const ratings = params.ratings
    ? (JSON.parse(params.ratings as string) as Record<string, number>)
    : { BODY: 5, MIND: 5, WEALTH: 5, DISCIPLINE: 5 };

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#060810", "#0C0F18", "#111318"]} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={["#1E3D7220", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.4 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Scan line */}
      <Animated.View style={[styles.scanLine, { top: scanY }]} pointerEvents="none" />

      <View style={[styles.inner, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 40 }]}>
        {/* Header */}
        <View style={styles.topRow}>
          <View style={styles.dot} />
          <Text style={styles.tagline}>SYSTEM // SELF</Text>
          <View style={styles.dot} />
        </View>

        {/* Rank reveal */}
        <View style={styles.rankBlock}>
          <Animated.View style={[styles.rankGlow, { opacity: glowAnim }]} />
          <View style={styles.rankBadge}>
            <Text style={styles.rankLetter}>E</Text>
          </View>
          <Text style={styles.rankCaption}>RANK ASSIGNED</Text>
        </View>

        {/* Domain score preview */}
        <View style={[styles.scoresCard, { backgroundColor: "#0D1018", borderColor: "#1E2230" }]}>
          <Text style={styles.scoresTitle}>CALIBRATED SCORES</Text>
          {(["BODY", "MIND", "WEALTH", "DISCIPLINE"] as Domain[]).map(d => {
            const score = ((ratings[d] ?? 5) / 10) * 100;
            const color = DOMAIN_COLORS[d];
            return (
              <View key={d} style={styles.scoreRow}>
                <Text style={[styles.scoreLabel, { color }]}>{d}</Text>
                <View style={styles.scoreTrack}>
                  <View style={[styles.scoreFill, { width: `${score}%`, backgroundColor: color }]} />
                </View>
                <Text style={[styles.scoreVal, { color }]}>{score.toFixed(0)}</Text>
              </View>
            );
          })}
        </View>

        {/* Progress bar */}
        <View style={styles.progressBlock}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
        </View>

        {/* Steps */}
        <View style={styles.steps}>
          {STEPS.slice(0, stepIndex + 1).map((step, i) => {
            const isDone = i < stepIndex;
            const isActive = i === stepIndex;
            return (
              <View key={i} style={styles.stepRow}>
                <View style={[styles.stepIcon, {
                  backgroundColor: isDone ? "#4B8B6F20" : isActive ? "#3A7BD520" : "#12151E",
                  borderColor: isDone ? "#4B8B6F40" : isActive ? "#3A7BD540" : "#1A1D24",
                }]}>
                  <Feather
                    name={isDone ? "check" : step.icon}
                    size={12}
                    color={isDone ? "#4B8B6F" : isActive ? "#3A7BD5" : "#2A2D38"}
                  />
                </View>
                <Text style={[styles.stepText, {
                  color: isDone ? "#2A2D38" : isActive ? "#A0A4B0" : "#1A1D24",
                }]}>
                  {step.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#060810" },
  inner: { flex: 1, paddingHorizontal: 28, gap: 24, justifyContent: "center" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  dot: { width: 4, height: 4, borderRadius: 1, backgroundColor: "#3A7BD5", opacity: 0.6 },
  tagline: { fontSize: 9, letterSpacing: 5, color: "#282B38", fontWeight: "700" as const },

  rankBlock: { alignItems: "center", gap: 10 },
  rankGlow: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "#3A7BD5",
    top: -40,
    alignSelf: "center",
  },
  rankBadge: {
    width: 80,
    height: 80,
    borderWidth: 1,
    borderColor: "#3A7BD545",
    backgroundColor: "#0A0D14",
    alignItems: "center",
    justifyContent: "center",
  },
  rankLetter: { fontSize: 42, fontWeight: "900" as const, color: "#3A7BD5", letterSpacing: 5, lineHeight: 50 },
  rankCaption: { fontSize: 8, letterSpacing: 4, color: "#3A7BD550", fontWeight: "700" as const },

  scoresCard: { borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 },
  scoresTitle: { fontSize: 8, letterSpacing: 3, color: "#1E2230", fontWeight: "700" as const, marginBottom: 2 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  scoreLabel: { width: 72, fontSize: 9, fontWeight: "700" as const, letterSpacing: 2, textAlign: "right" },
  scoreTrack: { flex: 1, height: 3, backgroundColor: "#12151E", borderRadius: 2, overflow: "hidden" },
  scoreFill: { height: "100%", borderRadius: 2 },
  scoreVal: { width: 28, fontSize: 10, fontWeight: "700" as const, textAlign: "right" },

  progressBlock: { gap: 6 },
  progressTrack: { height: 2, backgroundColor: "#12151E", borderRadius: 1, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#3A7BD5", borderRadius: 1 },

  steps: { gap: 8 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 13, lineHeight: 18 },

  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#3A7BD5",
    opacity: 0.08,
  },
});
