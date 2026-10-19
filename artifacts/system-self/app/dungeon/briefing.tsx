// Dungeon Briefing: today's route through the gym, with a one-line how-to and a fallback for every exercise.
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useBriefing } from "@/hooks/useDungeon";
import { briefingHeader, briefingRowMeta, fallbackLine } from "@/lib/game/dungeon";

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export default function DungeonBriefingScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const q = useBriefing(typeof date === "string" && DATE_PARAM.test(date) ? date : undefined);
  const briefing = q.data;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24 }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        {briefing ? (
          <>
            <Text style={[styles.header, { color: colors.primary }]}>{briefingHeader(briefing.date)}</Text>
            <Text style={[styles.intro, { color: colors.foreground }]}>
              {briefing.source === "plan"
                ? "The route is set. Enter in order."
                : "No session is planned for today. This is the entry route. Four exercises, nothing exotic."}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {`${briefing.blocks.length} EXERCISES · ~${briefing.estimatedMinutes} MIN`}
            </Text>
            {briefing.blocks.map((b, i) => {
              const line = fallbackLine(b);
              return (
                <View key={`${b.exerciseId}-${i}`} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <Text style={[styles.name, { color: colors.foreground }]}>{`${i + 1}. ${b.name}`}</Text>
                  <Text style={[styles.sets, { color: colors.primary }]}>{briefingRowMeta(b)}</Text>
                  {b.howTo ? <Text style={[styles.how, { color: colors.mutedForeground }]}>{b.howTo}</Text> : null}
                  {line ? <Text style={[styles.fallback, { color: colors.foreground }]}>{line}</Text> : null}
                </View>
              );
            })}
            <Pressable
              style={[styles.btn, { borderColor: colors.primary + "80", backgroundColor: colors.accentFill + "18" }]}
              onPress={() => router.replace("/(tabs)/gym")}
              accessibilityRole="button"
              accessibilityLabel="Enter the gym"
            >
              <Text style={[styles.btnText, { color: colors.primary }]}>ENTER</Text>
            </Pressable>
          </>
        ) : q.isError ? (
          <>
            <Text style={[styles.header, { color: colors.destructive }]}>BRIEFING UNAVAILABLE</Text>
            <Text style={[styles.intro, { color: colors.mutedForeground }]}>The System could not reach the dungeon map.</Text>
            <Pressable onPress={() => void q.refetch()} accessibilityRole="button">
              <Text style={[styles.link, { color: colors.primary }]}>RETRY</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.backWrap}>
          <Text style={[styles.link, { color: colors.mutedForeground }]}>BACK</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  scroll: { gap: 12 },
  header: { fontSize: 12, fontWeight: "800", letterSpacing: 2 },
  intro: { fontSize: 13, lineHeight: 19 },
  meta: { fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  row: { borderWidth: 1, borderRadius: 4, padding: 14, gap: 6 },
  name: { fontSize: 15, fontWeight: "700" },
  sets: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  how: { fontSize: 12, lineHeight: 17 },
  fallback: { fontSize: 12, fontWeight: "600" },
  btn: { borderWidth: 1, borderRadius: 2, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  btnText: { fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  link: { fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  backWrap: { alignSelf: "center", padding: 12 },
});
