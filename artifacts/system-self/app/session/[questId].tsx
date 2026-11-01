// Live session (spec 8.2): START, then a timer with movement, steps and place status building up as evidence,
// then END sends a summary and THE SYSTEM's verdict comes back. Raw location and sensor data never leave the phone.
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { fonts, space, type } from "@/constants/type";
import { useApp, type SessionProofResult } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { api } from "@/lib/api/client";
import { questTargetLabel } from "@/lib/game/today";
import { formatElapsed } from "@/lib/session/minutes";
import { fetchNearbyPlaces, savePlace } from "@/lib/session/api";
import {
  addMotion,
  buildSummary,
  clearActiveSession,
  currentPosition,
  loadActiveSession,
  newSession,
  readPoints,
  requestSessionPermissions,
  saveActiveSession,
  startLocation,
  startMotion,
  stopLocation,
  type ActiveSession,
} from "@/lib/session/tracker";
import { distanceM, type KnownPlace } from "@workspace/engine";

type Phase = "ready" | "starting" | "running" | "sending" | "result";

export default function LiveSessionScreen() {
  const { questId } = useLocalSearchParams<{ questId: string }>();
  const router = useRouter();
  const colors = useColors();
  const { quests, submitSession } = useApp();
  const quest = quests.find((q) => q.id === questId) ?? null;
  const kind = quest?.target?.kind === "study" ? "study" : "workout";

  const [phase, setPhase] = useState<Phase>("ready");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<SessionProofResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<ActiveSession | null>(null);
  const stopMotion = useRef<(() => void) | null>(null);

  const update = useCallback((s: ActiveSession) => {
    sessionRef.current = s;
    setSession(s);
  }, []);

  const attachMotion = useCallback(() => {
    stopMotion.current?.();
    let baseSteps = sessionRef.current?.steps ?? 0;
    stopMotion.current = startMotion(
      (x, y, z, at) => {
        if (sessionRef.current) sessionRef.current = addMotion(sessionRef.current, x, y, z, at);
      },
      (steps) => {
        if (sessionRef.current) sessionRef.current = { ...sessionRef.current, steps: baseSteps + steps };
      },
    );
    return () => {
      baseSteps = sessionRef.current?.steps ?? baseSteps;
    };
  }, []);

  // Resume a session left running (app closed or killed while the foreground service kept sampling location).
  useEffect(() => {
    void (async () => {
      const prev = await loadActiveSession();
      if (prev && prev.questId === questId) {
        update(prev);
        attachMotion();
        setPhase("running");
      }
    })();
    return () => stopMotion.current?.();
  }, [questId, update, attachMotion]);

  // Tick the clock, push sensor totals to the screen, and persist every 15 s.
  useEffect(() => {
    if (phase !== "running") return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (sessionRef.current) setSession(sessionRef.current);
    }, 1000);
    const persist = setInterval(() => {
      if (sessionRef.current) void saveActiveSession(sessionRef.current);
      // The latest location fix drives the "AT YOUR GYM" line.
      void readPoints().then((pts) => {
        const last = pts.filter((p) => !p.mocked).at(-1);
        if (last) setHere({ lat: last.lat, lng: last.lng });
      });
    }, 15_000);
    const sub = AppState.addEventListener("change", (st) => {
      if (st !== "active" && sessionRef.current) void saveActiveSession(sessionRef.current);
    });
    return () => {
      clearInterval(tick);
      clearInterval(persist);
      sub.remove();
    };
  }, [phase]);

  const start = async () => {
    if (!quest) return;
    setPhase("starting");
    setError(null);
    const perm = await requestSessionPermissions();
    let places: KnownPlace[] = [];
    const pos = perm.location !== "denied" ? await currentPosition() : null;
    if (pos) {
      setHere(pos);
      places = (await fetchNearbyPlaces(api, pos.lat, pos.lng).catch(() => [])) as KnownPlace[];
    }
    const background = perm.location === "background" ? await startLocation(true, quest.title) : perm.location === "foreground" ? await startLocation(false, quest.title) : false;
    const s = newSession(quest.id, kind, places, background);
    update(s);
    await saveActiveSession(s);
    attachMotion();
    const missing: string[] = [];
    if (perm.location === "denied") missing.push("location is off, so a gym can't be confirmed");
    else if (perm.location === "foreground") missing.push("keep the app open: location stops when the screen is off");
    if (!perm.motion) missing.push("step counting is off");
    setNote(missing.length ? `${missing.join("; ")}.` : null);
    setPhase("running");
  };

  const saveHere = async (placeKind: "gym" | "sports" | "study") => {
    const pos = (await currentPosition()) ?? here;
    if (!pos || !sessionRef.current) {
      setNote("No location fix. Step outside or turn on location, then try again.");
      return;
    }
    try {
      const name = placeKind === "gym" ? "My gym" : placeKind === "sports" ? "My ground" : "My study place";
      const p = (await savePlace(api, { kind: placeKind, name, lat: pos.lat, lng: pos.lng })) as KnownPlace;
      update({ ...sessionRef.current, places: [...sessionRef.current.places, p] });
      setNote(`${name} saved. Sessions here now count.`);
    } catch {
      setNote("THE SYSTEM could not save this place. Try again.");
    }
  };

  const end = async () => {
    const s = sessionRef.current;
    if (!s || !quest) return;
    setPhase("sending");
    stopMotion.current?.();
    await stopLocation();
    const summary = buildSummary(s, await readPoints(), Date.now());
    const r = await submitSession(quest.id, summary);
    if (r.ok) {
      await clearActiveSession();
      setResult(r.value);
      setPhase("result");
    } else {
      await saveActiveSession(s);
      setError(r.reason === "sync_pending" ? "Offline. Your session is saved; end it again when you're back online." : "THE SYSTEM could not judge the session. Try ending it again.");
      setPhase("running");
    }
  };

  if (!quest && phase !== "result") {
    return (
      <Screen title="Session" back>
        <Text style={[type.body, { color: colors.mutedForeground }]}>This quest is no longer active.</Text>
      </Screen>
    );
  }

  const elapsed = session ? now - session.startedAt : 0;
  const nearest = here && session ? nearestPlace(here, session.places, kind) : null;

  return (
    <Screen title={kind === "study" ? "Study session" : "Workout session"} back={phase !== "running" && phase !== "sending"}>
      {quest ? (
        <SystemWindow title={kind === "study" ? "STUDY" : "WORKOUT"}>
          <Text style={[type.title, { color: colors.foreground }]}>{quest.title}</Text>
          <Text style={[type.label, { color: colors.subtle }]}>{questTargetLabel(quest)}</Text>
        </SystemWindow>
      ) : null}

      {phase === "ready" || phase === "starting" ? (
        <View style={s.block}>
          <Text style={[type.body, { color: colors.foreground }]}>
            Start when you begin. THE SYSTEM counts the minutes your phone moves, your steps, and whether you are at a gym or
            ground. Keep the phone on you, or leave it in your locker at the gym.
          </Text>
          <Text style={[type.meta, { color: colors.mutedForeground }]}>
            Location and motion stay on this phone. Only the totals are sent when you end.
          </Text>
          <Button label={phase === "starting" ? "STARTING…" : "START"} onPress={() => void start()} disabled={phase === "starting"} block />
        </View>
      ) : null}

      {(phase === "running" || phase === "sending") && session ? (
        <View style={s.block}>
          <Text style={[s.timer, { color: colors.foreground }]} accessibilityLabel={`Elapsed ${formatElapsed(elapsed)}`}>
            {formatElapsed(elapsed)}
          </Text>
          <View style={s.stats}>
            <Stat label="ACTIVE MIN" value={String(session.movement.activeMinutes)} />
            <Stat label="STEPS" value={session.steps.toLocaleString("en-IN")} />
            <Stat label="TARGET" value={quest?.target ? `${quest.target.value}` : "—"} />
          </View>
          <Text style={[type.label, { color: nearest?.inside ? colors.success : colors.mutedForeground }]}>
            {nearest?.inside
              ? `AT ${(nearest.place.name ?? (nearest.place.kind === "study" ? "A STUDY PLACE" : "A GYM")).toUpperCase()}`
              : session.places.length > 0
                ? "NOT AT A KNOWN PLACE"
                : "NO KNOWN PLACE NEARBY"}
          </Text>
          {!nearest?.inside ? (
            kind === "study" ? (
              <Button label="SAVE THIS PLACE AS MY STUDY PLACE" variant="tonal" onPress={() => void saveHere("study")} block />
            ) : (
              <View style={s.row}>
                <Button label="THIS IS MY GYM" variant="tonal" onPress={() => void saveHere("gym")} />
                <Button label="THIS IS MY GROUND" variant="tonal" onPress={() => void saveHere("sports")} />
              </View>
            )
          ) : null}
          {note ? <Text style={[type.meta, { color: colors.warn }]}>{note}</Text> : null}
          {error ? <Text style={[type.meta, { color: colors.destructive }]}>{error}</Text> : null}
          <Button
            label={phase === "sending" ? "JUDGING…" : "END SESSION"}
            onPress={() => void end()}
            disabled={phase === "sending"}
            variant="destructive"
            block
          />
        </View>
      ) : null}

      {phase === "result" && result ? (
        <View style={s.block}>
          <SystemWindow title={result.proof.status === "accepted" ? (result.completed ? "QUEST COMPLETE" : "SESSION COUNTED") : "NOT PROVEN"}>
            <Text style={[type.title, { color: result.proof.status === "accepted" ? colors.foreground : colors.destructive }]}>
              {result.proof.reason}
            </Text>
            {result.progress ? (
              <Text style={[type.body, { color: colors.mutedForeground }]}>{`${result.progress.done} of ${result.progress.needed} sessions this period.`}</Text>
            ) : null}
            <Text style={[type.meta, { color: colors.mutedForeground }]}>{`Proof: ${result.proof.evidence.join(" · ")}`}</Text>
          </SystemWindow>
          {result.proof.status !== "accepted" ? (
            <Button
              label="TRY AGAIN"
              onPress={() => {
                setResult(null);
                setSession(null);
                setPhase("ready");
              }}
              block
            />
          ) : null}
          <Button label="DONE" variant="text" onPress={() => router.back()} block />
        </View>
      ) : null}
    </Screen>
  );
}

function nearestPlace(here: { lat: number; lng: number }, places: KnownPlace[], kind: "workout" | "study") {
  let best: { place: KnownPlace; inside: boolean; d: number } | null = null;
  for (const p of places) {
    const fits = kind === "workout" ? p.kind !== "study" : p.kind === "study";
    if (!fits) continue;
    const d = distanceM(here, p);
    if (!best || d < best.d) best = { place: p, inside: d <= p.radiusM, d };
  }
  return best;
}

function Stat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={s.stat}>
      <Text style={[type.number, { color: colors.foreground }]}>{value}</Text>
      <Text style={[type.label, { color: colors.subtle }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  block: { gap: space.md, marginTop: space.lg },
  timer: { fontFamily: fonts.displayBold, fontSize: 64, lineHeight: 72, textAlign: "center", fontVariant: ["tabular-nums"] },
  stats: { flexDirection: "row", justifyContent: "space-around" },
  stat: { alignItems: "center", gap: space.xs },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
});
