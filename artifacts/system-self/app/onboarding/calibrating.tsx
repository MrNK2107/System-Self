import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, BackHandler, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SystemLines } from "@/components/onboarding/SystemLines";
import { Button } from "@/components/ui/Button";
import { RankEmblem } from "@/components/ui/RankEmblem";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { deviceTimezone, useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { api } from "@/lib/api/client";
import {
  applyOnboarded,
  canRetry,
  describeOnboardingError,
  submitOnboardingWithFallback,
} from "@/lib/onboarding/actions";
import { DEFAULT_MORNING_TIME, buildOnboardingPayload, draftFromParams, pickTimezone } from "@/lib/onboarding/payload";

/** Calibration runs at least this long (long enough for THE SYSTEM's lines), however fast the server answers. */
const MIN_CALIBRATION_MS = 5600;

type Phase = "running" | "failed";

export default function CalibratingScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const params = useLocalSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>("running");
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ message: string; retry: boolean } | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  const draft = draftFromParams(params, pickTimezone(deviceTimezone(), user?.timezone ?? ""));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // One id per visit: a retry after a lost reply is recognised by the server instead of onboarding twice.
  const clientId = useRef(`onboarding-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).current;
  const alive = useRef(true);
  const running = useRef(false);

  // While the request is in flight there is nothing to go back to; after a failure, back returns to the schedule.
  useEffect(() => {
    if (phase !== "running") return;
    const h = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => h.remove();
  }, [phase]);

  const userId = user?.id ?? null;
  const calibrate = useCallback(async () => {
    const current = draftRef.current;
    if (running.current || !current || !userId) return;
    running.current = true;
    setPhase("running");
    setFailure(null);
    setAttempt((n) => n + 1);
    progressAnim.setValue(0);
    Animated.timing(progressAnim, { toValue: 1, duration: MIN_CALIBRATION_MS - 400, useNativeDriver: false }).start();
    // The animation and the request run together; leaving waits for both. A failed request drops the wait.
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    const minimum = new Promise<void>((resolve) => {
      waitTimer = setTimeout(resolve, MIN_CALIBRATION_MS);
    });
    try {
      const [state] = await Promise.all([
        submitOnboardingWithFallback(api, buildOnboardingPayload(current, clientId), [user?.timezone ?? "", "UTC"]),
        minimum,
      ]);
      applyOnboarded(queryClient, userId, state);
      if (alive.current) router.replace("/(tabs)");
    } catch (e) {
      clearTimeout(waitTimer);
      if (!alive.current) return;
      progressAnim.stopAnimation();
      setFailure({ message: describeOnboardingError(e), retry: canRetry(e) });
      setPhase("failed");
    } finally {
      running.current = false;
    }
  }, [userId, user?.timezone, queryClient, clientId, progressAnim]);

  const hasDraft = draft !== null;
  useEffect(() => {
    alive.current = true;
    if (!hasDraft) {
      // Opened out of order (no goal or weakness): back to the start of the assessment.
      router.replace("/onboarding/assessment");
    } else {
      void calibrate();
    }
    return () => {
      alive.current = false;
    };
  }, [hasDraft, calibrate]);

  const progressWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  const morning = draft?.morningTime ?? DEFAULT_MORNING_TIME;
  // PRD §21, screen 4.
  const lines = [
    "Baseline recorded. Initial rank assigned: E.",
    "This is where everyone starts. Where you go from here is up to you.",
    `Your first briefing arrives tomorrow at ${morning}.`,
  ];

  return (
    <View style={[s.root, { backgroundColor: colors.background, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.md }]}>
      <View style={s.center}>
        <View style={s.emblem}>
          <RankEmblem rank="E" size={120} />
        </View>

        {phase === "failed" && failure ? (
          <SystemWindow title="CALIBRATION FAILED" frameColor={colors.destructive}>
            <Text style={[type.body, { color: colors.foreground }]} accessibilityLiveRegion="polite">
              {failure.message}
            </Text>
          </SystemWindow>
        ) : (
          <SystemWindow title="CALIBRATION">
            <SystemLines key={attempt} lines={lines} />
          </SystemWindow>
        )}

        {phase === "running" ? (
          <View
            style={[s.track, { backgroundColor: colors.muted }]}
            accessibilityRole="progressbar"
            accessibilityLabel="Calibrating"
          >
            <Animated.View style={[s.fill, { width: progressWidth, backgroundColor: colors.accentFill }]} />
          </View>
        ) : null}
      </View>

      {phase === "failed" && failure ? (
        failure.retry ? (
          <Button label="Retry" onPress={() => void calibrate()} block />
        ) : (
          <Button label="Review answers" onPress={() => router.replace("/onboarding/assessment")} block />
        )
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.md, gap: space.lg },
  center: { flex: 1, justifyContent: "center", gap: space.lg },
  emblem: { alignItems: "center" },
  track: { height: 3, borderRadius: 2, overflow: "hidden" },
  fill: { height: "100%" },
});
