// The user's own public codename with a share action. Semi-public and anonymous players can only be found by it.
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { codenameShareMessage } from "@/lib/social/social";

/** Opens the system share sheet (no clipboard module in this build). Cancelling is not an error. */
export async function shareCodename(codename: string): Promise<void> {
  try {
    await Share.share({ message: codenameShareMessage(codename) });
  } catch {
    // The share sheet could not open: nothing else to do.
  }
}

export function CodenameCard({ codename }: { codename: string }) {
  const colors = useColors();
  return (
    <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={s.text}>
        <Text style={[s.label, { color: colors.mutedForeground }]}>YOUR CODENAME</Text>
        <Text style={[s.value, { color: colors.foreground }]} selectable>
          {codename}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => void shareCodename(codename)}
        accessibilityRole="button"
        accessibilityLabel="Share your codename"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={[s.btn, { borderColor: colors.primary + "60" }]}
      >
        <Feather name="share-2" size={12} color={colors.primary} />
        <Text style={[s.btnText, { color: colors.primary }]}>SHARE</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 4, padding: 12 },
  text: { flex: 1, gap: 3 },
  label: { fontSize: 8, letterSpacing: 2.5, fontWeight: "700" },
  value: { fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 6 },
  btnText: { fontSize: 9, fontWeight: "800", letterSpacing: 2 },
});
