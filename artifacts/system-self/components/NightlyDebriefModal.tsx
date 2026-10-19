import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import type { Domain, DebriefData, DebriefVerdict } from "@/context/AppContext";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { verdictHaptic } from "@/lib/haptics";

const { width: SW } = Dimensions.get("window");

const VERDICT_COLORS: Record<DebriefVerdict, string> = {
  ACCEPTABLE: "#4B8B6F",
  INSUFFICIENT: "#C4873A",
  PATHETIC: "#E05555",
};

const VERDICT_SUB: Record<DebriefVerdict, string> = {
  ACCEPTABLE: "Noted. Maintain this.",
  INSUFFICIENT: "Below projection. Adjust.",
  PATHETIC: "This is a data point. Act on it.",
};

interface Props {
  visible: boolean;
  debrief: DebriefData;
  username: string;
  dayNumber: number;
  onAcknowledge: () => void;
}

export function NightlyDebriefModal({ visible, debrief, username, dayNumber, onAcknowledge }: Props) {
  const verdictColor = VERDICT_COLORS[debrief.verdict];

  // Animations
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerX = useRef(new Animated.Value(-20)).current;
  const divider1Width = useRef(new Animated.Value(0)).current;
  const domainOpacities = useRef(DOMAINS.map(() => new Animated.Value(0))).current;
  const statsOpacity = useRef(new Animated.Value(0)).current;
  const divider2Width = useRef(new Animated.Value(0)).current;
  const aiOpacity = useRef(new Animated.Value(0)).current;
  const verdictScale = useRef(new Animated.Value(2.2)).current;
  const verdictOpacity = useRef(new Animated.Value(0)).current;
  const verdictSubOpacity = useRef(new Animated.Value(0)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;

  // Typewriter for AI text
  const [displayedText, setDisplayedText] = useState("");
  const [showContent, setShowContent] = useState(false);

  // The verdict is delivered once per opening, not on every re-render or AI text update.
  useEffect(() => {
    if (visible) verdictHaptic();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    // Reset
    overlayOpacity.setValue(0);
    headerOpacity.setValue(0);
    headerX.setValue(-20);
    divider1Width.setValue(0);
    domainOpacities.forEach(a => a.setValue(0));
    statsOpacity.setValue(0);
    divider2Width.setValue(0);
    aiOpacity.setValue(0);
    verdictScale.setValue(2.2);
    verdictOpacity.setValue(0);
    verdictSubOpacity.setValue(0);
    btnOpacity.setValue(0);
    setDisplayedText("");
    setShowContent(true);

    // t=0: overlay
    Animated.timing(overlayOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();

    // t=350: header slides in
    const t1 = setTimeout(() => {
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 350, useNativeDriver: false }),
        Animated.timing(headerX, { toValue: 0, duration: 350, useNativeDriver: false }),
      ]).start();
    }, 350);

    // t=700: divider 1 draws
    const t2 = setTimeout(() => {
      Animated.timing(divider1Width, { toValue: SW - 48, duration: 400, useNativeDriver: false }).start();
    }, 700);

    // t=1000: domain rows stagger
    const t3 = setTimeout(() => {
      domainOpacities.forEach((a, i) => {
        setTimeout(() => {
          Animated.timing(a, { toValue: 1, duration: 300, useNativeDriver: false }).start();
        }, i * 160);
      });
    }, 1000);

    // t=1750: stats row
    const t4 = setTimeout(() => {
      Animated.timing(statsOpacity, { toValue: 1, duration: 350, useNativeDriver: false }).start();
    }, 1750);

    // t=2100: divider 2 draws
    const t5 = setTimeout(() => {
      Animated.timing(divider2Width, { toValue: SW - 48, duration: 350, useNativeDriver: false }).start();
    }, 2100);

    // t=2450: AI text fade in + typewriter
    const t6 = setTimeout(() => {
      Animated.timing(aiOpacity, { toValue: 1, duration: 200, useNativeDriver: false }).start();
      // Typewriter
      const text = debrief.aiText;
      const delay = Math.min(55, 2800 / Math.max(text.length, 1));
      let i = 0;
      const interval = setInterval(() => {
        i++;
        setDisplayedText(text.slice(0, i));
        if (i >= text.length) clearInterval(interval);
      }, delay);
    }, 2450);

    // t=5500: verdict slams in
    const aiDuration = Math.min(debrief.aiText.length * 55, 2800);
    const verdictT = 2450 + aiDuration + 300;

    const t7 = setTimeout(() => {
      Animated.parallel([
        Animated.spring(verdictScale, {
          toValue: 1,
          tension: 180,
          friction: 8,
          useNativeDriver: false,
        }),
        Animated.timing(verdictOpacity, { toValue: 1, duration: 300, useNativeDriver: false }),
      ]).start();
    }, verdictT);

    // verdict sub
    const t8 = setTimeout(() => {
      Animated.timing(verdictSubOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    }, verdictT + 400);

    // dismiss button
    const t9 = setTimeout(() => {
      Animated.timing(btnOpacity, { toValue: 1, duration: 500, useNativeDriver: false }).start();
    }, verdictT + 900);

    return () => {
      [t1, t2, t3, t4, t5, t6, t7, t8, t9].forEach(clearTimeout);
    };
  }, [visible, debrief.aiText]);

  if (!visible || !showContent) return null;

  // Format date
  const dateStr = new Date(debrief.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent onRequestClose={onAcknowledge}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <LinearGradient
          colors={["#040609", "#080B12", "#06080F"]}
          style={StyleSheet.absoluteFill}
        />
        {/* Subtle verdict tint */}
        <LinearGradient
          colors={[`${verdictColor}10`, "transparent", `${verdictColor}06`]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Grid */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Array.from({ length: Math.ceil(SW / 44) + 1 }).map((_, i) => (
            <View key={`v${i}`} style={[styles.gridLine, styles.gridV, { left: i * 44 }]} />
          ))}
        </View>

        <View style={styles.content}>
          {/* Header */}
          <Animated.View style={[styles.header, { opacity: headerOpacity, transform: [{ translateX: headerX }] }]}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerLabel}>NIGHTLY DEBRIEF</Text>
              <View style={styles.headerMeta}>
                <Text style={[styles.metaText, { color: verdictColor }]}>DAY {dayNumber}</Text>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaText}>{dateStr}</Text>
              </View>
            </View>
            <View style={[styles.headerBadge, { borderColor: `${verdictColor}50` }]}>
              <Text style={[styles.headerBadgeText, { color: verdictColor }]}>{username}</Text>
            </View>
          </Animated.View>

          {/* Divider 1 */}
          <Animated.View style={[styles.divider, { width: divider1Width, backgroundColor: "#2A2D38" }]} />

          {/* Domain delta rows */}
          <View style={styles.domainGrid}>
            {DOMAINS.map((d, i) => {
              const delta = debrief.domainDeltas[d] ?? 0;
              const isPositive = delta > 0;
              const isZero = delta === 0;
              const domainColor = DOMAIN_COLORS[d];
              const deltaColor = isZero ? "#6B7280" : isPositive ? "#4B8B6F" : "#E05555";
              return (
                <Animated.View
                  key={d}
                  style={[styles.domainRow, { opacity: domainOpacities[i] ?? 0 }]}
                >
                  <View style={[styles.domainDot, { backgroundColor: domainColor }]} />
                  <Text style={[styles.domainName, { color: domainColor }]}>{d}</Text>
                  <View style={styles.domainBar}>
                    {/* Base track */}
                    <View style={styles.barTrack} />
                    {/* Fill */}
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.min(100, Math.abs(delta) * 10)}%`,
                          backgroundColor: deltaColor,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.deltaValue, { color: deltaColor }]}>
                    {isZero ? "±0.0" : `${isPositive ? "+" : ""}${delta.toFixed(1)}`}
                  </Text>
                </Animated.View>
              );
            })}
          </View>

          {/* Quest + Shadow stats */}
          <Animated.View style={[styles.statsRow, { opacity: statsOpacity }]}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>QUESTS</Text>
              <Text style={[
                styles.statValue,
                {
                  color: debrief.questTotal > 0 && debrief.questCompleted / debrief.questTotal >= 0.5
                    ? "#4B8B6F"
                    : debrief.questCompleted === 0
                    ? "#E05555"
                    : "#C4873A",
                },
              ]}>
                {debrief.questCompleted}/{debrief.questTotal}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>SHADOW GAP</Text>
              <Text style={[
                styles.statValue,
                { color: debrief.shadowGap > 0 ? "#E05555" : "#4B8B6F" },
              ]}>
                {debrief.shadowGap > 0 ? "-" : "+"}{Math.abs(debrief.shadowGap).toFixed(1)} pts
              </Text>
            </View>
          </Animated.View>

          {/* Divider 2 */}
          <Animated.View style={[styles.divider, { width: divider2Width, backgroundColor: "#2A2D38" }]} />

          {/* AI text */}
          <Animated.View style={[styles.aiBlock, { opacity: aiOpacity }]}>
            <Text style={styles.aiText}>{displayedText}</Text>
            {displayedText.length < debrief.aiText.length && (
              <Text style={[styles.cursor, { color: verdictColor }]}>█</Text>
            )}
          </Animated.View>

          {/* Verdict */}
          <View style={styles.verdictBlock}>
            <Animated.Text
              style={[
                styles.verdictWord,
                {
                  color: verdictColor,
                  opacity: verdictOpacity,
                  transform: [{ scale: verdictScale }],
                },
              ]}
            >
              {debrief.verdict}
            </Animated.Text>
            <Animated.Text style={[styles.verdictSub, { opacity: verdictSubOpacity }]}>
              {VERDICT_SUB[debrief.verdict]}
            </Animated.Text>
          </View>

          {/* Dismiss */}
          <Animated.View style={[styles.btnWrap, { opacity: btnOpacity }]}>
            <Pressable
              style={({ pressed }) => [styles.btn, { borderColor: `${verdictColor}50`, opacity: pressed ? 0.6 : 1 }]}
              onPress={onAcknowledge}
            >
              <Feather name="x" size={12} color={verdictColor} />
              <Text style={[styles.btnText, { color: verdictColor }]}>CLOSE DEBRIEF</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#040609",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 32,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headerLeft: {
    gap: 5,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: "900" as const,
    letterSpacing: 5,
    color: "#E8E8EC",
  },
  headerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaText: {
    fontSize: 9,
    letterSpacing: 2,
    color: "#6B7280",
    fontWeight: "600" as const,
  },
  metaDot: {
    color: "#2A2D38",
    fontSize: 10,
  },
  headerBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  headerBadgeText: {
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: "700" as const,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  domainGrid: {
    gap: 10,
  },
  domainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  domainDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  domainName: {
    fontSize: 9,
    fontWeight: "800" as const,
    letterSpacing: 2,
    width: 88,
  },
  domainBar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#1A1D24",
    overflow: "hidden",
    position: "relative",
  },
  barTrack: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1A1D24",
  },
  barFill: {
    height: 3,
    borderRadius: 2,
  },
  deltaValue: {
    fontSize: 13,
    fontWeight: "800" as const,
    letterSpacing: 1,
    width: 48,
    textAlign: "right",
  },
  statsRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#2A2D38",
    borderRadius: 6,
  },
  statCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 4,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: "#2A2D38",
  },
  statLabel: {
    fontSize: 8,
    letterSpacing: 3,
    color: "#6B7280",
    fontWeight: "700" as const,
  },
  statValue: {
    fontSize: 17,
    fontWeight: "800" as const,
    letterSpacing: 1,
  },
  aiBlock: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    minHeight: 60,
  },
  aiText: {
    fontSize: 13,
    lineHeight: 21,
    color: "#A0A4B0",
    fontWeight: "400" as const,
  },
  cursor: {
    fontSize: 13,
    lineHeight: 21,
    opacity: 0.8,
  },
  verdictBlock: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  verdictWord: {
    fontSize: 32,
    fontWeight: "900" as const,
    letterSpacing: 8,
  },
  verdictSub: {
    fontSize: 10,
    letterSpacing: 2,
    color: "#6B7280",
    fontWeight: "500" as const,
  },
  btnWrap: {
    marginTop: "auto" as unknown as number,
  },
  btn: {
    borderWidth: 1,
    borderRadius: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 10,
  },
  btnText: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 4,
  },
  gridLine: {
    position: "absolute",
  },
  gridV: {
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "#fff",
    opacity: 0.015,
  },
});
