import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, type Domain } from "@/context/AppContext";

const CALIBRATION_LINES = [
  "Baseline recorded.",
  "Analyzing domain performance...",
  "Assigning initial rank.",
  "Initializing rival matching...",
  "Calibration complete.",
];

export default function CalibratingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { setUser, updateDomainScore } = useApp();

  const [lineIndex, setLineIndex] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 3500,
      useNativeDriver: false,
    }).start();

    const intervals: ReturnType<typeof setTimeout>[] = [];
    CALIBRATION_LINES.forEach((_, i) => {
      intervals.push(setTimeout(() => setLineIndex(i), i * 700));
    });

    const finalTimeout = setTimeout(async () => {
      await initUser();
      router.replace("/onboarding/schedule");
    }, 4200);

    return () => {
      intervals.forEach(clearTimeout);
      clearTimeout(finalTimeout);
    };
  }, []);

  const initUser = async () => {
    const ratings = params.ratings ? JSON.parse(params.ratings as string) as Record<Domain, number> : null;
    const username = (params.username as string) ?? "OPERATOR";
    const primaryGoal = (params.primaryGoal as string) ?? "Reach my potential";
    const weakness = (params.weakness as Domain) ?? "DISCIPLINE";
    const identity = (params.identity as "anonymous" | "semi-public" | "public") ?? "semi-public";

    const dayOne = new Date().toISOString();

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
      createdAt: dayOne,
      dayNumber: 1,
    });

    if (ratings) {
      const domains: Domain[] = ["BODY", "MIND", "WEALTH", "DISCIPLINE"];
      for (const domain of domains) {
        const rating = ratings[domain] ?? 5;
        const baseScore = rating * 4;
        await updateDomainScore(domain, baseScore - 50);
      }
    }
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad + 40 }]}>
      <Text style={[styles.tag, { color: colors.mutedForeground }]}>SYSTEM // SELF</Text>

      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]}>CALIBRATING</Text>

        <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
          <Animated.View style={[styles.progressFill, { width: progressWidth, backgroundColor: colors.primary }]} />
        </View>

        <View style={styles.linesContainer}>
          {CALIBRATION_LINES.slice(0, lineIndex + 1).map((line, i) => (
            <Text
              key={i}
              style={[
                styles.line,
                {
                  color: i < lineIndex ? colors.mutedForeground : colors.foreground,
                  opacity: i < lineIndex ? 0.5 : 1,
                }
              ]}
            >
              {i < lineIndex ? "✓ " : "▶ "}{line}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
          Initial rank assigned: E
        </Text>
        <Text style={[styles.footerSub, { color: colors.mutedForeground }]}>
          This is where everyone starts.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 32, paddingBottom: 60, justifyContent: "space-between" },
  tag: { fontSize: 9, letterSpacing: 4, fontWeight: "600" as const },
  content: { flex: 1, justifyContent: "center", gap: 24 },
  title: { fontSize: 28, fontWeight: "700" as const, letterSpacing: 4 },
  progressTrack: { height: 2, borderRadius: 1, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 1 },
  linesContainer: { gap: 10 },
  line: { fontSize: 14, lineHeight: 20 },
  footer: { gap: 4 },
  footerText: { fontSize: 12 },
  footerSub: { fontSize: 11 },
});
