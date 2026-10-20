// "Why not today?" sheet shown before a quest is refused. The reason is required (1-200 characters).
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Sheet } from "@/components/quests/Sheet";
import { Button } from "@/components/ui/Button";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { normalizeReason } from "@/lib/game/adherence";
import { REFUSAL_RULE } from "@/lib/game/guards";

export { REFUSAL_RULE };

interface Props {
  visible: boolean;
  questTitle: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function RefuseSheet({ visible, questTitle, busy, onCancel, onConfirm }: Props) {
  const colors = useColors();
  const [reason, setReason] = useState("");
  const valid = normalizeReason(reason) !== null;

  useEffect(() => {
    if (visible) setReason("");
  }, [visible]);

  return (
    <Sheet
      visible={visible}
      title="Why not today?"
      onClose={onCancel}
      locked={busy}
      footer={
        <View style={s.row}>
          <Button label="Cancel" variant="text" onPress={onCancel} disabled={busy} />
          <Button
            label={busy ? "Sending" : "Refuse"}
            variant="destructive"
            onPress={() => onConfirm(reason.trim())}
            disabled={!valid}
            loading={busy}
            style={s.grow}
            accessibilityLabel="Refuse"
          />
        </View>
      }
    >
      <Text style={[type.body, { color: colors.mutedForeground }]} numberOfLines={2}>
        {questTitle}
      </Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Required. One word is enough."
        placeholderTextColor={colors.subtle}
        maxLength={200}
        multiline
        editable={!busy}
        accessibilityLabel="Reason"
        style={[type.body, s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
      />
      <Text style={[type.meta, { color: colors.mutedForeground }]}>{REFUSAL_RULE}</Text>
    </Sheet>
  );
}

const s = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 4, minHeight: 96, padding: space.sm + 4, textAlignVertical: "top", marginTop: space.sm },
  row: { flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "flex-end" },
  grow: { flex: 1 },
});
