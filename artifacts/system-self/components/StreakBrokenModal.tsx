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
import type { StreakBreakData, Domain } from "@/context/AppContext";
import { useSystemAI } from "@/hooks/useSystemAI";
import { useApp } from "@/context/AppContext";
import { DOMAIN_COLORS } from "@/constants/domains";

const { width: SW } = Dimensions.get("window");

interface Props {
  visible: boolean;
  data: StreakBreakData;
  onAcknowledge: () => void;
}

export function StreakBrokenModal({ visible, data, onAcknowledge }: Props) {
  const { user } = useApp();
  const { generateMessage } = useSystemAI();

  const [aiText, setAiText] = useState(data.aiText || "");
  const [aiLoaded, setAiLoaded] = useState(!!data.aiText);
  const [showContent, setShowContent] = useState(false);

  // Animations
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const alertOpacity = useRef(new Animated.Value(0)).current;
  const alertScale = useRef(new Animated.Value(1.1)).current;
  const blinkOpacity = useRef(new Animated.Value(0)).current;
  const timeOpacity = useRef(new Animated.Value(0)).current;
  const listOpacity = useRef(
    data.brokenDomains.map(() => new Animated.Value(0))
  ).current;
  const penaltyOpacity = useRef(new Animated.Value(0)).current;
  const dividerWidth = useRef(new Animated.Value(0)).current;
  const aiOpacity = useRef(new Animated.Value(0)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;

  // Typewriter for AI text
  const [displayedAi, setDisplayedAi] = useState("");

  // Fetch AI text if missing
  useEffect(() => {
    if (!visible || aiLoaded || !user) return;
    let cancelled = false;
    generateMessage("streak_break").then(text => {
      if (cancelled) return;
      setAiText(text);
      setAiLoaded(true);
    });
    return () => { cancelled = true; };
  }, [visible, aiLoaded, user]);

  useEffect(() => {
    if (!visible) return;

    // Reset
    overlayOpacity.setValue(0);
    alertOpacity.setValue(0);
    alertScale.setValue(1.1);
    blinkOpacity.setValue(0);
    timeOpacity.setValue(0);
    listOpacity.forEach(a => a.setValue(0));
    penaltyOpacity.setValue(0);
    dividerWidth.setValue(0);
    aiOpacity.setValue(0);
    btnOpacity.setValue(0);
    setDisplayedAi("");
    setShowContent(true);

    // t=0: overlay
    Animated.timing(overlayOpacity, { toValue: 1, duration: 350, useNativeDriver: false }).start();

    // t=300: alert blinks in
    const t1 = setTimeout(() => {
      Animated.parallel([
        Animated.timing(alertOpacity, { toValue: 1, duration: 200, useNativeDriver: false }),
        Animated.timing(alertScale, { toValue: 1, duration: 200, useNativeDriver: false }),
      ]).start(() => {
        // Blink 3 times
        Animated.sequence([
          Animated.timing(blinkOpacity, { toValue: 1, duration: 80, useNativeDriver: false }),
          Animated.timing(blinkOpacity, { toValue: 0, duration: 80, useNativeDriver: false }),
          Animated.timing(blinkOpacity, { toValue: 1, duration: 80, useNativeDriver: false }),
          Animated.timing(blinkOpacity, { toValue: 0, duration: 80, useNativeDriver: false }),
          Animated.timing(blinkOpacity, { toValue: 1, duration: 80, useNativeDriver: false }),
        ]).start();
      });
    }, 300);

    // t=600: timestamp
    const t2 = setTimeout(() => {
      Animated.timing(timeOpacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, 600);

    // t=900: broken domain rows stagger
    const t3 = setTimeout(() => {
      listOpacity.forEach((a, i) => {
        setTimeout(() => {
          Animated.timing(a, { toValue: 1, duration: 300, useNativeDriver: false }).start();
        }, i * 200);
      });
    }, 900);

    const listEnd = 900 + data.brokenDomains.length * 200 + 200;

    // penalty block
    const t4 = setTimeout(() => {
      Animated.timing(penaltyOpacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, listEnd);

    // divider
    const t5 = setTimeout(() => {
      Animated.timing(dividerWidth, { toValue: SW - 48, duration: 350, useNativeDriver: false }).start();
    }, listEnd + 300);

    // AI text (wait for it to load, then typewriter)
    const t6 = setTimeout(() => {
      Animated.timing(aiOpacity, { toValue: 1, duration: 200, useNativeDriver: false }).start();
    }, listEnd + 650);

    // button
    const t7 = setTimeout(() => {
      Animated.timing(btnOpacity, { toValue: 1, duration: 500, useNativeDriver: false }).start();
    }, listEnd + 1200);

    return () => {
      [t1, t2, t3, t4, t5, t6, t7].forEach(clearTimeout);
    };
  }, [visible, data.brokenDomains.length]);

  // Typewriter once AI text is ready and the block is visible
  useEffect(() => {
    if (!aiText || !showContent) return;
    setDisplayedAi("");
    const delay = Math.min(50, 2200 / Math.max(aiText.length, 1));
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayedAi(aiText.slice(0, i));
      if (i >= aiText.length) clearInterval(interval);
    }, delay);
    return () => clearInterval(interval);
  }, [aiText, showContent]);

  if (!visible || !showContent) return null;

  const detectedTime = new Date(data.detectedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const detectedDate = new Date(data.detectedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <LinearGradient
          colors={["#060305", "#0C0508", "#080305"]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["#E0555514", "transparent", "#E0555508"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Scan grid */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Array.from({ length: Math.ceil(SW / 44) + 1 }).map((_, i) => (
            <View key={i} style={[styles.gridV, { left: i * 44 }]} />
          ))}
        </View>

        <View style={styles.content}>
          {/* Alert header */}
          <Animated.View style={[styles.alertBlock, { opacity: alertOpacity, transform: [{ scale: alertScale }] }]}>
            <View style={styles.alertIconRow}>
              <Animated.View style={[styles.alertDot, { opacity: blinkOpacity }]} />
              <Feather name="alert-triangle" size={14} color="#E05555" />
              <Text style={styles.alertTitle}>STREAK BREAK DETECTED</Text>
            </View>
          </Animated.View>

          {/* Timestamp */}
          <Animated.View style={[styles.timeRow, { opacity: timeOpacity }]}>
            <Text style={styles.timeLabel}>LOGGED</Text>
            <Text style={styles.timeValue}>{detectedDate} · {detectedTime}</Text>
          </Animated.View>

          {/* Broken domain list */}
          <View style={[styles.brokenCard, { borderColor: "#E0555530" }]}>
            <Text style={styles.brokenCardLabel}>DOMAINS COMPROMISED</Text>
            {data.brokenDomains.map((b, i) => (
              <Animated.View
                key={b.domain}
                style={[styles.brokenRow, { opacity: listOpacity[i] ?? 1 }]}
              >
                <View style={[styles.brokenDot, { backgroundColor: DOMAIN_COLORS[b.domain] }]} />
                <Text style={[styles.brokenDomain, { color: DOMAIN_COLORS[b.domain] }]}>{b.domain}</Text>
                <View style={styles.brokenRight}>
                  <Text style={styles.streakLost}>−{b.lostStreak}D streak</Text>
                  <Text style={styles.streakLostSub}>reset to 0</Text>
                </View>
              </Animated.View>
            ))}
          </View>

          {/* Penalty */}
          <Animated.View style={[styles.penaltyRow, { opacity: penaltyOpacity, borderColor: "#E0555530" }]}>
            <Text style={styles.penaltyLabel}>DISCIPLINE PENALTY APPLIED</Text>
            <Text style={styles.penaltyValue}>−{data.penalty.toFixed(1)} pts</Text>
          </Animated.View>

          {/* Divider */}
          <Animated.View style={[styles.divider, { width: dividerWidth }]} />

          {/* AI text */}
          <Animated.View style={[styles.aiBlock, { opacity: aiOpacity }]}>
            {!aiLoaded ? (
              <Text style={styles.aiLoading}>Generating assessment...</Text>
            ) : (
              <>
                <Text style={styles.aiText}>{displayedAi}</Text>
                {displayedAi.length < aiText.length && (
                  <Text style={styles.cursor}>█</Text>
                )}
              </>
            )}
          </Animated.View>

          {/* Acknowledge */}
          <Animated.View style={[styles.btnWrap, { opacity: btnOpacity }]}>
            <Pressable
              style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={onAcknowledge}
            >
              <LinearGradient
                colors={["#E0555518", "#E0555508"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.btnGrad}
              >
                <Text style={styles.btnText}>ACKNOWLEDGED</Text>
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
    backgroundColor: "#060305",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 32,
    gap: 16,
  },
  alertBlock: {
    alignItems: "flex-start",
  },
  alertIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  alertDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E05555",
  },
  alertTitle: {
    fontSize: 13,
    fontWeight: "900" as const,
    letterSpacing: 4,
    color: "#E05555",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  timeLabel: {
    fontSize: 8,
    letterSpacing: 3,
    color: "#2A2D38",
    fontWeight: "700" as const,
  },
  timeValue: {
    fontSize: 9,
    letterSpacing: 1.5,
    color: "#6B7280",
    fontWeight: "500" as const,
  },
  brokenCard: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 14,
    gap: 12,
  },
  brokenCardLabel: {
    fontSize: 8,
    letterSpacing: 3,
    color: "#2A2D38",
    fontWeight: "700" as const,
  },
  brokenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brokenDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  brokenDomain: {
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 2,
    flex: 1,
  },
  brokenRight: {
    alignItems: "flex-end",
    gap: 1,
  },
  streakLost: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: "#E05555",
    letterSpacing: 0.5,
  },
  streakLostSub: {
    fontSize: 8,
    color: "#6B7280",
    letterSpacing: 1,
  },
  penaltyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  penaltyLabel: {
    fontSize: 9,
    letterSpacing: 2,
    color: "#6B7280",
    fontWeight: "600" as const,
  },
  penaltyValue: {
    fontSize: 16,
    fontWeight: "800" as const,
    color: "#E05555",
    letterSpacing: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#2A2D38",
  },
  aiBlock: {
    flexDirection: "row",
    flexWrap: "wrap",
    minHeight: 48,
  },
  aiText: {
    fontSize: 13,
    lineHeight: 21,
    color: "#A0A4B0",
    fontWeight: "400" as const,
  },
  aiLoading: {
    fontSize: 11,
    color: "#2A2D38",
    letterSpacing: 1,
  },
  cursor: {
    fontSize: 13,
    lineHeight: 21,
    color: "#E05555",
    opacity: 0.7,
  },
  btnWrap: {
    marginTop: "auto" as unknown as number,
  },
  btn: {
    borderWidth: 1,
    borderColor: "#E0555540",
    borderRadius: 2,
    overflow: "hidden",
  },
  btnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 10,
  },
  btnText: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 5,
    color: "#E05555",
  },
  gridV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "#E05555",
    opacity: 0.02,
  },
});
