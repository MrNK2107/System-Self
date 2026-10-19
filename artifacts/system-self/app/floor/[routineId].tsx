// Floor session: a timer through the routine's steps and "LOG IT". Logging queues an ordinary BODY log
// (logType floor_session) in the outbox, so it scores exactly like any other BODY log.
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FLOOR_ROUTINES } from "@workspace/engine";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { floorHeader, floorLogGate, floorLogInput, floorProgress } from "@/lib/game/adherence";

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export default function FloorScreen() {
  // refusedQuestId: set when the routine was offered for a refused quest (then it completes that offer).
  const { routineId, refusedQuestId } = useLocalSearchParams<{ routineId: string; refusedQuestId?: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
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
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>ROUTINE NOT FOUND</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={[styles.link, { color: colors.primary }]}>BACK</Text>
        </Pressable>
      </View>
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
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24 }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={[styles.header, { color: colors.primary }]}>{floorHeader(routine.minutes)}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>{routine.title}</Text>

        <View style={[styles.timerBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.step, { color: colors.foreground }]}>{p.done ? "DONE" : step.name}</Text>
          <Text style={[styles.clock, { color: p.done ? "#4B8B6F" : colors.foreground }]}>{mmss(p.stepRemaining)}</Text>
          <Text style={[styles.total, { color: colors.mutedForeground }]}>{mmss(p.totalRemaining)} LEFT</Text>
        </View>

        <View style={styles.row}>
          {!p.done && (
            <Pressable
              style={[styles.btn, { borderColor: colors.border }]}
              onPress={() => setRunning((r) => !r)}
              accessibilityRole="button"
              accessibilityLabel={running ? "Pause" : "Start"}
            >
              <Text style={[styles.btnText, { color: colors.foreground }]}>
                {running ? "PAUSE" : elapsedMs > 0 ? "RESUME" : "START"}
              </Text>
            </Pressable>
          )}
          <Pressable
            style={[
              styles.btn,
              { borderColor: colors.primary + "80", backgroundColor: colors.accentFill + (p.done ? "30" : "10"), opacity: logged || !gate.unlocked ? 0.5 : 1 },
            ]}
            onPress={() => void logIt()}
            disabled={logged || !gate.unlocked}
            accessibilityRole="button"
            accessibilityLabel="Log it"
          >
            <Text style={[styles.btnText, { color: colors.primary }]}>LOG IT</Text>
          </Pressable>
        </View>
        {logError && <Text style={[styles.note, { color: colors.destructive }]}>{logError}</Text>}
        {!gate.unlocked && (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>LOG IT unlocks in {mmss(gate.remainingSec)}.</Text>
        )}
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          Logged as a BODY session. It scores like any BODY log. It does not cancel the refusal.
        </Text>

        {routine.steps.map((s, i) => (
          <View key={i} style={[styles.stepRow, { borderColor: colors.border, opacity: i < p.stepIndex || p.done ? 0.4 : 1 }]}>
            <Text style={[styles.stepName, { color: i === p.stepIndex && !p.done ? colors.primary : colors.foreground }]}>
              {s.name}
            </Text>
            <Text style={[styles.stepSec, { color: colors.mutedForeground }]}>{s.seconds}s</Text>
          </View>
        ))}

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
  header: { fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  title: { fontSize: 18, fontWeight: "800", letterSpacing: 1 },
  timerBox: { borderWidth: 1, borderRadius: 4, padding: 20, alignItems: "center", gap: 6 },
  step: { fontSize: 13, fontWeight: "700", letterSpacing: 1, textAlign: "center" },
  clock: { fontSize: 48, fontWeight: "900", letterSpacing: 2 },
  total: { fontSize: 10, letterSpacing: 2 },
  row: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 2, paddingVertical: 13, alignItems: "center" },
  btnText: { fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  note: { fontSize: 11, lineHeight: 16 },
  stepRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, paddingVertical: 8 },
  stepName: { fontSize: 12, flex: 1 },
  stepSec: { fontSize: 11 },
  backWrap: { alignItems: "center", paddingVertical: 12 },
  link: { fontSize: 10, fontWeight: "700", letterSpacing: 2 },
});
