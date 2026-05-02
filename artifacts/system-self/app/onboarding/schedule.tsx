import React, { useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

const MORNING_TIMES = ["05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "09:00"];
const NIGHTLY_TIMES = ["20:00", "21:00", "21:30", "22:00", "22:30", "23:00"];

export default function ScheduleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, setUser } = useApp();

  const [morning, setMorning] = useState("07:00");
  const [nightly, setNightly] = useState("21:00");

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const handleFinish = async () => {
    if (!user) {
      router.replace("/(tabs)");
      return;
    }
    await setUser({ ...user, morningTime: morning, nightlyTime: nightly });
    router.replace("/(tabs)");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerSection}>
          <Text style={[styles.step, { color: colors.mutedForeground }]}>SET YOUR TIMES</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>When does THE SYSTEM reach you?</Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>MORNING BRIEFING</Text>
          <Text style={[styles.sublabel, { color: colors.mutedForeground }]}>
            Cold. Operational. Your day begins here.
          </Text>
          <View style={styles.timeGrid}>
            {MORNING_TIMES.map(t => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.timeBtn,
                  {
                    borderColor: morning === t ? colors.primary : colors.border,
                    backgroundColor: morning === t ? colors.primary + "20" : "transparent",
                  }
                ]}
                onPress={() => setMorning(t)}
                activeOpacity={0.7}
              >
                <Text style={[styles.timeText, { color: morning === t ? colors.primary : colors.mutedForeground, fontFamily: "SpaceMono" }]}>
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>NIGHTLY DEBRIEF</Text>
          <Text style={[styles.sublabel, { color: colors.mutedForeground }]}>
            Analytical. Verdict-based. Your day ends here.
          </Text>
          <View style={styles.timeGrid}>
            {NIGHTLY_TIMES.map(t => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.timeBtn,
                  {
                    borderColor: nightly === t ? colors.primary : colors.border,
                    backgroundColor: nightly === t ? colors.primary + "20" : "transparent",
                  }
                ]}
                onPress={() => setNightly(t)}
                activeOpacity={0.7}
              >
                <Text style={[styles.timeText, { color: nightly === t ? colors.primary : colors.mutedForeground, fontFamily: "SpaceMono" }]}>
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.finalCard, { borderColor: colors.border }]}>
          <Text style={[styles.finalTitle, { color: colors.foreground }]}>
            Your first briefing arrives tomorrow morning.
          </Text>
          <Text style={[styles.finalText, { color: colors.mutedForeground }]}>
            No tutorial. No guided tour. Figure it out. That's the point.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.finishBtn, { backgroundColor: colors.primary }]}
          onPress={handleFinish}
          activeOpacity={0.8}
        >
          <Text style={styles.finishBtnText}>INITIALIZE THE SYSTEM</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 14 },
  headerSection: { gap: 4, marginBottom: 4 },
  step: { fontSize: 9, letterSpacing: 3, fontWeight: "600" as const },
  title: { fontSize: 22, fontWeight: "700" as const, lineHeight: 30 },
  section: { padding: 16, borderRadius: 4, borderWidth: 1, gap: 12 },
  label: { fontSize: 9, letterSpacing: 2, fontWeight: "600" as const },
  sublabel: { fontSize: 11, marginTop: -6 },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeBtn: { paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderRadius: 2 },
  timeText: { fontSize: 13, fontWeight: "600" as const },
  finalCard: { padding: 16, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  finalTitle: { fontSize: 14, fontWeight: "600" as const, lineHeight: 20 },
  finalText: { fontSize: 12, lineHeight: 18 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  finishBtn: { padding: 16, alignItems: "center", borderRadius: 2 },
  finishBtnText: { color: "#fff", fontSize: 11, fontWeight: "700" as const, letterSpacing: 3 },
});
