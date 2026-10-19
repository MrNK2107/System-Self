// Lock the Slot: pick an exact start (15-minute chips) and a length; the window stays on one day, at most 4 h.
// Quiet-hour suggestions (from the user's own scout reports) render above the chips; none render when empty.
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { buildSlot, durationsFor, fromHHMM, slotStartOptions } from "@/lib/game/slots";

interface Props {
  visible: boolean;
  questTitle: string;
  /** The slot already locked, if any (preselects it and shows CLEAR). */
  current?: { slotStart: string; slotEnd: string } | null;
  /** Quiet-hour chips, e.g. { label: "TUE 07:00", start: "07:00" }. Empty or missing renders nothing. */
  suggestions?: { label: string; start: string }[];
  /** Scout reports still needed before suggestions appear (shown as a hint while > 0). */
  hint?: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (slot: { slotStart: string; slotEnd: string }) => void;
  onClear: () => void;
}

const START_OPTIONS = slotStartOptions();
const DEFAULT_START = "17:00";

function durationLabel(m: number): string {
  if (m < 60) return `${m} MIN`;
  return m % 60 === 0 ? `${m / 60} H` : `${Math.floor(m / 60)} H ${m % 60}`;
}

export function SlotPicker({ visible, questTitle, current, suggestions, hint, busy, onCancel, onConfirm, onClear }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [start, setStart] = useState(DEFAULT_START);
  const [duration, setDuration] = useState(60);

  useEffect(() => {
    if (!visible) return;
    if (current) {
      setStart(current.slotStart);
      setDuration(fromHHMM(current.slotEnd) - fromHHMM(current.slotStart));
    } else {
      setStart(DEFAULT_START);
      setDuration(60);
    }
  }, [visible, current]);

  const allowed = durationsFor(start);
  const effective = allowed.includes(duration) ? duration : (allowed[allowed.length - 1] ?? 30);
  const slot = buildSlot(start, effective);
  const chip = (selected: boolean) => ({
    borderColor: selected ? colors.primary : colors.border,
    backgroundColor: selected ? colors.accentFill + "20" : "transparent",
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel} />
        <View
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}
        >
          <Text style={[styles.label, { color: colors.primary }]}>LOCK THE SLOT</Text>
          <Text style={[styles.quest, { color: colors.foreground }]} numberOfLines={2}>
            {questTitle}
          </Text>
          {suggestions && suggestions.length > 0 ? (
            <View style={styles.chipWrap}>
              <Text style={[styles.sub, { color: colors.mutedForeground }]}>QUIET HOURS</Text>
              {suggestions.map((s) => (
                <Pressable
                  key={s.label}
                  style={[styles.chip, chip(s.start === start)]}
                  onPress={() => setStart(s.start)}
                  accessibilityRole="button"
                  accessibilityLabel={`Quiet hour ${s.label}`}
                >
                  <Text style={[styles.chipText, { color: colors.foreground }]}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : hint ? (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>{hint}</Text>
          ) : null}
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>START</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {START_OPTIONS.map((t) => (
              <Pressable
                key={t}
                style={[styles.chip, chip(t === start)]}
                onPress={() => setStart(t)}
                accessibilityRole="button"
                accessibilityLabel={`Start ${t}`}
              >
                <Text style={[styles.chipText, { color: colors.foreground }]}>{t}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>LENGTH</Text>
          <View style={styles.chipWrap}>
            {allowed.map((d) => (
              <Pressable key={d} style={[styles.chip, chip(d === effective)]} onPress={() => setDuration(d)} accessibilityRole="button">
                <Text style={[styles.chipText, { color: colors.foreground }]}>{durationLabel(d)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.window, { color: colors.foreground }]}>{slot ? `${slot.slotStart}–${slot.slotEnd}` : "--:--"}</Text>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Choosing a slot changes what the SYSTEM says to you. It does not change when the quest fails.
          </Text>
          <View style={styles.row}>
            {current ? (
              <Pressable
                style={[styles.btn, { borderColor: colors.border, opacity: busy ? 0.5 : 1 }]}
                onPress={onClear}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Clear slot"
              >
                <Text style={[styles.btnText, { color: colors.mutedForeground }]}>CLEAR</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.btn, { borderColor: colors.border }]} onPress={onCancel} disabled={busy} accessibilityRole="button">
                <Text style={[styles.btnText, { color: colors.mutedForeground }]}>CANCEL</Text>
              </Pressable>
            )}
            <Pressable
              style={[
                styles.btn,
                { borderColor: colors.primary + "80", backgroundColor: colors.accentFill + "18", opacity: busy || !slot ? 0.5 : 1 },
              ]}
              onPress={() => slot && onConfirm(slot)}
              disabled={busy || !slot}
              accessibilityRole="button"
              accessibilityLabel="Lock slot"
            >
              <Text style={[styles.btnText, { color: colors.primary }]}>LOCK IT</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000A" },
  sheet: { borderTopWidth: 1, padding: 20, gap: 10 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 3 },
  quest: { fontSize: 14, fontWeight: "600" },
  sub: { fontSize: 9, fontWeight: "700", letterSpacing: 2, marginTop: 4 },
  chipRow: { gap: 6 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  chip: { borderWidth: 1, borderRadius: 2, paddingHorizontal: 10, paddingVertical: 7 },
  chipText: { fontSize: 11, fontWeight: "600" },
  window: { fontSize: 22, fontWeight: "800", letterSpacing: 2, textAlign: "center", marginTop: 6 },
  note: { fontSize: 11, lineHeight: 16 },
  row: { flexDirection: "row", gap: 8, marginTop: 4 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 2, paddingVertical: 13, alignItems: "center" },
  btnText: { fontSize: 11, fontWeight: "700", letterSpacing: 2 },
});
