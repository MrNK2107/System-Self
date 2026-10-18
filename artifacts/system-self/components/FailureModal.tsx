import React, { useEffect, useRef, useState } from "react";
import {
  Animated, Dimensions, Modal, Pressable, StyleSheet, Text, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useSystemAI } from "@/hooks/useSystemAI";
import { useApp } from "@/context/AppContext";
import type { FailureItem } from "@/lib/game/notices";

const { width: SW } = Dimensions.get("window");

interface Props {
  visible: boolean;
  /** Quests the server failed (expired) since the last visit; shown together in one modal. */
  failures: FailureItem[];
  onAcknowledge: () => void;
}

const MAX_TITLES = 4;

export function FailureModal({ visible, failures, onAcknowledge }: Props) {
  const quest = failures[0] ?? null;
  const { user } = useApp();
  const { generateMessage } = useSystemAI();

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const redFlash = useRef(new Animated.Value(0)).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleX = useRef(new Animated.Value(-20)).current;
  const penaltyOpacity = useRef(new Animated.Value(0)).current;
  const penaltyScale = useRef(new Animated.Value(2)).current;
  const aiOpacity = useRef(new Animated.Value(0)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;

  const [aiText, setAiText] = useState("");
  const [displayed, setDisplayed] = useState("");
  const [aiLoaded, setAiLoaded] = useState(false);

  useEffect(() => {
    if (!visible || !quest) return;

    // Reset
    overlayOpacity.setValue(0);
    redFlash.setValue(0);
    labelOpacity.setValue(0);
    titleOpacity.setValue(0);
    titleX.setValue(-20);
    penaltyOpacity.setValue(0);
    penaltyScale.setValue(2);
    aiOpacity.setValue(0);
    btnOpacity.setValue(0);
    setAiText("");
    setDisplayed("");
    setAiLoaded(false);

    const timers: ReturnType<typeof setTimeout>[] = [];

    // Flash
    Animated.sequence([
      Animated.timing(overlayOpacity, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.timing(redFlash, { toValue: 0.25, duration: 180, useNativeDriver: false }),
      Animated.timing(redFlash, { toValue: 0, duration: 300, useNativeDriver: false }),
    ]).start();

    timers.push(setTimeout(() => {
      Animated.timing(labelOpacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, 400));

    timers.push(setTimeout(() => {
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 400, useNativeDriver: false }),
        Animated.timing(titleX, { toValue: 0, duration: 400, useNativeDriver: false }),
      ]).start();
    }, 700));

    timers.push(setTimeout(() => {
      Animated.parallel([
        Animated.timing(penaltyOpacity, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.spring(penaltyScale, { toValue: 1, friction: 5, useNativeDriver: false }),
      ]).start();
    }, 1100));

    timers.push(setTimeout(() => {
      Animated.timing(aiOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    }, 1500));

    timers.push(setTimeout(() => {
      Animated.timing(btnOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    }, 3200));

    // Fetch AI failure message (POST /api/messages; the fallback string on any failure).
    let cancelled = false;
    if (user) {
      generateMessage("failure_response").then(msg => {
        if (cancelled) return;
        setAiText(msg);
        setAiLoaded(true);
      });
    }

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [visible, failures]);

  // Typewriter
  useEffect(() => {
    if (!aiText) { setDisplayed(""); return; }
    let i = 0;
    const delay = Math.min(35, 1800 / Math.max(aiText.length, 1));
    const iv = setInterval(() => {
      i++;
      setDisplayed(aiText.slice(0, i));
      if (i >= aiText.length) clearInterval(iv);
    }, delay);
    return () => clearInterval(iv);
  }, [aiText]);

  if (!visible || !quest) return null;

  const totalPenalty = failures.reduce((sum, f) => sum + f.penalty, 0);
  const types = [...new Set(failures.map(f => f.type))];
  const shown = failures.slice(0, MAX_TITLES);
  const hidden = failures.length - shown.length;

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <LinearGradient colors={["#070203", "#0A0203", "#070203"]} style={StyleSheet.absoluteFill} />
        {/* Red flash */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#E05555", opacity: redFlash }]} />
        {/* Scanlines */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Array.from({ length: 20 }).map((_, i) => (
            <View key={i} style={[styles.scanLine, { top: i * 44 }]} />
          ))}
        </View>

        <View style={styles.content}>
          {/* Label */}
          <Animated.View style={[styles.labelWrap, { opacity: labelOpacity }]}>
            <View style={styles.labelDot} />
            <Text style={styles.labelText}>
              {failures.length === 1 ? "OPERATION FAILED" : `${failures.length} OPERATIONS FAILED`}
            </Text>
          </Animated.View>

          {/* Quest titles */}
          <Animated.View style={{ opacity: titleOpacity, transform: [{ translateX: titleX }], gap: 6 }}>
            {shown.map((f, i) => (
              <Text key={i} style={failures.length === 1 ? styles.questTitle : styles.questTitleSmall} numberOfLines={failures.length === 1 ? 2 : 1}>
                {f.title}
              </Text>
            ))}
            {hidden > 0 && <Text style={styles.moreText}>+{hidden} MORE</Text>}
          </Animated.View>

          {/* Types */}
          <Animated.View style={[styles.metaRow, { opacity: titleOpacity }]}>
            {types.map(t => (
              <View key={t} style={[styles.typeBadge, { borderColor: "#E0555540" }]}>
                <Text style={styles.typeText}>{t.toUpperCase()}</Text>
              </View>
            ))}
          </Animated.View>

          {/* Penalty */}
          <Animated.View style={[
            styles.penaltyBlock,
            { opacity: penaltyOpacity, transform: [{ scale: penaltyScale }] },
          ]}>
            <Text style={styles.penaltyLabel}>DISCIPLINE PENALTY</Text>
            <Text style={styles.penaltyVal}>−{totalPenalty.toFixed(1)}</Text>
            <Text style={styles.penaltyNote}>Timestamp is permanent.</Text>
          </Animated.View>

          <View style={styles.divider} />

          {/* AI verdict */}
          <Animated.View style={[styles.aiBlock, { opacity: aiOpacity }]}>
            <Text style={styles.aiSpeaker}>THE SYSTEM</Text>
            {!aiLoaded ? (
              <Text style={styles.aiLoading}>Generating verdict...</Text>
            ) : (
              <Text style={styles.aiText}>
                {displayed}
                {displayed.length < aiText.length && <Text style={styles.cursor}>█</Text>}
              </Text>
            )}
          </Animated.View>

          {/* Button */}
          <Animated.View style={{ opacity: btnOpacity, width: "100%" }}>
            <Pressable
              style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={onAcknowledge}
            >
              <Feather name="x" size={12} color="#E05555" />
              <Text style={styles.btnText}>ACKNOWLEDGED — LOG CLOSED</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center" },
  scanLine: {
    position: "absolute", left: 0, right: 0,
    height: StyleSheet.hairlineWidth, backgroundColor: "#E0555508",
  },
  content: { width: SW - 48, gap: 20, alignItems: "center" },
  labelWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  labelDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#E05555" },
  labelText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 4, color: "#E05555" },
  questTitle: {
    fontSize: 18, fontWeight: "700" as const, color: "#FFFFFF",
    letterSpacing: 0.5, textAlign: "center", lineHeight: 26,
  },
  metaRow: { flexDirection: "row", gap: 8 },
  questTitleSmall: { fontSize: 14, fontWeight: "700" as const, color: "#E8E8EC", textAlign: "center", letterSpacing: 0.5 },
  moreText: { fontSize: 9, fontWeight: "700" as const, letterSpacing: 2, color: "#E05555", textAlign: "center" },
  typeBadge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2, borderColor: "#E0555440" },
  typeText: { fontSize: 9, fontWeight: "700" as const, letterSpacing: 2, color: "#E05555" },
  penaltyBlock: { alignItems: "center", gap: 6, paddingVertical: 16 },
  penaltyLabel: { fontSize: 9, fontWeight: "700" as const, letterSpacing: 3, color: "#E05555" },
  penaltyVal: { fontSize: 48, fontWeight: "800" as const, color: "#E05555", letterSpacing: -1 },
  penaltyNote: { fontSize: 10, color: "#6B0000", letterSpacing: 1.5, fontWeight: "600" as const },
  divider: { width: "100%", height: StyleSheet.hairlineWidth, backgroundColor: "#E0555520" },
  aiBlock: { gap: 8, width: "100%" },
  aiSpeaker: { fontSize: 8, fontWeight: "700" as const, letterSpacing: 3, color: "#E05555" },
  aiLoading: { fontSize: 12, color: "#6B0000", fontStyle: "italic" },
  aiText: { fontSize: 13, color: "#CC8888", lineHeight: 20, fontStyle: "italic" },
  cursor: { color: "#E05555" },
  btn: {
    borderWidth: 1, borderColor: "#E0555540",
    paddingVertical: 14, alignItems: "center", borderRadius: 2,
    flexDirection: "row", gap: 8, justifyContent: "center",
  },
  btnText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 2.5, color: "#E05555" },
});
