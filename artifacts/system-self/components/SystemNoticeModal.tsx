import React, { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  label: string;
  title: string;
  body: string;
  tone: "alert" | "info";
  onAcknowledge: () => void;
}

/** A plain SYSTEM notice for events without a dedicated modal (chain complete, shadow, demotion). */
export function SystemNoticeModal({ visible, label, title, body, tone, onAcknowledge }: Props) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const accent = tone === "alert" ? "#E05555" : colors.primary;

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
  }, [visible, opacity]);

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent onRequestClose={onAcknowledge}>
      <Animated.View style={[styles.overlay, { opacity, backgroundColor: "#070809F2" }]}>
        <View style={[styles.card, { borderColor: accent + "50", backgroundColor: colors.card }]}>
          <View style={styles.labelRow}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text style={[styles.label, { color: accent }]}>{label}</Text>
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>{body}</Text>
          <Pressable
            style={({ pressed }) => [styles.btn, { borderColor: accent + "60", opacity: pressed ? 0.6 : 1 }]}
            onPress={onAcknowledge}
            accessibilityRole="button"
          >
            <Text style={[styles.btnText, { color: accent }]}>ACKNOWLEDGED</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  card: { width: "100%", borderWidth: 1, borderRadius: 4, padding: 20, gap: 14 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 9, fontWeight: "800", letterSpacing: 3 },
  title: { fontSize: 18, fontWeight: "800", letterSpacing: 1.5 },
  body: { fontSize: 13, lineHeight: 20 },
  btn: { borderWidth: 1, borderRadius: 4, paddingVertical: 12, alignItems: "center", marginTop: 4 },
  btnText: { fontSize: 10, fontWeight: "800", letterSpacing: 3 },
});
