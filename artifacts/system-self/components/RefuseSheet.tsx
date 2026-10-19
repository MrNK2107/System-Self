// "Why not today?" sheet shown before a quest is refused. The reason is required (1-200 characters).
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { normalizeReason } from "@/lib/game/adherence";

export const REFUSAL_RULE = "First refusal this week is logged. The second costs 1.5 DISCIPLINE. There is no third.";

interface Props {
  visible: boolean;
  questTitle: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function RefuseSheet({ visible, questTitle, busy, onCancel, onConfirm }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");
  const valid = normalizeReason(reason) !== null;

  useEffect(() => {
    if (visible) setReason("");
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <Text style={[styles.label, { color: colors.destructive }]}>REFUSE OPERATION</Text>
          <Text style={[styles.quest, { color: colors.foreground }]} numberOfLines={2}>
            {questTitle}
          </Text>
          <Text style={[styles.ask, { color: colors.foreground }]}>Why not today?</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Required. One word is enough."
            placeholderTextColor={colors.mutedForeground}
            maxLength={200}
            multiline
            editable={!busy}
            accessibilityLabel="Reason"
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <Text style={[styles.rule, { color: colors.mutedForeground }]}>{REFUSAL_RULE}</Text>
          <View style={styles.row}>
            <Pressable
              style={[styles.btn, { borderColor: colors.border }]}
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, { color: colors.mutedForeground }]}>CANCEL</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { borderColor: colors.destructive + "80", backgroundColor: colors.destructive + "15", opacity: busy || !valid ? 0.5 : 1 }]}
              onPress={() => onConfirm(reason.trim())}
              disabled={busy || !valid}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, { color: colors.destructive }]}>{busy ? "SENDING" : "REFUSE"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { borderTopWidth: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4, padding: 20, gap: 10 },
  label: { fontSize: 9, fontWeight: "800", letterSpacing: 3 },
  quest: { fontSize: 13, fontWeight: "600", lineHeight: 19 },
  ask: { fontSize: 14, fontWeight: "700", marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 2, minHeight: 64, padding: 10, fontSize: 13, textAlignVertical: "top" },
  rule: { fontSize: 11, lineHeight: 17 },
  row: { flexDirection: "row", gap: 8, marginTop: 6 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 2, paddingVertical: 11, alignItems: "center" },
  btnText: { fontSize: 10, fontWeight: "700", letterSpacing: 2 },
});
