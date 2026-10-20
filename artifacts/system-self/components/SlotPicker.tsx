// Lock the Slot: pick an exact start (15-minute chips) and a length; the window stays on one day, at most 4 h.
// Quiet-hour suggestions (from the user's own scout reports) render above the chips; none render when empty.
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Sheet } from "@/components/quests/Sheet";
import { Button } from "@/components/ui/Button";
import { space, type } from "@/constants/type";
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
  if (m < 60) return `${m} min`;
  return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60}`;
}

function Chip({ label, selected, onPress, a11y }: { label: string; selected: boolean; onPress: () => void; a11y?: string }) {
  const colors = useColors();
  return (
    <View style={[s.chipClip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.muted : "transparent" }]}>
      <Pressable
        onPress={onPress}
        android_ripple={{ color: "rgba(168,121,255,0.16)" }}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={a11y ?? label}
        style={s.chip}
      >
        <Text style={[type.meta, { color: selected ? colors.primary : colors.foreground }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

export function SlotPicker({ visible, questTitle, current, suggestions, hint, busy, onCancel, onConfirm, onClear }: Props) {
  const colors = useColors();
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

  return (
    <Sheet
      visible={visible}
      title="Lock the slot"
      onClose={onCancel}
      locked={busy}
      footer={
        <View style={s.row}>
          {current ? (
            <Button label="Clear" variant="text" onPress={onClear} disabled={busy} accessibilityLabel="Clear slot" />
          ) : (
            <Button label="Cancel" variant="text" onPress={onCancel} disabled={busy} />
          )}
          <Button
            label="Lock it"
            onPress={() => slot && onConfirm(slot)}
            disabled={!slot}
            loading={busy}
            style={s.grow}
            accessibilityLabel="Lock slot"
          />
        </View>
      }
    >
      <Text style={[type.body, { color: colors.mutedForeground }]} numberOfLines={2}>
        {questTitle}
      </Text>

      {suggestions && suggestions.length > 0 ? (
        <View style={s.group}>
          <Text style={[type.label, { color: colors.mutedForeground }]}>QUIET HOURS</Text>
          <View style={s.wrap}>
            {suggestions.map((x) => (
              <Chip key={x.label} label={x.label} selected={x.start === start} onPress={() => setStart(x.start)} a11y={`Quiet hour ${x.label}`} />
            ))}
          </View>
        </View>
      ) : hint ? (
        <Text style={[type.meta, { color: colors.mutedForeground }]}>{hint}</Text>
      ) : null}

      <View style={s.group}>
        <Text style={[type.label, { color: colors.mutedForeground }]}>START</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.line}>
          {START_OPTIONS.map((t) => (
            <Chip key={t} label={t} selected={t === start} onPress={() => setStart(t)} a11y={`Start ${t}`} />
          ))}
        </ScrollView>
      </View>

      <View style={s.group}>
        <Text style={[type.label, { color: colors.mutedForeground }]}>LENGTH</Text>
        <View style={s.wrap}>
          {allowed.map((d) => (
            <Chip key={d} label={durationLabel(d)} selected={d === effective} onPress={() => setDuration(d)} />
          ))}
        </View>
      </View>

      <Text style={[type.number, s.window, { color: colors.foreground }]}>{slot ? `${slot.slotStart}–${slot.slotEnd}` : "--:--"}</Text>
      <Text style={[type.meta, { color: colors.mutedForeground }]}>
        A slot changes what THE SYSTEM says to you. It does not change when the quest fails.
      </Text>
    </Sheet>
  );
}

const s = StyleSheet.create({
  group: { gap: space.sm, marginTop: space.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  line: { gap: space.sm },
  chipClip: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  chip: { minHeight: 48, minWidth: 64, paddingHorizontal: space.md, alignItems: "center", justifyContent: "center" },
  window: { textAlign: "center", marginTop: space.md },
  row: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  grow: { flex: 1 },
});
