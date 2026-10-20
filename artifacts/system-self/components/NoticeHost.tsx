// Mounted once in the tabs layout: shows unseen server notices one at a time. Most are centred System windows that wait
// for "Acknowledged"; reminders (the quest-expiry warning) are a slim banner at the top that never blocks the app.
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AchievementModal } from "@/components/AchievementModal";
import { ChallengeOutcomeModal } from "@/components/ChallengeOutcomeModal";
import { FailureModal } from "@/components/FailureModal";
import { HomePathOffer } from "@/components/HomePathOffer";
import { MilestoneModal } from "@/components/MilestoneModal";
import { RankUpModal } from "@/components/RankUpModal";
import { StreakBrokenModal } from "@/components/StreakBrokenModal";
import { SystemNoticeModal, useReducedMotion } from "@/components/SystemNoticeModal";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { deviceTimezone, useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useGameStateQuery, useQuestsQuery } from "@/hooks/useGameState";
import { useNotices } from "@/hooks/useNotices";
import { rankChangeHaptic, shadowActivatedHaptic } from "@/lib/haptics";
import { todayInZone } from "@/lib/game/life";
import { suppressExpiryNotice } from "@/lib/game/notices";

/** How long a banner stays before it dismisses itself. */
const BANNER_MS = 6000;

export function NoticeHost() {
  const { group, view, dismiss } = useNotices();
  const { user } = useAuth();
  const stateQ = useGameStateQuery();
  const questsQ = useQuestsQuery();
  // Keyed by the notice ids so each notice gets a fresh modal (animations and per-notice state reset).
  const key = group ? group.notices.map((n) => n.id).join(",") : "";
  const kind = !view ? null : view.modal === "rank_up" ? "rank" : view.modal === "system" && view.label === "SHADOW SELF ACTIVATED" ? "shadow" : null;

  // The expiry banner is decided once the quests are known (or could not be loaded).
  const isBanner = view?.modal === "banner";
  const questsKnown = questsQ.data !== undefined || questsQ.isError;
  const suppress =
    isBanner && questsKnown && group
      ? suppressExpiryNotice({
          notice: group.notices[0]!,
          dayNumber: stateQ.data?.profile.dayNumber ?? null,
          today: todayInZone(user?.timezone, new Date(), deviceTimezone()),
          quests: questsQ.data?.active ?? null,
        })
      : false;

  // Haptics fire once per notice group (the effect re-runs only when the group changes), never on re-render.
  useEffect(() => {
    if (kind === "rank") rankChangeHaptic();
    else if (kind === "shadow") shadowActivatedHaptic();
    // `kind` is derived from `key` (the same notice group), so depending on `key` alone fires once per group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A suppressed warning (first day, quests just issued, stale, or nothing left open) is marked seen unshown.
  useEffect(() => {
    if (suppress) void dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, suppress]);

  if (!group || !view) return null;

  const onAcknowledge = () => void dismiss();

  switch (view.modal) {
    case "banner":
      if (!questsKnown || suppress) return null;
      return (
        <NoticeBanner
          key={key}
          label={view.label}
          line={`${view.title} ${view.body}`}
          onDismiss={onAcknowledge}
          onOpen={() => {
            void dismiss();
            router.navigate(view.href);
          }}
        />
      );
    case "rank_up":
      return (
        <RankUpModal
          key={key}
          visible
          fromRank={view.fromRank}
          toRank={view.toRank}
          newCodename={view.newCodename}
          onAcknowledge={onAcknowledge}
        />
      );
    case "achievement":
      return <AchievementModal key={key} visible achievement={view.achievement} onAcknowledge={onAcknowledge} />;
    case "milestone":
      return <MilestoneModal key={key} visible milestone={view.milestone} onAcknowledge={onAcknowledge} />;
    case "streak_break":
      return <StreakBrokenModal key={key} visible data={view.data} onAcknowledge={onAcknowledge} />;
    case "failure":
      return <FailureModal key={key} visible failures={view.failures} onAcknowledge={onAcknowledge} />;
    case "comeback":
      return view.offerHomePath ? (
        <HomePathOffer key={key} gapDays={view.gapDays} line={view.line} onDone={onAcknowledge} />
      ) : (
        <SystemNoticeModal
          key={key}
          visible
          label="YOU RETURNED"
          title={view.line}
          body={`${view.gapDays} empty days. The record stands. Finish today's checklist.`}
          tone="info"
          onAcknowledge={onAcknowledge}
        />
      );
    case "challenge_result":
      // Dismissing marks the notice seen, which acknowledges the challenge on the server.
      return <ChallengeOutcomeModal key={key} visible result={view.result} onAcknowledge={onAcknowledge} />;
    case "system":
      return (
        <SystemNoticeModal
          key={key}
          visible
          label={view.label}
          title={view.title}
          body={view.body}
          tone={view.tone}
          onAcknowledge={onAcknowledge}
        />
      );
  }
}

/** A slim System window under the status bar: slides in, dismisses itself after BANNER_MS, tap opens the target. */
function NoticeBanner({ label, line, onDismiss, onOpen }: { label: string; line: string; onDismiss: () => void; onOpen: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const y = useRef(new Animated.Value(-24)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const done = useRef(false);

  useEffect(() => {
    if (reduce) {
      y.setValue(0);
      opacity.setValue(1);
    } else {
      Animated.parallel([
        Animated.timing(y, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
    const t = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      Animated.timing(opacity, { toValue: 0, duration: reduce ? 0 : 200, useNativeDriver: true }).start(() => onDismiss());
    }, BANNER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = () => {
    if (done.current) return;
    done.current = true;
    onOpen();
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[s.banner, { top: insets.top + space.sm, opacity, transform: [{ translateY: y }] }]}
      accessibilityLiveRegion="polite"
    >
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${line} Opens Quests.`}
        android_ripple={{ color: "rgba(168,121,255,0.16)" }}
      >
        <SolidBacking color={colors.surface} />
        <SystemWindow style={s.window}>
          <View style={s.row}>
            <View style={s.text}>
              <Text style={[type.label, { color: colors.warn }]}>{`[ ${label} ]`}</Text>
              <Text style={[type.body, { color: colors.foreground }]} numberOfLines={2}>
                {line}
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.subtle} />
          </View>
        </SystemWindow>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The System window's panel is translucent (it is meant to sit on the ink ground); a banner floats over content, so it
 * gets an opaque notched backing of the same shape (kit SystemWindow: 10px 45° corners).
 */
function SolidBacking({ color }: { color: string }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };
  const n = 10;
  const { w, h } = size;
  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {w > 0 ? (
        <Svg width={w} height={h}>
          <Path d={`M${n},0 H${w - n} L${w},${n} V${h - n} L${w - n},${h} H${n} L0,${h - n} V${n} Z`} fill={color} />
        </Svg>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  banner: { position: "absolute", left: space.md, right: space.md, zIndex: 20, elevation: 20 },
  window: { paddingVertical: space.sm + 4, paddingHorizontal: space.md, minHeight: 56 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  text: { flex: 1, gap: 2 },
});
