// Dungeon Briefing: today's route through the gym, with a one-line how-to and a fallback for every exercise.
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { useBriefing } from "@/hooks/useDungeon";
import { useColors } from "@/hooks/useColors";
import { briefingHeader, briefingRowMeta, fallbackLine } from "@/lib/game/dungeon";

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export default function DungeonBriefingScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const router = useRouter();
  const colors = useColors();
  const q = useBriefing(typeof date === "string" && DATE_PARAM.test(date) ? date : undefined);
  const briefing = q.data;

  return (
    <Screen title="Briefing" back>
      {briefing ? (
        <>
          <SystemWindow title={briefingHeader(briefing.date)}>
            <Text style={[type.title, s.center, { color: colors.foreground }]}>
              {briefing.source === "plan"
                ? "The route is set. Enter in order."
                : "No session is planned for today. This is the entry route. Four exercises, nothing exotic."}
            </Text>
            <Text style={[type.meta, s.center, { color: colors.mutedForeground }]}>
              {`${briefing.blocks.length} exercises · about ${briefing.estimatedMinutes} min`}
            </Text>
          </SystemWindow>

          <View style={s.flush}>
            {briefing.blocks.map((b, i) => {
              const line = fallbackLine(b);
              return (
                <View key={`${b.exerciseId}-${i}`} style={[s.row, { borderBottomColor: colors.border }]}>
                  <Text style={[type.label, s.num, { color: colors.primary }]}>{i + 1}</Text>
                  <View style={s.rowText}>
                    <Text style={[type.bodyStrong, { color: colors.foreground }]}>{b.name}</Text>
                    <Text style={[type.meta, { color: colors.mutedForeground }]}>{briefingRowMeta(b)}</Text>
                    {b.howTo ? <Text style={[type.meta, { color: colors.mutedForeground }]}>{b.howTo}</Text> : null}
                    {line ? <Text style={[type.meta, { color: colors.foreground }]}>{line}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Opened from the gym: pop back to it. Opened from Quests/Today: replace this screen with the gym. */}
          <Button label="Enter the gym" onPress={() => router.dismissTo("/gym")} block accessibilityLabel="Enter the gym" />
        </>
      ) : q.isError ? (
        <View style={s.empty}>
          <Text style={[type.body, { color: colors.mutedForeground }]}>The System could not reach the dungeon map.</Text>
          <Button label="Retry" variant="tonal" onPress={() => void q.refetch()} />
        </View>
      ) : (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { textAlign: "center" },
  flush: { marginHorizontal: -space.md },
  row: { flexDirection: "row", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm + 4, borderBottomWidth: StyleSheet.hairlineWidth },
  num: { width: 20, paddingTop: 3 },
  rowText: { flex: 1, gap: 2 },
  empty: { gap: space.md, alignItems: "flex-start", paddingVertical: space.lg },
  loading: { marginTop: space.xl },
});
