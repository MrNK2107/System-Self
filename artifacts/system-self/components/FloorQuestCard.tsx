// Offered right after a BODY quest is refused: a short bodyweight routine to do now. Not a quest; the session
// is logged as an ordinary BODY log from the floor screen.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FloorRoutineDto } from "@workspace/contracts";
import { useColors } from "@/hooks/useColors";
import { floorHeader } from "@/lib/game/adherence";

interface Props {
  routine: FloorRoutineDto;
  /** The deferred quest the Shadow took, when there is one. */
  shadowLine?: string | null;
  onStart: () => void;
  onDismiss: () => void;
}

export function FloorQuestCard({ routine, shadowLine, onStart, onDismiss }: Props) {
  const colors = useColors();
  return (
    <View style={[styles.card, { borderColor: colors.primary + "60", backgroundColor: colors.card }]}>
      <Text style={[styles.header, { color: colors.primary }]}>{floorHeader(routine.minutes)}</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>{routine.title}</Text>
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>
        {routine.steps.filter((s) => s.name !== "Rest").length} moves. No equipment.
      </Text>
      {shadowLine ? <Text style={[styles.shadow, { color: colors.destructive }]}>{shadowLine}</Text> : null}
      <View style={styles.row}>
        <Pressable
          style={[styles.btn, { borderColor: colors.border }]}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Text style={[styles.btnText, { color: colors.mutedForeground }]}>NOT NOW</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, { borderColor: colors.primary + "80", backgroundColor: colors.primary + "18" }]}
          onPress={onStart}
          accessibilityRole="button"
          accessibilityLabel="Start floor session"
        >
          <Text style={[styles.btnText, { color: colors.primary }]}>START</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: 16, gap: 8 },
  header: { fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  title: { fontSize: 15, fontWeight: "700", letterSpacing: 1 },
  meta: { fontSize: 11 },
  shadow: { fontSize: 11, fontWeight: "600", lineHeight: 16 },
  row: { flexDirection: "row", gap: 8, marginTop: 4 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 2, paddingVertical: 11, alignItems: "center" },
  btnText: { fontSize: 10, fontWeight: "700", letterSpacing: 2 },
});
