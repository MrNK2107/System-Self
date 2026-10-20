// "Report a player" sheet. The reason is required (1-500 characters) and goes to admin review.
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Notice, Sheet } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { space, type } from "@/constants/type";
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
  const [reason, setReason] = useState("");
  const clean = normalizeReportReason(reason);

  useEffect(() => {
    if (visible) setReason("");
  }, [visible]);

  return (
    <Sheet visible={visible} title={`Report ${handle}`} onClose={onCancel} dismissable={!busy}>
      <Text style={[type.body, { color: colors.foreground }]}>What happened?</Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Required. Reports are reviewed."
        placeholderTextColor={colors.subtle}
        maxLength={REPORT_REASON_MAX}
        multiline
        editable={!busy}
        accessibilityLabel="Report reason"
        style={[type.body, s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
      />
      {error ? <Notice message={error} /> : null}
      <View style={s.actions}>
        <Button label={busy ? "Sending" : "Report"} variant="destructive" block loading={busy} disabled={!clean} onPress={() => clean && onConfirm(clean)} />
        <Button label="Cancel" variant="text" block disabled={busy} onPress={onCancel} />
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 4, minHeight: 96, padding: space.sm + 4, textAlignVertical: "top" },
  actions: { gap: space.sm },
});
