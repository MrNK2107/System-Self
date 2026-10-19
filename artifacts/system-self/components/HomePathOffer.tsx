// Offered with a comeback notice (after a long gap, or for someone who has never trained at the gym): start on
// the home path. Soft by design: it only changes which BODY quests are generated, the gym stays open.
// Onboarding offers the same choice as the START AT HOME FIRST toggle on the assessment screen.
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

interface Props {
  gapDays: number;
  line: string;
  /** Called once the choice is made (accepted, declined or dismissed): the notice is then acknowledged. */
  onDone: () => void;
}

export function HomePathOffer({ gapDays, line, onDone }: Props) {
  const colors = useColors();
  const { setHomePath } = useApp();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const r = await setHomePath(true);
    setBusy(false);
    if (r.ok) onDone();
    else setFailed(true); // stays open: the choice is not lost, and NOT NOW still dismisses
  };

  return (
    <Modal transparent animationType="fade" visible statusBarTranslucent onRequestClose={onDone}>
      <View style={[styles.overlay, { backgroundColor: "#070809F2" }]}>
        <View style={[styles.card, { borderColor: colors.primary + "50", backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.primary }]}>YOU RETURNED</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>{line}</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {gapDays} empty days. Start at home: your BODY quests become home sessions, no equipment. Six of them clear
            Tier I. The gym stays open to you the whole time, and every session you log there still counts.
          </Text>
          {failed ? (
            <Text style={[styles.body, { color: colors.destructive }]}>Not sent. Queued logs have to land first. Try again.</Text>
          ) : null}
          <View style={styles.row}>
            <Pressable
              style={[styles.btn, { borderColor: colors.border }]}
              onPress={onDone}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Not now"
            >
              <Text style={[styles.btnText, { color: colors.mutedForeground }]}>NOT NOW</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { borderColor: colors.primary + "80", backgroundColor: colors.primary + "18", opacity: busy ? 0.5 : 1 }]}
              onPress={() => void accept()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Start at home"
            >
              <Text style={[styles.btnText, { color: colors.primary }]}>START AT HOME</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  card: { width: "100%", borderWidth: 1, borderRadius: 4, padding: 20, gap: 14 },
  label: { fontSize: 9, fontWeight: "800", letterSpacing: 3 },
  title: { fontSize: 18, fontWeight: "800", letterSpacing: 1.5 },
  body: { fontSize: 13, lineHeight: 20 },
  row: { flexDirection: "row", gap: 8, marginTop: 4 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 2, paddingVertical: 12, alignItems: "center" },
  btnText: { fontSize: 10, fontWeight: "800", letterSpacing: 2 },
});
