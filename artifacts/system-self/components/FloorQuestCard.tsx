// Offered right after a BODY quest is refused: a short bodyweight routine to do now. Not a quest; the session
// is logged as an ordinary BODY log from the floor screen.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { FloorRoutineDto } from "@workspace/contracts";
import { Button } from "@/components/ui/Button";
import { space, type } from "@/constants/type";
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
  const moves = routine.steps.filter((s) => s.name !== "Rest").length;
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.head}>
        <Text style={[type.bodyStrong, { color: colors.foreground }]}>{floorHeader(routine.minutes)}</Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          {routine.title} · {moves} moves · no equipment
        </Text>
      </View>
      {shadowLine ? <Text style={[type.meta, { color: colors.destructive }]}>{shadowLine}</Text> : null}
      <Button label="Start" onPress={onStart} block accessibilityLabel="Start floor session" />
      <Button label="Not now" variant="text" onPress={onDismiss} style={styles.center} accessibilityLabel="Dismiss" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: space.md, gap: space.sm },
  head: { gap: 2, marginBottom: space.xs },
  center: { alignSelf: "center" },
});
