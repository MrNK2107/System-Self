// Offered with a comeback notice (after a long gap, or for someone who has never trained at the gym): start on
// the home path. Soft by design: it only changes which BODY quests are generated, the gym stays open.
// Onboarding offers the same choice as the START AT HOME FIRST toggle on the assessment screen.
import React, { useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
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
      <View style={[styles.overlay, { backgroundColor: colors.background + "F2" }]}>
        <SystemWindow title="YOU RETURNED" style={styles.window} solid>
          <Text style={[type.title, { color: colors.foreground }]}>{line}</Text>
          <Text style={[type.body, { color: colors.mutedForeground }]}>
            {gapDays} empty days. Start at home: your BODY quests become home sessions, no equipment. Six of them clear
            Tier I. The gym stays open to you the whole time, and every session you log there still counts.
          </Text>
          {failed ? (
            <Text style={[type.body, { color: colors.destructive }]} accessibilityLiveRegion="polite">
              Not sent. Queued logs have to land first. Try again.
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button label="Start at home" onPress={() => void accept()} loading={busy} block />
            <Button label="Not now" variant="text" onPress={onDone} disabled={busy} style={styles.center} />
          </View>
        </SystemWindow>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  window: { width: "100%", gap: space.md },
  actions: { gap: space.xs, marginTop: space.sm },
  center: { alignSelf: "center" },
});
