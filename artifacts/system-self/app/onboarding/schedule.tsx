import React, { useEffect, useState } from "react";
import {
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { ApiError, api } from "@/lib/api/client";
import { applyProfile, updateSchedule } from "@/lib/onboarding/actions";
import { DEFAULT_MORNING_TIME, DEFAULT_NIGHTLY_TIME } from "@/lib/onboarding/payload";

const MORNING_TIMES = ["05:00", "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "09:00"];
const NIGHTLY_TIMES = ["19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];

function StepBadge({ step }: { step: number }) {
  return (
    <View style={s.stepRow}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={[s.stepSeg, {
          backgroundColor: i < step ? "#3A7BD5" : i === step ? "#3A7BD550" : "#1A1D24",
        }]} />
      ))}
    </View>
  );
}

function TimeSelector({
  times,
  selected,
  onSelect,
  color,
}: {
  times: string[];
  selected: string;
  onSelect: (t: string) => void;
  color: string;
}) {
  return (
    <View style={s.timeGrid}>
      {times.map(t => {
        const active = selected === t;
        return (
          <TouchableOpacity
            key={t}
            style={[s.timeChip, {
              borderColor: active ? color : "#1E2230",
              backgroundColor: active ? `${color}18` : "#0D1018",
            }]}
            onPress={() => onSelect(t)}
            activeOpacity={0.75}
          >
            <Text style={[s.timeText, { color: active ? color : "#3A3D48" }]}>{t}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function ScheduleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [morning, setMorning] = useState(DEFAULT_MORNING_TIME);
  const [nightly, setNightly] = useState(DEFAULT_NIGHTLY_TIME);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 0 : 0);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const handleFinish = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const profile = await updateSchedule(api, { morningTime: morning, nightlyTime: nightly });
      if (user) applyProfile(queryClient, user.id, profile);
      router.replace("/(tabs)");
    } catch (e) {
      // The account already exists with the default times, so a failed save never traps the user here.
      setError(
        e instanceof ApiError && e.kind === "http" && e.status === 400 && e.issues[0]
          ? `Rejected: ${e.issues[0].message}`
          : e instanceof ApiError && e.kind === "network"
            ? "No connection. Check your signal and retry."
            : "The schedule did not save. Retry."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        {/* No back: the account already exists, and going back would re-run calibration. */}
        <View style={s.back} />
        <View style={s.headerMid}>
          <Text style={[s.headerTag, { color: colors.subtle }]}>SCHEDULE</Text>
          <StepBadge step={3} />
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <View style={s.titleBlock}>
          <Text style={[s.title, { color: colors.foreground }]}>
            When does{"\n"}
            <Text style={{ color: "#3A7BD5" }}>THE SYSTEM reach you?</Text>
          </Text>
          <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
            Set times for your morning briefing and nightly debrief. These are daily operations.
          </Text>
        </View>

        {/* Morning */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.cardTop}>
            <View style={[s.cardIcon, { backgroundColor: "#C4873A20" }]}>
              <Feather name="sun" size={16} color="#C4873A" />
            </View>
            <View>
              <Text style={[s.cardLabel, { color: colors.foreground }]}>Morning Briefing</Text>
              <Text style={[s.cardSub, { color: colors.mutedForeground }]}>
                Cold. Operational. Your day starts here.
              </Text>
            </View>
            <Text style={[s.selectedTime, { color: "#C4873A" }]}>{morning}</Text>
          </View>
          <TimeSelector
            times={MORNING_TIMES}
            selected={morning}
            onSelect={setMorning}
            color="#C4873A"
          />
        </View>

        {/* Nightly */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.cardTop}>
            <View style={[s.cardIcon, { backgroundColor: "#3A7BD520" }]}>
              <Feather name="moon" size={16} color="#3A7BD5" />
            </View>
            <View>
              <Text style={[s.cardLabel, { color: colors.foreground }]}>Nightly Debrief</Text>
              <Text style={[s.cardSub, { color: colors.mutedForeground }]}>
                Verdict-based. Analytical. Day ends here.
              </Text>
            </View>
            <Text style={[s.selectedTime, { color: "#3A7BD5" }]}>{nightly}</Text>
          </View>
          <TimeSelector
            times={NIGHTLY_TIMES}
            selected={nightly}
            onSelect={setNightly}
            color="#3A7BD5"
          />
        </View>

        {/* Final message */}
        <View style={[s.finalCard, { borderColor: "#3A7BD520" }]}>
          <Text style={[s.finalTitle, { color: colors.foreground }]}>
            Your first briefing arrives tomorrow at {morning}.
          </Text>
          <Text style={[s.finalBody, { color: colors.mutedForeground }]}>
            No tutorial. No guided tour. No hand-holding.
            Start logging today. That's how the score moves.
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 16, borderTopColor: colors.border, backgroundColor: colors.background }]}>
        {error ? (
          <View style={s.errorRow} accessibilityLiveRegion="polite">
            <Text style={[s.errorText, { color: colors.foreground }]}>{error}</Text>
            <TouchableOpacity onPress={() => router.replace("/(tabs)")} accessibilityRole="button">
              <Text style={[s.skipText, { color: colors.mutedForeground }]}>KEEP DEFAULTS</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <TouchableOpacity
          onPress={handleFinish}
          disabled={saving}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving, busy: saving }}
          style={{ borderRadius: 2, overflow: "hidden", opacity: saving ? 0.6 : 1 }}
        >
          <LinearGradient
            colors={["#3A7BD5", "#2860B4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.finishBtn}
          >
            <Feather name="zap" size={16} color="#fff" />
            <Text style={s.finishText}>{error ? "RETRY" : "INITIALIZE THE SYSTEM"}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerMid: { flex: 1, alignItems: "center", gap: 8 },
  headerTag: { fontSize: 9, letterSpacing: 3, fontWeight: "700" as const },
  stepRow: { flexDirection: "row", gap: 4 },
  stepSeg: { width: 20, height: 2, borderRadius: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 24, gap: 14 },
  titleBlock: { gap: 8, paddingHorizontal: 4 },
  title: { fontSize: 28, fontWeight: "800" as const, lineHeight: 36, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 14 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardLabel: { fontSize: 14, fontWeight: "600" as const },
  cardSub: { fontSize: 11, marginTop: 1 },
  selectedTime: { marginLeft: "auto", fontSize: 18, fontWeight: "800" as const },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeChip: { paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderRadius: 6 },
  timeText: { fontSize: 13, fontWeight: "600" as const, letterSpacing: 0.5 },
  finalCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    gap: 8,
    backgroundColor: "transparent",
  },
  finalTitle: { fontSize: 14, fontWeight: "700" as const, lineHeight: 21 },
  finalBody: { fontSize: 13, lineHeight: 20 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  errorRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 12 },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17 },
  skipText: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 2 },
  finishBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 10,
  },
  finishText: { color: "#fff", fontSize: 12, fontWeight: "700" as const, letterSpacing: 3 },
});
