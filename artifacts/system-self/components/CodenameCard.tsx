// The user's own public codename with a share action. Semi-public and anonymous players can only be found by it.
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { codenameShareMessage, codenameShareOptions } from "@/lib/social/social";

/** Opens the system share sheet (no clipboard module in this build). Cancelling is not an error. */
export async function shareCodename(codename: string): Promise<void> {
  try {
    await Share.share({ message: codenameShareMessage(codename) });
  } catch {
    // The share sheet could not open: nothing else to do.
  }
}

/** A single row: "Your codename", the codename, and a share button when sharing makes sense. */
export function CodenameCard({ codename, identity }: { codename: string; identity?: "anonymous" | "semi-public" | "public" }) {
  const colors = useColors();
  const { canShare, note } = codenameShareOptions(identity);
  return (
    <View style={[s.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={s.text}>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>Your codename</Text>
        <Text style={[type.bodyStrong, { color: colors.foreground }]} selectable>
          {codename}
        </Text>
        {note ? <Text style={[type.meta, { color: colors.mutedForeground }]}>{note}</Text> : null}
      </View>
      {canShare ? (
        <Pressable
          onPress={() => void shareCodename(codename)}
          accessibilityRole="button"
          accessibilityLabel="Share your codename"
          android_ripple={{ color: "rgba(168,121,255,0.2)", borderless: true, radius: 24 }}
          style={s.share}
        >
          <Feather name="share-2" size={20} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: space.md, borderWidth: 1, borderRadius: 4, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.sm },
  text: { flex: 1, gap: 2 },
  share: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
});
