// A simple plan editor: a name, then per weekday the exercises to train with sets x reps.
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { space, type } from "@/constants/type";
import { NumberStepper, TextField } from "@/features/gym/components/Fields";
import { WEEKDAYS } from "@/features/gym/model/constants";
import type { Exercise, Weekday } from "@/features/gym/model/types";
import { useColors } from "@/hooks/useColors";
import {
  MAX_BLOCKS_PER_DAY,
  MAX_PLAN_DAYS,
  validatePlanDraft,
  type PlanDraft,
  type PlanDraftBlock,
} from "@/lib/game/gym";

interface Props {
  exercises: Exercise[];
  saving: boolean;
  /** A line from the last failed save, if any. */
  error: string | null;
  onSave: (draft: PlanDraft) => void;
  onCancel: () => void;
}

export function PlanEditor({ exercises, saving, error, onSave, onCancel }: Props) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [days, setDays] = useState<Partial<Record<Weekday, PlanDraftBlock[]>>>({});
  const [selected, setSelected] = useState<Weekday>("MON");
  const [picking, setPicking] = useState(false);

  const exById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const ids = useMemo(() => new Set(exercises.map((e) => e.id)), [exercises]);
  const enabledDays = WEEKDAYS.filter((d) => days[d] !== undefined);
  const blocks = days[selected] ?? [];

  const draft: PlanDraft = { name, days: enabledDays.map((weekday) => ({ weekday, blocks: days[weekday] ?? [] })) };
  const problem = validatePlanDraft(draft, ids);

  const toggleDay = (d: Weekday) => {
    setPicking(false);
    if (days[d] === undefined) {
      if (enabledDays.length >= MAX_PLAN_DAYS) return;
      setDays((prev) => ({ ...prev, [d]: [] }));
      setSelected(d);
    } else if (selected !== d) {
      setSelected(d);
    } else {
      setDays((prev) => {
        const { [d]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const setBlocks = (next: PlanDraftBlock[]) => setDays((prev) => ({ ...prev, [selected]: next }));
  const patchBlock = (i: number, patch: Partial<PlanDraftBlock>) =>
    setBlocks(blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  const shownError = error ?? (name.trim() || enabledDays.length ? problem : null);

  return (
    <View style={s.root}>
      <TextField label="PLAN NAME" value={name} onChangeText={setName} maxLength={80} placeholder="Upper / lower" autoCapitalize="words" />

      <View style={s.group}>
        <Text style={[type.label, { color: colors.mutedForeground }]}>TRAINING DAYS</Text>
        <View style={s.days}>
          {WEEKDAYS.map((d) => {
            const on = days[d] !== undefined;
            const active = on && selected === d;
            return (
              <View
                key={d}
                style={[
                  s.dayClip,
                  { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.accentFill : on ? colors.muted : "transparent" },
                ]}
              >
                <Pressable
                  onPress={() => toggleDay(d)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${d}${on ? ", training day" : ""}`}
                  android_ripple={{ color: "rgba(168,121,255,0.16)" }}
                  style={s.day}
                >
                  <Text style={[type.label, { color: active ? colors.primaryForeground : on ? colors.primary : colors.mutedForeground }]}>{d}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>Tap a day to train on it. Tap the selected day again to remove it.</Text>
      </View>

      {days[selected] !== undefined && (
        <View style={s.group}>
          <Text style={[type.title, { color: colors.foreground }]}>{selected}</Text>
          {blocks.length === 0 ? <Text style={[type.body, { color: colors.mutedForeground }]}>No exercises on this day yet.</Text> : null}
          {blocks.map((b, i) => (
            <View key={`${b.exerciseId}-${i}`} style={[s.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <View style={s.blockHead}>
                <Text style={[type.bodyStrong, s.flex, { color: colors.foreground }]}>{exById.get(b.exerciseId)?.name ?? b.exerciseId}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove exercise"
                  onPress={() => setBlocks(blocks.filter((_, idx) => idx !== i))}
                  android_ripple={{ color: "rgba(168,121,255,0.2)", borderless: true, radius: 24 }}
                  style={s.remove}
                >
                  <Feather name="x" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>
              <View style={s.steppers}>
                <NumberStepper label="SETS" value={b.sets} min={1} max={20} onChange={(n) => patchBlock(i, { sets: n })} />
                <NumberStepper label="REPS" value={b.reps} min={1} max={50} onChange={(n) => patchBlock(i, { reps: n })} />
              </View>
            </View>
          ))}

          {blocks.length < MAX_BLOCKS_PER_DAY &&
            (picking ? (
              <View style={[s.picker, { borderColor: colors.border }]}>
                {exercises.map((e) => (
                  <ListRow
                    key={e.id}
                    title={e.name}
                    subtitle={e.primaryBodyPart}
                    onPress={() => {
                      setBlocks([...blocks, { exerciseId: e.id, sets: 3, reps: 8 }]);
                      setPicking(false);
                    }}
                  />
                ))}
                <Button label="Close" variant="text" onPress={() => setPicking(false)} />
              </View>
            ) : (
              <Button label="Add exercise" variant="tonal" block onPress={() => setPicking(true)} />
            ))}
        </View>
      )}

      {shownError ? <Text style={[type.body, { color: colors.destructive }]}>{shownError}</Text> : null}

      <View style={s.actions}>
        <Button label="Cancel" variant="text" onPress={onCancel} disabled={saving} />
        <Button label="Save plan" onPress={() => onSave(draft)} disabled={!!problem} loading={saving} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: space.lg },
  group: { gap: space.sm },
  flex: { flex: 1 },
  days: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  dayClip: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  day: { minWidth: 48, minHeight: 48, paddingHorizontal: space.sm, alignItems: "center", justifyContent: "center" },
  block: { borderWidth: 1, borderRadius: 4, padding: space.md, gap: space.md },
  blockHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  remove: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginRight: -space.sm, marginVertical: -space.sm },
  steppers: { flexDirection: "row", gap: space.md },
  picker: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm },
});
