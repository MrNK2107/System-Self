import React, { useEffect, useRef } from "react";
import {
  Animated, Dimensions, Modal, Pressable, StyleSheet, Text, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { Domain, PendingMilestone } from "@/context/AppContext";
import { DOMAIN_COLORS, DOMAIN_GLYPHS as DOMAIN_ICONS } from "@/constants/domains";

const { width: SW } = Dimensions.get("window");

interface Props {
  visible: boolean;
  milestone: PendingMilestone | null;
  onAcknowledge: () => void;
}

export function MilestoneModal({ visible, milestone, onAcknowledge }: Props) {
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(1.5)).current;
  const domainOpacity = useRef(new Animated.Value(0)).current;
  const tierOpacity = useRef(new Animated.Value(0)).current;
  const msgOpacity = useRef(new Animated.Value(0)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible || !milestone) return;
    overlayOpacity.setValue(0);
    barWidth.setValue(0);
    titleOpacity.setValue(0);
    titleScale.setValue(1.5);
    domainOpacity.setValue(0);
    tierOpacity.setValue(0);
    msgOpacity.setValue(0);
    btnOpacity.setValue(0);

    const timers: ReturnType<typeof setTimeout>[] = [];
    Animated.timing(overlayOpacity, { toValue: 1, duration: 350, useNativeDriver: false }).start();

    timers.push(setTimeout(() => {
      Animated.timing(barWidth, { toValue: SW - 48, duration: 800, useNativeDriver: false }).start();
    }, 300));

    timers.push(setTimeout(() => {
      Animated.timing(domainOpacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, 600));

    timers.push(setTimeout(() => {
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: false }),
        Animated.spring(titleScale, { toValue: 1, friction: 5, useNativeDriver: false }),
      ]).start();
    }, 900));

    timers.push(setTimeout(() => {
      Animated.timing(tierOpacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, 1300));

    timers.push(setTimeout(() => {
      Animated.timing(msgOpacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, 1600));

    timers.push(setTimeout(() => {
      Animated.timing(btnOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    }, 2200));

    return () => timers.forEach(clearTimeout);
  }, [visible]);

  if (!visible || !milestone) return null;

  const domColor = DOMAIN_COLORS[milestone.domain];
  const domIcon = DOMAIN_ICONS[milestone.domain];

  const tierMessages: Record<number, string> = {
    60: "Foundation complete. The baseline is now structural.",
    70: "Competence confirmed. This domain no longer holds you back.",
    80: "Elite territory. Few reach this without deliberate architecture.",
    90: "The gap between you and the average is now unmeasurable.",
    100: "Sovereignty achieved. This domain is yours. Completely.",
  };

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <LinearGradient colors={["#030508", "#060509", "#030508"]} style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={[domColor + "14", "transparent", domColor + "06"]}
          start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.content}>
          {/* Progress bar at top */}
          <View style={[styles.barTrack, { backgroundColor: domColor + "20" }]}>
            <Animated.View style={[styles.barFill, { width: barWidth, backgroundColor: domColor }]} />
          </View>

          {/* Domain tag */}
          <Animated.View style={[styles.domainWrap, { opacity: domainOpacity }]}>
            <Text style={[styles.domainIcon, { color: domColor }]}>{domIcon}</Text>
            <Text style={[styles.domainName, { color: domColor }]}>{milestone.domain}</Text>
            <Text style={[styles.domainSub, { color: domColor + "80" }]}>DOMAIN MILESTONE</Text>
          </Animated.View>

          {/* Tier number */}
          <Animated.View style={[styles.tierWrap, { opacity: tierOpacity }]}>
            <Text style={[styles.tierNum, { color: domColor }]}>{milestone.tier}</Text>
            <Text style={[styles.tierLabel, { color: domColor + "80" }]}>THRESHOLD REACHED</Text>
          </Animated.View>

          {/* Title */}
          <Animated.View style={{ opacity: titleOpacity, transform: [{ scale: titleScale }] }}>
            <Text style={[styles.title, { color: domColor }]}>{milestone.title}</Text>
          </Animated.View>

          {/* Message */}
          <Animated.View style={{ opacity: msgOpacity }}>
            <Text style={styles.msg}>{tierMessages[milestone.tier] ?? "Threshold breached."}</Text>
          </Animated.View>

          <View style={[styles.divider, { backgroundColor: domColor + "30" }]} />

          {/* Button */}
          <Animated.View style={{ opacity: btnOpacity, width: "100%" }}>
            <Pressable
              style={({ pressed }) => [styles.btn, { borderColor: domColor + "50", opacity: pressed ? 0.6 : 1 }]}
              onPress={onAcknowledge}
            >
              <Text style={[styles.btnText, { color: domColor }]}>MILESTONE LOGGED</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { width: SW - 48, alignItems: "center", gap: 24 },
  barTrack: { width: "100%", height: 2, borderRadius: 1, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 1 },
  domainWrap: { alignItems: "center", gap: 6 },
  domainIcon: { fontSize: 28 },
  domainName: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 4 },
  domainSub: { fontSize: 8, letterSpacing: 3, fontWeight: "600" as const },
  tierWrap: { alignItems: "center", gap: 4 },
  tierNum: { fontSize: 72, fontWeight: "800" as const, lineHeight: 80, letterSpacing: -2 },
  tierLabel: { fontSize: 9, letterSpacing: 3, fontWeight: "700" as const },
  title: { fontSize: 20, fontWeight: "800" as const, letterSpacing: 2, textAlign: "center" },
  msg: { fontSize: 13, color: "#8A8D98", textAlign: "center", lineHeight: 20, paddingHorizontal: 8 },
  divider: { width: "50%", height: StyleSheet.hairlineWidth },
  btn: {
    borderWidth: 1, paddingVertical: 14,
    alignItems: "center", borderRadius: 2,
  },
  btnText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 3 },
});
