import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SW, height: SH } = Dimensions.get("window");

const DOMAIN_BARS = [
  { label: "BODY", color: "#E05555", pct: 23 },
  { label: "MIND", color: "#3A7BD5", pct: 31 },
  { label: "WEALTH", color: "#4B8B6F", pct: 18 },
  { label: "DISCIPLINE", color: "#C4873A", pct: 27 },
];

const LINES = [
  "You opened this for a reason.",
  "We don't ask why.",
  "We build from where you actually are.",
  "No lies. No shortcuts. No mercy.",
];

export default function OnboardingIntro() {
  const insets = useSafeAreaInsets();

  // Typewriter state
  const [lineIdx, setLineIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [displayedLines, setDisplayedLines] = useState<string[]>([]);
  const [allDone, setAllDone] = useState(false);

  // Decorative animations
  const scanY = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.2)).current;
  const barWidths = useRef(DOMAIN_BARS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    // Scan line loop
    const scanLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanY, { toValue: SH, duration: 2800, useNativeDriver: false }),
        Animated.timing(scanY, { toValue: 0, duration: 0, useNativeDriver: false }),
        Animated.delay(600),
      ])
    );
    scanLoop.start();

    // Glow pulse
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 0.5, duration: 1600, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0.2, duration: 1600, useNativeDriver: false }),
      ])
    );
    glowLoop.start();

    // Bar widths — staggered fill
    const barAnims = Animated.stagger(
      100,
      barWidths.map((w, i) =>
        Animated.timing(w, {
          toValue: DOMAIN_BARS[i].pct,
          duration: 800,
          delay: 200,
          useNativeDriver: false,
        })
      )
    );
    barAnims.start();

    return () => {
      scanLoop.stop();
      glowLoop.stop();
    };
  }, []);

  // Typewriter effect
  useEffect(() => {
    if (allDone) return;
    if (lineIdx >= LINES.length) {
      setAllDone(true);
      return;
    }
    const line = LINES[lineIdx];
    if (charIdx < line.length) {
      const t = setTimeout(() => {
        setDisplayedLines(prev => {
          const u = [...prev];
          u[lineIdx] = line.slice(0, charIdx + 1);
          return u;
        });
        setCharIdx(c => c + 1);
      }, 30);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => {
        setLineIdx(l => l + 1);
        setCharIdx(0);
      }, 380);
      return () => clearTimeout(t);
    }
  }, [lineIdx, charIdx, allDone]);

  return (
    <View style={styles.root}>
      {/* Background gradient */}
      <LinearGradient
        colors={["#060810", "#0C0F18", "#111318"]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={["#1E3D7220", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.55 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Grid overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {Array.from({ length: Math.ceil(SW / 44) + 1 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridV, { left: i * 44 }]} />
        ))}
        {Array.from({ length: Math.ceil(SH / 56) + 1 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridH, { top: i * 56 }]} />
        ))}
      </View>

      {/* Scan line */}
      <Animated.View
        style={[styles.scanLine, { top: scanY }]}
        pointerEvents="none"
      />

      {/* Header brand */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 0 : 16) }]}>
        <View style={styles.brandDot} />
        <Text style={styles.brandText}>SYSTEM // SELF</Text>
        <View style={styles.brandDot} />
      </View>

      {/* CENTER HERO */}
      <View style={styles.hero}>
        {/* Rank badge with glow */}
        <View style={styles.rankSection}>
          <Animated.View style={[styles.rankGlow, { opacity: glowAnim }]} />
          <View style={styles.rankBadge}>
            <Text style={styles.rankLetter}>E</Text>
          </View>
          <View style={styles.rankMeta}>
            <Text style={styles.rankTitle}>RANK E</Text>
            <Text style={styles.rankSub}>This is where everyone starts.</Text>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.heroDivider} />

        {/* Domain bars preview */}
        <View style={styles.barsBlock}>
          <Text style={styles.barsTitle}>STAT DOMAINS</Text>
          {DOMAIN_BARS.map((bar, i) => (
            <View key={bar.label} style={styles.barRow}>
              <Text style={[styles.barLabel, { color: bar.color }]}>{bar.label}</Text>
              <View style={styles.barTrack}>
                <Animated.View
                  style={[
                    styles.barFill,
                    {
                      width: barWidths[i].interpolate({
                        inputRange: [0, 100],
                        outputRange: ["0%", "100%"],
                      }),
                      backgroundColor: bar.color,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* BOTTOM TEXT + CTA */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.bottomDivider} />

        {/* Typewriter lines */}
        <View style={styles.typeBlock}>
          {displayedLines.map((line, i) => (
            <Text
              key={i}
              style={[
                styles.typeLine,
                { color: i < displayedLines.length - 1 ? "#383B47" : "#C0C3CF" },
              ]}
            >
              {line}
              {i === lineIdx && !allDone && charIdx < LINES[lineIdx]?.length && (
                <Text style={{ color: "#3A7BD5" }}>▊</Text>
              )}
            </Text>
          ))}
        </View>

        {/* CTA */}
        <Pressable
          style={({ pressed }) => [styles.ctaOuter, pressed && { opacity: 0.85 }]}
          onPress={() => router.push("/onboarding/assessment")}
        >
          <LinearGradient
            colors={["#2F6FD4", "#1E4FA0"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaInner}
          >
            <Text style={styles.ctaText}>BEGIN ASSESSMENT</Text>
            <Feather name="arrow-right" size={16} color="#fff" />
          </LinearGradient>
        </Pressable>
        <Text style={styles.ctaNote}>
          Honest answers only. Your baseline is permanent.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#060810", justifyContent: "space-between" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 8,
    paddingHorizontal: 24,
  },
  brandDot: { width: 4, height: 4, borderRadius: 1, backgroundColor: "#3A7BD5", opacity: 0.7 },
  brandText: { fontSize: 9, letterSpacing: 5, color: "#333646", fontWeight: "700" as const },

  hero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 24,
  },
  rankSection: {
    alignItems: "center",
    gap: 12,
  },
  rankGlow: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "#3A7BD5",
    top: -54,
    alignSelf: "center",
  },
  rankBadge: {
    width: 100,
    height: 100,
    borderWidth: 1,
    borderColor: "#3A7BD545",
    backgroundColor: "#0A0D16",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#3A7BD5",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 32,
    elevation: 16,
  },
  rankLetter: {
    fontSize: 56,
    fontWeight: "900" as const,
    color: "#3A7BD5",
    letterSpacing: 6,
    lineHeight: 64,
  },
  rankMeta: { alignItems: "center", gap: 4 },
  rankTitle: {
    fontSize: 10,
    letterSpacing: 4,
    color: "#3A7BD560",
    fontWeight: "700" as const,
  },
  rankSub: { fontSize: 12, color: "#282B38", letterSpacing: 0.3 },

  heroDivider: {
    width: "100%",
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#14171F",
  },

  barsBlock: { width: "100%", gap: 11 },
  barsTitle: {
    fontSize: 8,
    letterSpacing: 3.5,
    color: "#262930",
    fontWeight: "700" as const,
    marginBottom: 2,
  },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  barLabel: {
    width: 74,
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 2,
    textAlign: "right",
  },
  barTrack: {
    flex: 1,
    height: 3,
    backgroundColor: "#12151E",
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 2 },

  bottom: {
    paddingHorizontal: 24,
    gap: 16,
  },
  bottomDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#141720",
  },
  typeBlock: { minHeight: 96, gap: 8 },
  typeLine: {
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "400" as const,
    letterSpacing: -0.2,
  },
  ctaOuter: { borderRadius: 2, overflow: "hidden" },
  ctaInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 10,
  },
  ctaText: { color: "#fff", fontSize: 12, fontWeight: "700" as const, letterSpacing: 3 },
  ctaNote: { textAlign: "center", color: "#222430", fontSize: 10 },

  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#3A7BD5",
    opacity: 0.09,
  },
  gridV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "#fff",
    opacity: 0.025,
  },
  gridH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#fff",
    opacity: 0.025,
  },
});
