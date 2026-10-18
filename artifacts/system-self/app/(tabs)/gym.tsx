import React, { useMemo, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useGym } from "@/features/gym/context/GymContext";
import { PlanEditor } from "@/features/gym/components/PlanEditor";
import type { PlanDraft } from "@/lib/game/gym";
import { planBlocksFor } from "@/lib/game/gym";

type TabKey = "plans" | "today" | "history" | "prs";

const NO_PLAN_TODAY = "No session planned today. Pick a day or log a free session.";
const SYNC_PENDING_START = "Sync pending. Reconnect to start a session.";
const SYNC_PENDING_COMPLETE = "Sync pending. Reconnect to complete the session.";
const MONO = "SpaceMono";

export default function GymScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    loading,
    loadFailed,
    refresh,
    exercises,
    workoutPlans,
    activePlanId,
    workoutSessions,
    personalRecords,
    bodyPartScores,
    lastPrEvents,
    lastCompletion,
    unsyncedSets,
    createWorkoutPlan,
    updateWorkoutPlan,
    startWorkoutSession,
    logPerformedSet,
    completeWorkoutSession,
  } = useGym();
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [reps, setReps] = useState("5");
  const [weight, setWeight] = useState("40");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const plan = workoutPlans.find((p) => p.id === activePlanId) ?? workoutPlans[0];
  const todayBlocks = useMemo(() => planBlocksFor(plan, new Date()), [plan]);

  const exById = useMemo(() => Object.fromEntries(exercises.map((x) => [x.id, x])), [exercises]);
  const activeSession = workoutSessions.find((s) => s.id === activeSessionId);

  const startSession = async () => {
    if (working) return;
    setWorking(true);
    setMessage(null);
    try {
      const r = await startWorkoutSession(plan?.id);
      if (r.ok) setActiveSessionId(r.value.id);
      else setMessage(r.reason === "sync_pending" ? SYNC_PENDING_START : "The session could not be started. Try again.");
    } finally {
      setWorking(false);
    }
  };

  const addSet = async (exerciseId: string) => {
    if (!activeSessionId) return;
    await logPerformedSet(activeSessionId, {
      exerciseId,
      reps: Math.min(200, Math.max(1, Math.round(Number(reps)) || 1)),
      weight: Math.min(1000, Math.max(0, Number(weight) || 0)),
      completed: true,
    });
  };

  const finishSession = async () => {
    if (!activeSessionId || working) return;
    setWorking(true);
    setMessage(null);
    try {
      const r = await completeWorkoutSession(activeSessionId);
      if (r.ok) {
        setActiveSessionId(null);
        setMessage(
          r.value.points > 0
            ? `Session recorded. BODY +${r.value.points.toFixed(1)}.`
            : "Session recorded. 0 points: no planned set was finished.",
        );
      } else if (r.reason === "already_completed") {
        setActiveSessionId(null);
        setMessage("This session was already recorded.");
      } else {
        setMessage(r.reason === "sync_pending" ? SYNC_PENDING_COMPLETE : "The session could not be completed. Try again.");
      }
    } finally {
      setWorking(false);
    }
  };

  const savePlan = async (draft: PlanDraft) => {
    setSaving(true);
    setEditorError(null);
    try {
      const r = await createWorkoutPlan(draft);
      if (r.ok) setEditing(false);
      else setEditorError(r.message ?? "The plan could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Loading gym data.</Text>
      </View>
    );
  }

  if (loadFailed) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>The gym data could not be loaded.</Text>
        <TouchableOpacity onPress={() => void refresh()} style={{ marginTop: 10 }}>
          <Text style={{ color: colors.primary, letterSpacing: 1 }}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const freeSession = !!activeSession && todayBlocks.length === 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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

        {activeTab === "plans" &&
          (editing ? (
            <PlanEditor
              exercises={exercises}
              saving={saving}
              error={editorError}
              onSave={(d) => void savePlan(d)}
              onCancel={() => {
                setEditing(false);
                setEditorError(null);
              }}
            />
          ) : (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Weekly Plans</Text>
              {workoutPlans.map((p) => (
                <View key={p.id} style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontWeight: "700" }}>{p.name}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                      {p.goal ? `${p.goal} | ` : ""}
                      {p.days.map((d) => d.weekday).join(" ") || "no days"}
                    </Text>
                  </View>
                  {p.id === (plan?.id ?? null) ? (
                    <Text style={{ color: colors.primary, fontSize: 11 }}>ACTIVE</Text>
                  ) : (
                    <TouchableOpacity onPress={() => void updateWorkoutPlan(p.id, { isActive: true })}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>SET ACTIVE</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {workoutPlans.length === 0 && <Text style={{ color: colors.mutedForeground }}>No plans yet.</Text>}
              <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => setEditing(true)}>
                <Feather name="plus" size={14} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground }}>Create plan</Text>
              </TouchableOpacity>
            </View>
          ))}

        {activeTab === "today" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Today Workout</Text>
              {!activeSession ? (
                <TouchableOpacity onPress={() => void startSession()} disabled={working}>
                  <Text style={{ color: colors.primary, opacity: working ? 0.5 : 1 }}>
                    {todayBlocks.length === 0 ? "Start Free Session" : "Start Session"}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => void finishSession()} disabled={working}>
                  <Text style={{ color: "#4B8B6F", opacity: working ? 0.5 : 1 }}>Complete</Text>
                </TouchableOpacity>
              )}
            </View>

            {message && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{message}</Text>}
            {unsyncedSets > 0 && (
              <Text style={{ color: "#C4873A", fontSize: 12 }}>
                {unsyncedSets} {unsyncedSets === 1 ? "set" : "sets"} waiting to sync.
              </Text>
            )}

            {!activeSession && lastCompletion && lastCompletion.newPrs.length > 0 &&
              lastCompletion.newPrs.map((p) => (
                <View key={`${p.exerciseId}-${p.achievedAt}`} style={[styles.block, { borderColor: "#C4873A" }]}>
                  <Text style={{ color: "#C4873A", fontSize: 11, letterSpacing: 1 }}>NEW PR</Text>
                  <Text style={{ color: colors.foreground, fontWeight: "700" }}>{p.name}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: MONO }}>
                    {p.weight} x {p.reps} | est 1RM {p.value}
                    {p.previous !== null ? ` (was ${p.previous})` : ""}
                  </Text>
                </View>
              ))}

            {activeSession && (
              <View style={styles.inlineInputs}>
                <TextInput
                  value={reps}
                  onChangeText={setReps}
                  keyboardType="number-pad"
                  style={[styles.input, { borderColor: colors.border, color: colors.foreground, fontFamily: MONO }]}
                  placeholder="Reps"
                  placeholderTextColor={colors.mutedForeground}
                />
                <TextInput
                  value={weight}
                  onChangeText={setWeight}
                  keyboardType="decimal-pad"
                  style={[styles.input, { borderColor: colors.border, color: colors.foreground, fontFamily: MONO }]}
                  placeholder="Weight"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            )}

            {todayBlocks.length === 0 && <Text style={{ color: colors.mutedForeground }}>{NO_PLAN_TODAY}</Text>}

            {todayBlocks.map((block) => {
              const ex = exById[block.exerciseId];
              const done = activeSession?.performed.filter((x) => x.exerciseId === block.exerciseId && x.completed).length ?? 0;
              return (
                <View key={`${block.exerciseId}-${block.repRange}`} style={[styles.block, { borderColor: colors.border }]}>
                  <View style={styles.rowBetween}>
                    <Text style={{ color: colors.foreground, fontWeight: "700" }}>{ex?.name ?? block.exerciseId}</Text>
                    <Text style={{ color: colors.mutedForeground, fontFamily: MONO }}>{done}/{block.sets} sets</Text>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {block.sets} x {block.repRange} | rest {block.restSec}s
                  </Text>
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: colors.border }]}
                    onPress={() => void addSet(block.exerciseId)}
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

            {freeSession && (
              <View style={{ gap: 6 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  Free session: tap an exercise to log a set. A free session scores 0 points.
                </Text>
                <View style={styles.chips}>
                  {exercises.map((e) => (
                    <TouchableOpacity
                      key={e.id}
                      style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.card }]}
                      onPress={() => void addSet(e.id)}
                    >
                      <Text style={{ color: colors.foreground, fontSize: 11 }}>
                        {e.name} ({activeSession?.performed.filter((x) => x.exerciseId === e.id).length ?? 0})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {activeTab === "history" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Session History</Text>
            {workoutSessions.slice().reverse().map((s) => (
              <View key={s.id} style={[styles.block, { borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground }}>{new Date(s.date).toLocaleDateString()}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {s.completedAt ? `Completed | BODY +${s.points.toFixed(1)}` : "In progress"}
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
                <Text style={{ color: "#C4873A", fontFamily: MONO }}>{pr.weight} x {pr.reps} (1RM {pr.value})</Text>
              </View>
            ))}
            {personalRecords.length === 0 && <Text style={{ color: colors.mutedForeground }}>No PRs yet.</Text>}

            <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 14 }]}>Latest PR Events</Text>
            {lastPrEvents.map((evt) => (
              <Text key={`${evt.exerciseId}-${evt.achievedAt}`} style={{ color: "#4B8B6F", fontSize: 12 }}>
                NEW PR: {evt.exerciseName} | est 1RM {evt.value}
              </Text>
            ))}
            {lastPrEvents.length === 0 && <Text style={{ color: colors.mutedForeground }}>None this session.</Text>}

            <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 14 }]}>Body Part Points</Text>
            {bodyPartScores.map((s) => (
              <View key={s.bodyPart} style={styles.rowBetween}>
                <Text style={{ color: colors.mutedForeground }}>{s.bodyPart}</Text>
                <Text style={{ color: colors.foreground, fontFamily: MONO }}>{s.pointsTotal.toFixed(1)}</Text>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  title: { fontSize: 18, letterSpacing: 2, fontWeight: "700" },
  subtitle: { fontSize: 12, marginBottom: 4 },
  tabs: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tab: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 7 },
  card: { borderWidth: 1, borderRadius: 4, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  actionBtn: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", gap: 8, alignItems: "center" },
  block: { borderWidth: 1, borderRadius: 4, padding: 10, gap: 6 },
  inlineInputs: { flexDirection: "row", gap: 8 },
  input: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8, flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 7 },
});
