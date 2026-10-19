// Scout report: one optional tap after a gym session. SKIP sends nothing.
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { CROWD_OPTIONS, CROWD_PROMPT, type CrowdLevel } from "@/lib/game/dungeon";

interface Props {
  visible: boolean;
  busy: boolean;
  /** `null` is SKIP. */
  onChoose: (level: CrowdLevel | null) => void;
}

export function CrowdReportSheet({ visible, busy, onChoose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => onChoose(null)}>
      <View style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : () => onChoose(null)} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
          <Text style={[styles.label, { color: colors.primary }]}>SCOUT REPORT</Text>
          <Text style={[styles.prompt, { color: colors.foreground }]}>{CROWD_PROMPT}</Text>
          <View style={styles.row}>
            {CROWD_OPTIONS.map((o) => (
              <Pressable
                key={o.label}
                style={[
                  styles.btn,
                  {
                    borderColor: o.level ? colors.primary + "80" : colors.border,
                    backgroundColor: o.level ? colors.primary + "18" : "transparent",
                    opacity: busy ? 0.5 : 1,
                  },
                ]}
                onPress={() => onChoose(o.level)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={o.label}
              >
                <Text style={[styles.btnText, { color: o.level ? colors.primary : colors.mutedForeground }]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000A" },
  sheet: { borderTopWidth: 1, padding: 20, gap: 12 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 3 },
  prompt: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: { flexGrow: 1, borderWidth: 1, borderRadius: 2, paddingVertical: 13, paddingHorizontal: 12, alignItems: "center" },
  btnText: { fontSize: 11, fontWeight: "700", letterSpacing: 2 },
});
