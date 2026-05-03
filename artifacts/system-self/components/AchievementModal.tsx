import React, { useEffect, useRef } from "react";
import {
  Animated, Dimensions, Modal, Pressable, StyleSheet, Text, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import type { PendingAchievement } from "@/context/AppContext";

const { width: SW } = Dimensions.get("window");

interface Props {
  visible: boolean;
  achievement: PendingAchievement | null;
  onAcknowledge: () => void;
}

export function AchievementModal({ visible, achievement, onAcknowledge }: Props) {
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const badgeScale = useRef(new Animated.Value(0.3)).current;
  const badgeOpacity = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(16)).current;
  const descOpacity = useRef(new Animated.Value(0)).current;
  const tagOpacity = useRef(new Animated.Value(0)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;

    overlayOpacity.setValue(0);
    badgeScale.setValue(0.3);
    badgeOpacity.setValue(0);
    glowOpacity.setValue(0);
    titleOpacity.setValue(0);
    titleY.setValue(16);
    descOpacity.setValue(0);
    tagOpacity.setValue(0);
    btnOpacity.setValue(0);

    const timers: ReturnType<typeof setTimeout>[] = [];

    Animated.timing(overlayOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();

    timers.push(setTimeout(() => {
      Animated.parallel([
        Animated.spring(badgeScale, { toValue: 1, friction: 4, tension: 100, useNativeDriver: false }),
        Animated.timing(badgeOpacity, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.timing(glowOpacity, { toValue: 0.6, duration: 600, useNativeDriver: false }),
      ]).start();
    }, 300));

    timers.push(setTimeout(() => {
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 400, useNativeDriver: false }),
        Animated.timing(titleY, { toValue: 0, duration: 400, useNativeDriver: false }),
      ]).start();
    }, 700));

    timers.push(setTimeout(() => {
      Animated.timing(descOpacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, 1000));

    timers.push(setTimeout(() => {
      Animated.timing(tagOpacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, 1200));

    timers.push(setTimeout(() => {
      Animated.timing(btnOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    }, 1600));

    // Pulse glow
    timers.push(setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 1400, useNativeDriver: false }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1400, useNativeDriver: false }),
        ])
      ).start();
    }, 900));

    return () => timers.forEach(clearTimeout);
  }, [visible]);

  if (!visible || !achievement) return null;

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <LinearGradient
          colors={["#03050A", "#060A03", "#03050A"]}
          style={StyleSheet.absoluteFill}
        />
        {/* Subtle grid */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Array.from({ length: 10 }).map((_, i) => (
            <View key={i} style={[styles.gridLine, { top: i * (SW * 0.12) }]} />
          ))}
        </View>

        <View style={styles.content}>
          {/* Tag */}
          <Animated.View style={[styles.tagWrap, { opacity: tagOpacity }]}>
            <Text style={styles.tagText}>ACHIEVEMENT UNLOCKED</Text>
          </Animated.View>

          {/* Badge */}
          <Animated.View style={[styles.badgeWrap, { transform: [{ scale: badgeScale }], opacity: badgeOpacity }]}>
            <Animated.View style={[styles.glowRing, { opacity: glowOpacity, transform: [{ scale: pulseAnim }] }]} />
            <View style={styles.badge}>
              <Feather name={achievement.icon as any} size={36} color="#C4873A" />
            </View>
          </Animated.View>

          {/* Title */}
          <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleY }] }}>
            <Text style={styles.title}>{achievement.title}</Text>
          </Animated.View>

          {/* Description */}
          <Animated.View style={{ opacity: descOpacity }}>
            <Text style={styles.desc}>{achievement.description}</Text>
          </Animated.View>

          {/* Divider */}
          <Animated.View style={[styles.divider, { opacity: descOpacity }]} />

          {/* Acknowledge button */}
          <Animated.View style={{ opacity: btnOpacity, width: "100%" }}>
            <Pressable
              style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={onAcknowledge}
            >
              <Text style={styles.btnText}>ACKNOWLEDGED</Text>
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
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#C4873A08",
  },
  content: {
    width: SW - 48,
    alignItems: "center",
    gap: 20,
    paddingVertical: 16,
  },
  tagWrap: {
    borderWidth: 1,
    borderColor: "#C4873A50",
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 2,
  },
  tagText: {
    fontSize: 9,
    fontWeight: "800" as const,
    letterSpacing: 3,
    color: "#C4873A",
  },
  badgeWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 120,
    height: 120,
  },
  glowRing: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#C4873A12",
    borderWidth: 1,
    borderColor: "#C4873A40",
  },
  badge: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#C4873A18",
    borderWidth: 2,
    borderColor: "#C4873A80",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "800" as const,
    color: "#C4873A",
    letterSpacing: 2,
    textAlign: "center",
  },
  desc: {
    fontSize: 13,
    color: "#8A8D98",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  divider: {
    width: "60%",
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#C4873A30",
  },
  btn: {
    borderWidth: 1,
    borderColor: "#C4873A50",
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 2,
  },
  btnText: {
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 3,
    color: "#C4873A",
  },
});
