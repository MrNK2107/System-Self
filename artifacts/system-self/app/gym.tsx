// Gym (reached from Status -> BODY). One job: train today. The landing view offers today's planned session (or a free
// one); a running session takes over the screen. Plans, personal records and history sit behind rows, each pushed as
// its own view of this route (?view=...), so the app bar back and Android back both return to the gym.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { CrowdReportSheet } from "@/components/CrowdReportSheet";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { useAuth } from "@/context/AuthContext";
import { NumberStepper } from "@/features/gym/components/Fields";
import { PlanEditor } from "@/features/gym/components/PlanEditor";
import { useGym } from "@/features/gym/context/GymContext";
import { sessionSummary } from "@/features/gym/lib/today";
import { useColors } from "@/hooks/useColors";
import { api } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import { submitCrowdReport, type CrowdLevel } from "@/lib/game/dungeon";
import type { PlanDraft } from "@/lib/game/gym";
import { ABANDONED_SESSION_MESSAGE, planBlocksFor, weekdayOf } from "@/lib/game/gym";
import { quietHoursKey } from "@/lib/game/keys";

type View_ = "home" | "plans" | "new-plan" | "prs" | "history";

const TITLES: Record<View_, string> = {
  home: "Gym",
  plans: "Plans",
  "new-plan": "New plan",
  prs: "Personal records",
  history: "History",
};

const NO_PLAN_TODAY = "No session planned today. Train free, or choose a plan.";
const SYNC_PENDING_START = "Sync pending. Reconnect to start a session.";
const SYNC_PENDING_COMPLETE = "Sync pending. Reconnect to complete the session.";

const asView = (v: string | undefined): View_ => (v && v in TITLES ? (v as View_) : "home");

export default function GymScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>();
  const view = asView(viewParam);
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
    rejectedSets,
    dismissRejectedSets,
    activeSessionId,
    restoredSession,
    restoring,
    discardActiveSession,
    createWorkoutPlan,
    updateWorkoutPlan,
    startWorkoutSession,
    logPerformedSet,
    completeWorkoutSession,
    abandonedNotice,
    dismissAbandonedNotice,
  } = useGym();
  const [reps, setReps] = useState(5);
  const [weight, setWeight] = useState(40);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // The session just completed, while the scout-report sheet is offered for it.
  const [crowdFor, setCrowdFor] = useState<string | null>(null);
  const [crowdBusy, setCrowdBusy] = useState(false);

  const { user } = useAuth();
  const timeZone = user?.timezone;
  const plan = workoutPlans.find((p) => p.id === activePlanId) ?? workoutPlans[0];
  const todayBlocks = useMemo(() => planBlocksFor(plan, new Date(), timeZone), [plan, timeZone]);
  const today = useMemo(() => weekdayOf(new Date(), timeZone), [timeZone]);

  const exById = useMemo(() => Object.fromEntries(exercises.map((x) => [x.id, x])), [exercises]);
  const activeSession = workoutSessions.find((s) => s.id === activeSessionId);
  const open = (v: View_) => router.push({ pathname: "/gym", params: { view: v } });

  const startSession = async () => {
    if (working || restoring) return;
    setWorking(true);
    setMessage(null);
    try {
      const r = await startWorkoutSession(plan?.id);
      if (!r.ok) setMessage(r.reason === "sync_pending" ? SYNC_PENDING_START : "The session could not be started. Try again.");
    } finally {
      setWorking(false);
    }
  };

  const addSet = async (exerciseId: string) => {
    if (!activeSessionId) return;
    await logPerformedSet(activeSessionId, {
      exerciseId,
      reps: Math.min(200, Math.max(1, Math.round(reps) || 1)),
      weight: Math.min(1000, Math.max(0, weight || 0)),
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
        setCrowdFor(r.value.session.id);
        setMessage(
          r.value.points > 0
            ? `Session recorded. BODY +${r.value.points.toFixed(1)}.`
            : "Session recorded. 0 points: no planned set was finished.",
        );
      } else if (r.reason === "already_completed") {
        setMessage("This session was already recorded.");
      } else if (r.reason === "abandoned") {
        // Shown by the abandoned notice.
      } else {
        setMessage(r.reason === "sync_pending" ? SYNC_PENDING_COMPLETE : "The session could not be completed. Try again.");
      }
    } finally {
      setWorking(false);
    }
  };

  const chooseCrowd = async (level: CrowdLevel | null) => {
    const sessionId = crowdFor;
    if (!sessionId || crowdBusy) return;
    if (level === null) {
      setCrowdFor(null);
      return;
    }
    setCrowdBusy(true);
    try {
      const r = await submitCrowdReport(api, getOutbox(), level, sessionId, `crowd-${sessionId}`);
      if (r.ok) void queryClient.invalidateQueries({ queryKey: quietHoursKey(user?.id ?? null) });
      else setMessage("Scout report not sent. Sync pending.");
    } catch {
      setMessage("Scout report not sent. Try again later.");
    } finally {
      setCrowdBusy(false);
      setCrowdFor(null);
    }
  };

  const savePlan = async (draft: PlanDraft) => {
    setSaving(true);
    setEditorError(null);
    try {
      const r = await createWorkoutPlan(draft);
      if (r.ok) router.back();
      else setEditorError(r.message ?? "The plan could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const body = colors.domain.BODY;
  const title = view === "home" && activeSession ? "Session" : TITLES[view];

  if (loading) {
    return (
      <Screen title={title} back>
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[type.body, { color: colors.mutedForeground }]}>Loading gym data.</Text>
        </View>
      </Screen>
    );
  }

  if (loadFailed) {
    return (
      <Screen title={title} back>
        <SystemWindow title="ERROR">
          <Text style={[type.title, { color: colors.foreground }]}>The gym data could not be loaded.</Text>
          <Button label="Retry" onPress={() => void refresh()} />
        </SystemWindow>
      </Screen>
    );
  }

  // --- notices shared by the landing and session views ---------------------------------------------------
  const notices = (
    <>
      {rejectedSets > 0 && (
        <Notice
          color={colors.destructive}
          text={`${rejectedSets} ${rejectedSets === 1 ? "set was" : "sets were"} rejected. Tap to dismiss.`}
          onPress={dismissRejectedSets}
        />
      )}
      {abandonedNotice && <Notice color={colors.warn} text={`${ABANDONED_SESSION_MESSAGE} Tap to dismiss.`} onPress={dismissAbandonedNotice} />}
      {message && <Notice color={colors.mutedForeground} text={message} />}
      {unsyncedSets > 0 && <Notice color={colors.warn} text={`${unsyncedSets} ${unsyncedSets === 1 ? "set" : "sets"} waiting to sync.`} />}
    </>
  );

  // --- sub-views ------------------------------------------------------------------------------------------
  if (view === "new-plan") {
    return (
      <Screen title={title} back>
        <PlanEditor exercises={exercises} saving={saving} error={editorError} onSave={(d) => void savePlan(d)} onCancel={() => router.back()} />
      </Screen>
    );
  }

  if (view === "plans") {
    return (
      <Screen title={title} back>
        <View>
          {workoutPlans.map((p) => {
            const active = p.id === (plan?.id ?? null);
            return (
              <ListRow
                key={p.id}
                title={p.name}
                subtitle={`${p.goal ? `${p.goal} · ` : ""}${p.days.map((d) => d.weekday).join(" ") || "No days"}`}
                dot={active ? body : undefined}
                trailing={
                  active ? (
                    <Text style={[type.label, { color: colors.primary }]}>ACTIVE</Text>
                  ) : (
                    <Button label="Set active" variant="text" onPress={() => void updateWorkoutPlan(p.id, { isActive: true })} />
                  )
                }
              />
            );
          })}
        </View>
        {workoutPlans.length === 0 && <Text style={[type.body, { color: colors.mutedForeground }]}>No plans yet. Build one: days, exercises, sets and reps.</Text>}
        <Button label="Create plan" variant={workoutPlans.length === 0 ? "filled" : "tonal"} block onPress={() => open("new-plan")} />
      </Screen>
    );
  }

  if (view === "history") {
    const sessions = workoutSessions.slice().reverse();
    return (
      <Screen title={title} back>
        {sessions.length === 0 ? (
          <Text style={[type.body, { color: colors.mutedForeground }]}>No sessions yet. Your first one is recorded here.</Text>
        ) : (
          <View>
            {sessions.map((x) => (
              <ListRow
                key={x.id}
                title={new Date(x.date).toLocaleDateString()}
                subtitle={x.completedAt ? `Completed · ${x.performed.length} sets` : "In progress"}
                dot={body}
                trailing={x.completedAt ? <Text style={[type.number, { color: colors.foreground }]}>+{x.points.toFixed(1)}</Text> : undefined}
              />
            ))}
          </View>
        )}
      </Screen>
    );
  }

  if (view === "prs") {
    return (
      <Screen title={title} back>
        <Section label="BIG 5">
          {personalRecords.length === 0 ? (
            <Text style={[type.body, { color: colors.mutedForeground }]}>No records yet. Log a heavy set of a Big 5 lift.</Text>
          ) : (
            personalRecords.map((pr) => (
              <ListRow
                key={pr.exerciseId}
                title={exById[pr.exerciseId]?.name ?? pr.exerciseId}
                subtitle={`Estimated 1RM ${pr.value}`}
                trailing={<Text style={[type.number, { color: colors.foreground }]}>{pr.weight} × {pr.reps}</Text>}
              />
            ))
          )}
        </Section>
        {lastPrEvents.length > 0 && (
          <Section label="LATEST RECORDS">
            {lastPrEvents.map((evt) => (
              <ListRow
                key={`${evt.exerciseId}-${evt.achievedAt}`}
                title={evt.exerciseName}
                subtitle={new Date(evt.achievedAt).toLocaleDateString()}
                trailing={<Text style={[type.number, { color: colors.success }]}>{evt.value}</Text>}
              />
            ))}
          </Section>
        )}
        <Section label="POINTS BY BODY PART">
          {bodyPartScores.length === 0 ? (
            <Text style={[type.body, { color: colors.mutedForeground }]}>No points yet. Complete a planned session.</Text>
          ) : (
            bodyPartScores.map((x) => (
              <ListRow
                key={x.bodyPart}
                title={x.bodyPart.charAt(0).toUpperCase() + x.bodyPart.slice(1)}
                trailing={<Text style={[type.number, { color: colors.foreground }]}>{x.pointsTotal.toFixed(1)}</Text>}
              />
            ))
          )}
        </Section>
      </Screen>
    );
  }

  // --- a running session takes over the landing view -----------------------------------------------------
  if (activeSession) {
    const free = todayBlocks.length === 0;
    const setsFor = (id: string) => activeSession.performed.filter((x) => x.exerciseId === id && x.completed).length;
    return (
      <Screen title={title} back>
        {notices}
        {restoredSession && (
          <SystemWindow title="SESSION RESTORED">
            <Text style={[type.body, { color: colors.foreground }]}>
              Unfinished session found: {activeSession.performed.length} sets logged. Resume it or discard it.
            </Text>
            <Button label="Discard session" variant="text" onPress={() => void discardActiveSession()} />
          </SystemWindow>
        )}

        <View style={s.steppers}>
          <NumberStepper label="REPS" value={reps} min={1} max={200} onChange={setReps} />
          <NumberStepper label="WEIGHT" value={weight} min={0} max={1000} step={2.5} decimal onChange={setWeight} />
        </View>

        <Section label={free ? "FREE SESSION · TAP TO LOG A SET" : "TAP AN EXERCISE TO LOG A SET"}>
          {free
            ? exercises.map((e) => (
                <ListRow
                  key={e.id}
                  title={e.name}
                  subtitle={e.primaryBodyPart}
                  dot={body}
                  accessibilityLabel={`Log a set of ${e.name}`}
                  trailing={<Text style={[type.number, { color: colors.foreground }]}>{activeSession.performed.filter((x) => x.exerciseId === e.id).length}</Text>}
                  onPress={() => void addSet(e.id)}
                />
              ))
            : todayBlocks.map((block) => {
                const name = exById[block.exerciseId]?.name ?? block.exerciseId;
                const done = setsFor(block.exerciseId);
                return (
                  <ListRow
                    key={`${block.exerciseId}-${block.repRange}`}
                    title={name}
                    subtitle={`${block.sets} × ${block.repRange} · rest ${block.restSec} s`}
                    dot={done >= block.sets ? colors.success : body}
                    accessibilityLabel={`Log a set of ${name}, ${done} of ${block.sets} done`}
                    trailing={
                      <Text style={[type.number, { color: done >= block.sets ? colors.success : colors.foreground }]}>
                        {done}/{block.sets}
                      </Text>
                    }
                    onPress={() => void addSet(block.exerciseId)}
                  />
                );
              })}
        </Section>
        {free && <Text style={[type.meta, { color: colors.mutedForeground }]}>A free session scores 0 points. Planned sets score BODY.</Text>}

        <Button label="Complete session" block loading={working} onPress={() => void finishSession()} />
        <CrowdReportSheet visible={crowdFor !== null} busy={crowdBusy} onChoose={(l) => void chooseCrowd(l)} />
      </Screen>
    );
  }

  // --- landing: today's session, then everything else behind rows ----------------------------------------
  const newPrs = lastCompletion?.newPrs ?? [];
  const sessionsDone = workoutSessions.filter((x) => x.completedAt).length;

  return (
    <Screen title={title} back>
      {newPrs.length > 0 && (
        <SystemWindow title="NEW RECORD" frameColor={body}>
          {newPrs.map((p) => (
            <View key={`${p.exerciseId}-${p.achievedAt}`} style={s.pr}>
              <Text style={[type.bodyStrong, { color: colors.foreground }]}>{p.name}</Text>
              <Text style={[type.number, { color: colors.foreground }]}>
                {p.weight} × {p.reps}
              </Text>
              <Text style={[type.meta, { color: colors.mutedForeground }]}>
                Estimated 1RM {p.value}
                {p.previous !== null ? ` (was ${p.previous})` : ""}
              </Text>
            </View>
          ))}
        </SystemWindow>
      )}
      {notices}

      {todayBlocks.length > 0 && plan ? (
        <View style={[s.today, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.todayHead}>
            <Text style={[type.title, { color: colors.foreground }]}>{plan.name}</Text>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>
              {today} · {sessionSummary(todayBlocks)}
            </Text>
          </View>
          <Text style={[type.body, { color: colors.mutedForeground }]} numberOfLines={2}>
            {todayBlocks.map((b) => exById[b.exerciseId]?.name ?? b.exerciseId).join(", ")}
          </Text>
          <Button label="Start session" block loading={working || restoring} onPress={() => void startSession()} />
          <Button label="Briefing" variant="text" onPress={() => router.push("/dungeon/briefing")} accessibilityLabel="Open the dungeon briefing" />
        </View>
      ) : (
        <SystemWindow>
          <Text style={[type.title, { color: colors.foreground }]}>{NO_PLAN_TODAY}</Text>
          <Button label="Start a free session" block loading={working || restoring} onPress={() => void startSession()} />
        </SystemWindow>
      )}

      <View>
        {todayBlocks.length === 0 && (
          <ListRow title="Choose a plan" subtitle={plan ? `${plan.name} has no session on ${today}` : "No plan yet"} chevron onPress={() => open("plans")} />
        )}
        <ListRow
          title="Plans"
          subtitle={plan ? `Active: ${plan.name}` : `${workoutPlans.length} saved`}
          dot={body}
          chevron
          onPress={() => open("plans")}
        />
        <ListRow
          title="Personal records (Big 5)"
          subtitle={personalRecords.length ? `${personalRecords.length} recorded` : "None yet"}
          dot={body}
          chevron
          onPress={() => open("prs")}
        />
        <ListRow
          title="History"
          subtitle={sessionsDone ? `${sessionsDone} ${sessionsDone === 1 ? "session" : "sessions"} completed` : "No sessions yet"}
          dot={body}
          chevron
          onPress={() => open("history")}
        />
      </View>
      <CrowdReportSheet visible={crowdFor !== null} busy={crowdBusy} onChoose={(l) => void chooseCrowd(l)} />
    </Screen>
  );
}

function Notice({ text, color, onPress }: { text: string; color: string; onPress?: () => void }) {
  const line = <Text style={[type.body, { color }]}>{text}</Text>;
  if (!onPress) return line;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" android_ripple={{ color: "rgba(168,121,255,0.12)" }} style={s.notice}>
      {line}
    </Pressable>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={s.section}>
      <Text style={[type.label, { color: colors.mutedForeground }]} accessibilityRole="header">
        {label}
      </Text>
      <View>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: space.sm, paddingVertical: space.xxl },
  today: { borderWidth: 1, borderRadius: 4, padding: space.md, gap: space.md },
  todayHead: { gap: space.xs },
  steppers: { flexDirection: "row", gap: space.md },
  section: { gap: space.sm },
  notice: { minHeight: 48, justifyContent: "center" },
  pr: { gap: 2 },
});
