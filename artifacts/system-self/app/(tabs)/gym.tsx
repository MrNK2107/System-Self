import React, { useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useGym } from "@/features/gym/context/GymContext";
import { getPlanDayForDate } from "@/features/gym/services/planService";

type TabKey = "plans" | "today" | "history" | "prs";

export default function GymScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    loading,
    exercises,
    workoutPlans,
    workoutSessions,
    personalRecords,
    bodyPartScores,
    lastPrEvents,
    createWorkoutPlan,
    startWorkoutSession,
    logPerformedSet,
    completeWorkoutSession,
  } = useGym();
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [reps, setReps] = useState("5");
  const [weight, setWeight] = useState("40");

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const plan = workoutPlans[0];
  const todayBlocks = useMemo(() => {
    if (!plan) return [];
    return getPlanDayForDate(plan, new Date().toISOString())?.blocks ?? [];
  }, [plan]);

  const exById = useMemo(() => Object.fromEntries(exercises.map((x) => [x.id, x])), [exercises]);
  const activeSession = workoutSessions.find((s) => s.id === activeSessionId);

  const startSession = async () => {
    const s = await startWorkoutSession(plan?.id);
    setActiveSessionId(s.id);
  };

  const addSet = async (exerciseId: string) => {
    if (!activeSessionId) return;
    await logPerformedSet(activeSessionId, {
      exerciseId,
      reps: Math.max(1, Number(reps) || 1),
      weight: Math.max(0, Number(weight) || 0),
      completed: true,
    });
  };

  const finishSession = async () => {
    if (!activeSessionId) return;
    await completeWorkoutSession(activeSessionId);
    setActiveSessionId(null);
  };

  const createStarterPlan = async () => {
    const now = Date.now().toString();
    await createWorkoutPlan({
      name: `Custom ${now.slice(-4)}`,
      goal: "Custom split",
      days: [],
    });
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Loading gym data...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>GYM</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Plans, workouts, BODY points, and Big-5 PR tracking
        </Text>

        <View style={styles.tabs}>
          {(["plans", "today", "history", "prs"] as TabKey[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.tab,
                {
                  borderColor: activeTab === tab ? colors.primary : colors.border,
                  backgroundColor: activeTab === tab ? colors.primary + "20" : colors.card,
                },
              ]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={{ color: activeTab === tab ? colors.primary : colors.mutedForeground, fontSize: 11 }}>
                {tab.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === "plans" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Weekly Plans</Text>
            {workoutPlans.map((p) => (
              <View key={p.id} style={styles.rowBetween}>
                <View>
                  <Text style={{ color: colors.foreground, fontWeight: "700" }}>{p.name}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{p.goal}</Text>
                </View>
                <Text style={{ color: colors.primary, fontSize: 11 }}>{p.days.length} days</Text>
              </View>
            ))}
            <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={createStarterPlan}>
              <Feather name="plus" size={14} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground }}>Create plan</Text>
            </TouchableOpacity>
          </View>
        )}

        {activeTab === "today" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Today Workout</Text>
              {!activeSession ? (
                <TouchableOpacity onPress={startSession}>
                  <Text style={{ color: colors.primary }}>Start Session</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={finishSession}>
                  <Text style={{ color: "#4B8B6F" }}>Complete</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.inlineInputs}>
              <TextInput
                value={reps}
                onChangeText={setReps}
                keyboardType="number-pad"
                style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
                placeholder="Reps"
                placeholderTextColor={colors.mutedForeground}
              />
              <TextInput
                value={weight}
                onChangeText={setWeight}
                keyboardType="decimal-pad"
                style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
                placeholder="Weight"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>

            {todayBlocks.length === 0 && (
              <Text style={{ color: colors.mutedForeground }}>No plan for today. Start ad-hoc session anyway.</Text>
            )}
            {todayBlocks.map((block) => {
              const ex = exById[block.exerciseId];
              const done = activeSession?.performed.filter((x) => x.exerciseId === block.exerciseId && x.completed).length ?? 0;
              return (
                <View key={`${block.exerciseId}-${block.repRange}`} style={[styles.block, { borderColor: colors.border }]}>
                  <View style={styles.rowBetween}>
                    <Text style={{ color: colors.foreground, fontWeight: "700" }}>{ex?.name ?? block.exerciseId}</Text>
                    <Text style={{ color: colors.mutedForeground }}>{done}/{block.sets} sets</Text>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {block.sets} x {block.repRange} | rest {block.restSec}s
                  </Text>
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: colors.border }]}
                    onPress={() => addSet(block.exerciseId)}
                    disabled={!activeSession}
                  >
                    <Feather name="check" size={12} color={colors.mutedForeground} />
                    <Text style={{ color: colors.mutedForeground }}>
                      {activeSession ? "Log completed set" : "Start session first"}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {activeTab === "history" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Session History</Text>
            {workoutSessions.slice().reverse().map((s) => (
              <View key={s.id} style={[styles.block, { borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground }}>
                  {new Date(s.date).toLocaleDateString()} | {s.performed.length} sets
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {s.completedAt ? "Completed" : "In progress"}
                </Text>
              </View>
            ))}
            {workoutSessions.length === 0 && <Text style={{ color: colors.mutedForeground }}>No sessions yet.</Text>}
          </View>
        )}

        {activeTab === "prs" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Big-5 PRs</Text>
            {personalRecords.map((pr) => (
              <View key={pr.exerciseId} style={styles.rowBetween}>
                <Text style={{ color: colors.foreground }}>{exById[pr.exerciseId]?.name ?? pr.exerciseId}</Text>
                <Text style={{ color: "#C4873A" }}>{pr.weight} x {pr.reps} (1RM {pr.value})</Text>
              </View>
            ))}
            {personalRecords.length === 0 && <Text style={{ color: colors.mutedForeground }}>No PRs yet.</Text>}

            <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 14 }]}>Latest PR Events</Text>
            {lastPrEvents.map((evt) => (
              <Text key={`${evt.exerciseId}-${evt.achievedAt}`} style={{ color: "#4B8B6F", fontSize: 12 }}>
                NEW PR: {evt.exerciseName} | est 1RM {evt.value}
              </Text>
            ))}

            <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 14 }]}>Body Part Points</Text>
            {bodyPartScores.map((s) => (
              <View key={s.bodyPart} style={styles.rowBetween}>
                <Text style={{ color: colors.mutedForeground }}>{s.bodyPart}</Text>
                <Text style={{ color: colors.foreground }}>{s.pointsTotal.toFixed(1)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 16, gap: 12 },
  title: { fontSize: 18, letterSpacing: 2, fontWeight: "700" },
  subtitle: { fontSize: 12, marginBottom: 4 },
  tabs: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tab: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 7 },
  card: { borderWidth: 1, borderRadius: 6, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actionBtn: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", gap: 8, alignItems: "center" },
  block: { borderWidth: 1, borderRadius: 4, padding: 10, gap: 6 },
  inlineInputs: { flexDirection: "row", gap: 8 },
  input: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8, flex: 1 },
});

