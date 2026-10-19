// "Report a player" sheet. The reason is required (1-500 characters) and goes to admin review.
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { REPORT_REASON_MAX, normalizeReportReason } from "@/lib/social/social";

interface Props {
  visible: boolean;
  handle: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function ReportSheet({ visible, handle, busy, error, onCancel, onConfirm }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");
  const clean = normalizeReportReason(reason);

  useEffect(() => {
    if (visible) setReason("");
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="padding" style={s.fill}>
        <Pressable style={s.backdrop} onPress={busy ? undefined : onCancel} />
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
          <Text style={[s.label, { color: colors.destructive }]}>REPORT PLAYER</Text>
          <Text style={[s.who, { color: colors.foreground }]} numberOfLines={1}>
            {handle}
          </Text>
          <Text style={[s.ask, { color: colors.foreground }]}>What happened?</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Required. Reports are reviewed."
            placeholderTextColor={colors.mutedForeground}
            maxLength={REPORT_REASON_MAX}
            multiline
            editable={!busy}
            accessibilityLabel="Report reason"
            style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          {error ? (
            <Text style={[s.error, { color: colors.destructive }]} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <View style={s.row}>
            <Pressable style={[s.btn, { borderColor: colors.border }]} onPress={onCancel} disabled={busy} accessibilityRole="button">
              <Text style={[s.btnText, { color: colors.mutedForeground }]}>CANCEL</Text>
            </Pressable>
            <Pressable
              style={[s.btn, { borderColor: colors.destructive + "80", backgroundColor: colors.destructive + "15", opacity: busy || !clean ? 0.5 : 1 }]}
              onPress={() => clean && onConfirm(clean)}
              disabled={busy || !clean}
              accessibilityRole="button"
            >
              <Text style={[s.btnText, { color: colors.destructive }]}>{busy ? "SENDING" : "REPORT"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { borderTopWidth: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4, padding: 20, gap: 10 },
  label: { fontSize: 9, fontWeight: "800", letterSpacing: 3 },
  who: { fontSize: 13, fontWeight: "600", lineHeight: 19 },
  ask: { fontSize: 14, fontWeight: "700", marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 2, minHeight: 80, padding: 10, fontSize: 13, textAlignVertical: "top" },
  error: { fontSize: 11, lineHeight: 17 },
  row: { flexDirection: "row", gap: 8, marginTop: 6 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 2, paddingVertical: 11, alignItems: "center" },
  btnText: { fontSize: 10, fontWeight: "700", letterSpacing: 2 },
});
