// Floor session: a timer through the routine's steps and "LOG IT". Logging queues an ordinary BODY log
// (logType floor_session) in the outbox, so it scores exactly like any other BODY log.
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FLOOR_ROUTINES } from "@workspace/engine";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { floorHeader, floorLogGate, floorLogInput, floorProgress } from "@/lib/game/adherence";

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export default function FloorScreen() {
  // refusedQuestId: set when the routine was offered for a refused quest (then it completes that offer).
  const { routineId, refusedQuestId } = useLocalSearchParams<{ routineId: string; refusedQuestId?: string }>();
  const router = useRouter();
  const colors = useColors();
  const { addLog } = useApp();
  const routine = FLOOR_ROUTINES.find((r) => r.id === routineId);

  // Wall-clock based so the timer stays right when the app is backgrounded.
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const startedAt = useRef<number | null>(null);
  const baseMs = useRef(0);
  const [logged, setLogged] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const t = setInterval(() => setElapsedMs(baseMs.current + Date.now() - startedAt.current!), 250);
    return () => {
      clearInterval(t);
      baseMs.current += Date.now() - startedAt.current!;
    };
  }, [running]);

  if (!routine) {
    return (
      <Screen title="Floor session" back>
        <Text style={[type.body, { color: colors.mutedForeground }]}>Routine not found.</Text>
        <Button label="Back" variant="tonal" onPress={() => router.back()} />
      </Screen>
    );
  }

  const p = floorProgress(routine, elapsedMs / 1000);
  const step = routine.steps[p.stepIndex]!;

  const gate = floorLogGate(routine, elapsedMs / 1000);

  const logIt = async () => {
    if (logged || !gate.unlocked) return;
    setLogged(true);
    setRunning(false);
    setLogError(null);
    let ok = false;
    try {
      await addLog(floorLogInput(routine, typeof refusedQuestId === "string" ? refusedQuestId : undefined));
      ok = true;
      router.replace("/(tabs)/quests");
    } catch {
      setLogError("The log did not reach the System. Try again.");
    } finally {
      // A failed enqueue lets the user try again; after success the screen is leaving.
      if (!ok) setLogged(false);
    }
  };

  return (
    <Screen title={routine.title} back>
      <SystemWindow title="FLOOR">
        <Text style={[type.title, s.center, { color: colors.foreground }]}>{floorHeader(routine.minutes)}</Text>
      </SystemWindow>

      <View style={s.timer} accessibilityLiveRegion="polite">
        <Text style={[type.title, s.center, { color: colors.foreground }]}>{p.done ? "Done" : step.name}</Text>
        <Text style={[type.display, s.center, { color: p.done ? colors.success : colors.foreground }]}>{mmss(p.stepRemaining)}</Text>
        <Text style={[type.meta, s.center, { color: colors.mutedForeground }]}>{`${mmss(p.totalRemaining)} left in the routine`}</Text>
      </View>

      {/* One primary at a time: the timer until LOG IT unlocks, then LOG IT. */}
      <View style={s.actions}>
        {!p.done && (
          <Button
            label={running ? "Pause" : elapsedMs > 0 ? "Resume" : "Start timer"}
            variant={gate.unlocked ? "tonal" : "filled"}
            onPress={() => setRunning((r) => !r)}
            block
            accessibilityLabel={running ? "Pause" : "Start"}
          />
        )}
        <Button
          label="Log it"
          variant={gate.unlocked ? "filled" : "tonal"}
          onPress={() => void logIt()}
          disabled={!gate.unlocked}
          loading={logged}
          block
          accessibilityLabel="Log it"
        />
        {logError && <Text style={[type.meta, { color: colors.destructive }]}>{logError}</Text>}
        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          {!gate.unlocked ? `Log it unlocks in ${mmss(gate.remainingSec)}. ` : ""}
          Logged as a BODY session. It scores like any BODY log. It does not cancel the refusal.
        </Text>
      </View>

      <View style={s.flush}>
        {routine.steps.map((x, i) => {
          const current = i === p.stepIndex && !p.done;
          const past = i < p.stepIndex || p.done;
          return (
            <View key={i} style={[s.stepRow, { borderBottomColor: colors.border, opacity: past ? 0.5 : 1 }]}>
              <Text style={[current ? type.bodyStrong : type.body, s.flex, { color: current ? colors.primary : colors.foreground }]}>{x.name}</Text>
              <Text style={[type.meta, { color: colors.mutedForeground }]}>{`${x.seconds}s`}</Text>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { textAlign: "center" },
  timer: { alignItems: "center", gap: space.sm, paddingVertical: space.md },
  actions: { gap: space.sm },
  flush: { marginHorizontal: -space.md },
  stepRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
});
