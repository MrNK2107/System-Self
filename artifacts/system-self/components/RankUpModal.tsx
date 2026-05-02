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
import type { Rank } from "@/context/AppContext";

const { width: SW, height: SH } = Dimensions.get("window");

const RANK_COLORS: Record<Rank, string> = {
  E: "#6B7280",
  D: "#4B8B6F",
  C: "#3A7BD5",
  B: "#7C5CBF",
  A: "#C4873A",
  S: "#D4B483",
};

const RANK_NAMES: Record<Rank, string> = {
  E: "UNRANKED",
  D: "AWARE",
  C: "CONSISTENT",
  B: "DISCIPLINED",
  A: "ELITE",
  S: "SYSTEM-LEVEL",
};

const RANK_UNLOCKS: Record<Rank, string[]> = {
  E: [],
  D: [
    "Harder daily quests now assigned",
    "Shadow Self variance has increased",
    "Rival awareness fully activated",
  ],
  C: [
    "Arc quests unlocked — multi-week operations",
    "Rival position tracking begins",
    "Daily log score multiplier increased",
  ],
  B: [
    "Shadow Self gains ground faster now",
    "Weekly quest difficulty escalates",
    "Rival challenge mode available",
  ],
  A: [
    "Elite tier operations assigned",
    "System threat level raised to critical",
    "Shadow gap tolerance is now zero",
  ],
  S: [
    "System-level designation achieved",
    "All rivals have been notified",
    "No further thresholds. This is it.",
  ],
};

interface Props {
  visible: boolean;
  fromRank: Rank;
  toRank: Rank;
  newCodename: string;
  onAcknowledge: () => void;
}

export function RankUpModal({ visible, fromRank, toRank, newCodename, onAcknowledge }: Props) {
  const newColor = RANK_COLORS[toRank];
  const oldColor = RANK_COLORS[fromRank];

  // Animation values
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const scanY = useRef(new Animated.Value(-4)).current;
  const glitchOpacity = useRef(new Animated.Value(0)).current;
  const overrideScale = useRef(new Animated.Value(1.3)).current;
  const thresholdOpacity = useRef(new Animated.Value(0)).current;
  const oldRankOpacity = useRef(new Animated.Value(1)).current;
  const oldRankScale = useRef(new Animated.Value(1)).current;
  const newRankOpacity = useRef(new Animated.Value(0)).current;
  const newRankScale = useRef(new Animated.Value(0.4)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const infoOpacity = useRef(new Animated.Value(0)).current;
  const unlocksOpacity = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  const codenameOpacity = useRef(new Animated.Value(0)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;

  // Text glitch state
  const [glitchText, setGlitchText] = useState("SYSTEM OVERRIDE");
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setShowContent(false);

    // Reset all values
    overlayOpacity.setValue(0);
    scanY.setValue(-4);
    glitchOpacity.setValue(0);
    overrideScale.setValue(1.3);
    thresholdOpacity.setValue(0);
    oldRankOpacity.setValue(1);
    oldRankScale.setValue(1);
    newRankOpacity.setValue(0);
    newRankScale.setValue(0.4);
    glowOpacity.setValue(0);
    infoOpacity.setValue(0);
    unlocksOpacity.forEach(a => a.setValue(0));
    codenameOpacity.setValue(0);
    btnOpacity.setValue(0);

    setShowContent(true);

    // t=0: overlay fades in
    Animated.timing(overlayOpacity, { toValue: 1, duration: 500, useNativeDriver: false }).start();

    // t=0: scan loop starts
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanY, { toValue: SH + 4, duration: 2400, useNativeDriver: false }),
        Animated.timing(scanY, { toValue: -4, duration: 0, useNativeDriver: false }),
        Animated.delay(500),
      ])
    ).start();

    // t=400: "SYSTEM OVERRIDE" glitches in
    const t1 = setTimeout(() => {
      // Glitch effect: rapidly change text for 400ms
      let count = 0;
      const GLITCH_CHARS = "SY5TEM //0VERRIDE█▓▒░RANK■UP▀▄";
      const glitchInterval = setInterval(() => {
        count++;
        if (count > 8) {
          clearInterval(glitchInterval);
          setGlitchText("SYSTEM // OVERRIDE");
        } else {
          const len = 18;
          setGlitchText(
            Array.from({ length: len }).map((_, i) =>
              Math.random() > 0.6 ? GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)] : "SYSTEM // OVERRIDE"[i] ?? " "
            ).join("")
          );
        }
      }, 60);

      Animated.parallel([
        Animated.timing(glitchOpacity, { toValue: 1, duration: 200, useNativeDriver: false }),
        Animated.timing(overrideScale, { toValue: 1, duration: 300, useNativeDriver: false }),
      ]).start();
    }, 400);

    // t=800: "RANK THRESHOLD CROSSED"
    const t2 = setTimeout(() => {
      Animated.timing(thresholdOpacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, 900);

    // t=1500: old rank shrinks away
    const t3 = setTimeout(() => {
      Animated.parallel([
        Animated.timing(oldRankOpacity, { toValue: 0, duration: 400, useNativeDriver: false }),
        Animated.timing(oldRankScale, { toValue: 0.3, duration: 400, useNativeDriver: false }),
      ]).start();
    }, 1500);

    // t=1900: new rank erupts
    const t4 = setTimeout(() => {
      Animated.parallel([
        Animated.timing(newRankOpacity, { toValue: 1, duration: 400, useNativeDriver: false }),
        Animated.spring(newRankScale, {
          toValue: 1,
          tension: 50,
          friction: 6,
          useNativeDriver: false,
        }),
      ]).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(glowOpacity, { toValue: 0.7, duration: 1200, useNativeDriver: false }),
          Animated.timing(glowOpacity, { toValue: 0.25, duration: 1200, useNativeDriver: false }),
        ])
      ).start();
    }, 1900);

    // t=2600: rank info appears
    const t5 = setTimeout(() => {
      Animated.timing(infoOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    }, 2600);

    // t=3100: unlocks appear staggered
    const t6 = setTimeout(() => {
      unlocksOpacity.forEach((a, i) => {
        setTimeout(() => {
          Animated.timing(a, { toValue: 1, duration: 350, useNativeDriver: false }).start();
        }, i * 350);
      });
    }, 3100);

    // t=4300: codename reveal
    const t7 = setTimeout(() => {
      Animated.timing(codenameOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    }, 4300);

    // t=4900: acknowledge button
    const t8 = setTimeout(() => {
      Animated.timing(btnOpacity, { toValue: 1, duration: 500, useNativeDriver: false }).start();
    }, 4900);

    return () => {
      [t1, t2, t3, t4, t5, t6, t7, t8].forEach(clearTimeout);
    };
  }, [visible]);

  if (!visible || !showContent) return null;

  const unlocks = RANK_UNLOCKS[toRank] ?? [];

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        {/* Background */}
        <LinearGradient
          colors={["#030508", "#070A10", "#0A0C14"]}
          style={StyleSheet.absoluteFill}
        />
        {/* Colored tint matching new rank */}
        <LinearGradient
          colors={[`${newColor}18`, "transparent", `${newColor}08`]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Grid */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Array.from({ length: Math.ceil(SW / 40) + 1 }).map((_, i) => (
            <View key={`v${i}`} style={[styles.gridV, { left: i * 40 }]} />
          ))}
          {Array.from({ length: Math.ceil(SH / 52) + 1 }).map((_, i) => (
            <View key={`h${i}`} style={[styles.gridH, { top: i * 52 }]} />
          ))}
        </View>

        {/* Scan line */}
        <Animated.View style={[styles.scanLine, { top: scanY, backgroundColor: newColor }]} pointerEvents="none" />

        {/* Main content */}
        <View style={styles.content}>
          {/* SYSTEM OVERRIDE header */}
          <Animated.View style={[styles.headerBlock, { opacity: glitchOpacity, transform: [{ scale: overrideScale }] }]}>
            <Text style={[styles.overrideText, { color: newColor }]}>{glitchText}</Text>
          </Animated.View>

          <Animated.View style={[styles.thresholdBlock, { opacity: thresholdOpacity }]}>
            <View style={[styles.thresholdPill, { borderColor: `${newColor}50` }]}>
              <Text style={[styles.thresholdText, { color: `${newColor}90` }]}>
                RANK THRESHOLD CROSSED
              </Text>
            </View>
          </Animated.View>

          {/* Rank transition zone */}
          <View style={styles.rankZone}>
            {/* Glow aura */}
            <Animated.View style={[styles.rankGlow, { opacity: glowOpacity, backgroundColor: newColor }]} />

            {/* Old rank fades out */}
            <Animated.View
              style={[
                styles.oldRankBadge,
                {
                  opacity: oldRankOpacity,
                  transform: [{ scale: oldRankScale }],
                  borderColor: `${oldColor}60`,
                },
              ]}
            >
              <Text style={[styles.oldRankLetter, { color: oldColor }]}>{fromRank}</Text>
            </Animated.View>

            {/* New rank erupts */}
            <Animated.View
              style={[
                styles.newRankBadge,
                {
                  opacity: newRankOpacity,
                  transform: [{ scale: newRankScale }],
                  borderColor: `${newColor}70`,
                  backgroundColor: `${newColor}10`,
                  shadowColor: newColor,
                },
              ]}
            >
              <Text style={[styles.newRankLetter, { color: newColor }]}>{toRank}</Text>
            </Animated.View>
          </View>

          {/* Rank info */}
          <Animated.View style={[styles.rankInfo, { opacity: infoOpacity }]}>
            <Text style={[styles.rankName, { color: newColor }]}>{RANK_NAMES[toRank]}</Text>
            <Text style={styles.rankSub}>New designation assigned.</Text>
          </Animated.View>

          {/* Unlocks */}
          <View style={styles.unlocksList}>
            {unlocks.map((unlock, i) => (
              <Animated.View
                key={i}
                style={[styles.unlockRow, { opacity: unlocksOpacity[i] ?? 0 }]}
              >
                <View style={[styles.unlockDot, { backgroundColor: newColor }]} />
                <Text style={[styles.unlockText, { color: `${newColor}CC` }]}>{unlock}</Text>
              </Animated.View>
            ))}
          </View>

          {/* New codename */}
          <Animated.View style={[styles.codenameBlock, { opacity: codenameOpacity, borderColor: `${newColor}30` }]}>
            <Text style={styles.codenameLabel}>RIVALS NOW IDENTIFY YOU AS</Text>
            <Text style={[styles.codenameValue, { color: newColor }]}>{newCodename}</Text>
          </Animated.View>

          {/* Acknowledge */}
          <Animated.View style={[styles.btnWrap, { opacity: btnOpacity }]}>
            <Pressable
              style={({ pressed }) => [styles.ackBtn, { borderColor: newColor, opacity: pressed ? 0.7 : 1 }]}
              onPress={onAcknowledge}
            >
              <LinearGradient
                colors={[`${newColor}25`, `${newColor}10`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.ackGradient}
              >
                <Feather name="check" size={14} color={newColor} />
                <Text style={[styles.ackText, { color: newColor }]}>ACKNOWLEDGE</Text>
              </LinearGradient>
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
    backgroundColor: "#030508",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 18,
  },
  headerBlock: {
    alignItems: "center",
  },
  overrideText: {
    fontSize: 13,
    fontWeight: "900" as const,
    letterSpacing: 5,
    textAlign: "center",
  },
  thresholdBlock: {
    alignItems: "center",
  },
  thresholdPill: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  thresholdText: {
    fontSize: 9,
    letterSpacing: 3,
    fontWeight: "700" as const,
  },
  rankZone: {
    alignItems: "center",
    justifyContent: "center",
    width: 160,
    height: 160,
  },
  rankGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
  },
  oldRankBadge: {
    position: "absolute",
    width: 100,
    height: 100,
    borderWidth: 1,
    backgroundColor: "#08091040",
    alignItems: "center",
    justifyContent: "center",
  },
  oldRankLetter: {
    fontSize: 52,
    fontWeight: "900" as const,
    letterSpacing: 6,
    lineHeight: 60,
    opacity: 0.4,
  },
  newRankBadge: {
    position: "absolute",
    width: 120,
    height: 120,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 40,
    elevation: 20,
  },
  newRankLetter: {
    fontSize: 64,
    fontWeight: "900" as const,
    letterSpacing: 8,
    lineHeight: 72,
  },
  rankInfo: {
    alignItems: "center",
    gap: 6,
  },
  rankName: {
    fontSize: 22,
    fontWeight: "900" as const,
    letterSpacing: 6,
  },
  rankSub: {
    fontSize: 11,
    color: "#2A2D38",
    letterSpacing: 1,
  },
  unlocksList: {
    width: "100%",
    gap: 8,
  },
  unlockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  unlockDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  unlockText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500" as const,
  },
  codenameBlock: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    gap: 5,
    alignItems: "center",
  },
  codenameLabel: {
    fontSize: 8,
    letterSpacing: 3,
    color: "#2A2D38",
    fontWeight: "700" as const,
  },
  codenameValue: {
    fontSize: 16,
    fontWeight: "800" as const,
    letterSpacing: 2,
  },
  btnWrap: {
    width: "100%",
  },
  ackBtn: {
    borderWidth: 1,
    borderRadius: 2,
    overflow: "hidden",
  },
  ackGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    gap: 10,
  },
  ackText: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 4,
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    opacity: 0.2,
  },
  gridV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "#fff",
    opacity: 0.02,
  },
  gridH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#fff",
    opacity: 0.02,
  },
});
