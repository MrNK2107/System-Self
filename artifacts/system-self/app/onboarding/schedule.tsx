import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OnboardingFrame, OptionList, OptionRow } from "@/components/onboarding/OnboardingFrame";
import { ListRow } from "@/components/ui/ListRow";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { DEFAULT_MORNING_TIME, DEFAULT_NIGHTLY_TIME } from "@/lib/onboarding/payload";
import { MORNING_PRESETS, NIGHTLY_PRESETS } from "@/lib/onboarding/steps";

type Which = "morning" | "nightly";

const PICKERS: Record<Which, { title: string; line: string; presets: readonly string[] }> = {
  morning: { title: "Morning briefing", line: "Your orders for the day.", presets: MORNING_PRESETS },
  nightly: { title: "Nightly debrief", line: "The verdict on your day.", presets: NIGHTLY_PRESETS },
};

/**
 * Step 6: when THE SYSTEM reaches you. The times travel with the rest of the answers to calibration, which
 * creates the account's game state in one request.
 */
export default function ScheduleScreen() {
  const params = useLocalSearchParams();
  const [morning, setMorning] = useState(DEFAULT_MORNING_TIME);
  const [nightly, setNightly] = useState(DEFAULT_NIGHTLY_TIME);
  const [picking, setPicking] = useState<Which | null>(null);

  const initialize = () => {
    router.push({ pathname: "/onboarding/calibrating", params: { ...params, morningTime: morning, nightlyTime: nightly } });
  };

  const value = picking === "morning" ? morning : nightly;
  const choose = (t: string) => {
    if (picking === "morning") setMorning(t);
    else setNightly(t);
    setPicking(null);
  };

  return (
    <OnboardingFrame
      step="schedule"
      onBack={() => router.back()}
      title="When does THE SYSTEM reach you?"
      subtitle={`Your first briefing arrives tomorrow at ${morning}. Change these any time in Settings.`}
      action={{ label: "Initialize", onPress: initialize }}
    >
      <OptionList>
        {(["morning", "nightly"] as const).map((w) => (
          <ListRow
            key={w}
            title={PICKERS[w].title}
            subtitle={PICKERS[w].line}
            trailing={<TimeValue time={w === "morning" ? morning : nightly} />}
            chevron
            onPress={() => setPicking(w)}
            accessibilityLabel={`${PICKERS[w].title}, ${w === "morning" ? morning : nightly}. Change`}
          />
        ))}
      </OptionList>

      <TimeSheet
        which={picking}
        value={value}
        onChoose={choose}
        onClose={() => setPicking(null)}
      />
    </OnboardingFrame>
  );
}

function TimeValue({ time }: { time: string }) {
  const colors = useColors();
  return <Text style={[type.number, { color: colors.foreground }]}>{time}</Text>;
}

/** Bottom sheet of preset times. Android back and a tap outside close it without changing anything. */
function TimeSheet({
  which,
  value,
  onChoose,
  onClose,
}: {
  which: Which | null;
  value: string;
  onChoose: (t: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const picker = which ? PICKERS[which] : null;

  return (
    <Modal visible={which !== null} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.sheetRoot}>
        <Pressable style={[StyleSheet.absoluteFill, s.scrim]} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={[s.sheet, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + space.sm }]}>
          <View style={s.sheetHead}>
            <Text style={[type.title, s.sheetTitle, { color: colors.foreground }]} accessibilityRole="header">
              {picker?.title ?? ""}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              android_ripple={{ color: "rgba(168,121,255,0.2)", borderless: true, radius: 24 }}
              style={s.close}
            >
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView style={s.sheetList}>
            <OptionList>
              {(picker?.presets ?? []).map((t) => (
                <OptionRow key={t} title={t} selected={t === value} onPress={() => onChoose(t)} />
              ))}
            </OptionList>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  scrim: { backgroundColor: "rgba(7,6,11,0.72)" },
  sheet: { borderTopWidth: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4, maxHeight: "75%" },
  sheetHead: { flexDirection: "row", alignItems: "center", paddingLeft: space.md, paddingRight: space.xs, paddingTop: space.sm, paddingBottom: space.sm },
  sheetTitle: { flex: 1 },
  close: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  sheetList: { flexGrow: 0, paddingHorizontal: space.md },
});
