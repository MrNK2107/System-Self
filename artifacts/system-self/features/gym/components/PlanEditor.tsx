// A simple plan editor: a name, then per weekday the exercises to train with sets x reps.
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { WEEKDAYS } from "@/features/gym/model/constants";
import type { Exercise, Weekday } from "@/features/gym/model/types";
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

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const colors = useColors();
  return (
    <View style={s.stepper}>
      <Text style={[s.stepLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TouchableOpacity
        accessibilityLabel={`${label} down`}
        style={[s.stepBtn, { borderColor: colors.border }]}
        onPress={() => onChange(Math.max(min, value - 1))}
      >
        <Feather name="minus" size={12} color={colors.mutedForeground} />
      </TouchableOpacity>
      <Text style={[s.stepValue, { color: colors.foreground }]}>{value}</Text>
      <TouchableOpacity
        accessibilityLabel={`${label} up`}
        style={[s.stepBtn, { borderColor: colors.border }]}
        onPress={() => onChange(Math.min(max, value + 1))}
      >
        <Feather name="plus" size={12} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
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

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[s.title, { color: colors.foreground }]}>NEW PLAN</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={80}
        placeholder="Plan name"
        placeholderTextColor={colors.mutedForeground}
        style={[s.input, { borderColor: colors.border, color: colors.foreground }]}
      />

      <Text style={[s.hint, { color: colors.mutedForeground }]}>
        Tap a weekday to train on it. Tap the selected day again to remove it.
      </Text>
      <View style={s.chips}>
        {WEEKDAYS.map((d) => {
          const on = days[d] !== undefined;
          const active = on && selected === d;
          return (
            <TouchableOpacity
              key={d}
              onPress={() => toggleDay(d)}
              style={[
                s.chip,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primary + (active ? "30" : "14") : colors.card,
                },
              ]}
            >
              <Text style={{ color: on ? colors.primary : colors.mutedForeground, fontSize: 11 }}>{d}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {days[selected] !== undefined && (
        <View style={{ gap: 8 }}>
          <Text style={[s.sub, { color: colors.foreground }]}>{selected}</Text>
          {blocks.map((b, i) => (
            <View key={`${b.exerciseId}-${i}`} style={[s.block, { borderColor: colors.border }]}>
              <View style={s.row}>
                <Text style={{ color: colors.foreground, fontWeight: "700", flex: 1 }}>
                  {exById.get(b.exerciseId)?.name ?? b.exerciseId}
                </Text>
                <TouchableOpacity accessibilityLabel="Remove exercise" onPress={() => setBlocks(blocks.filter((_, idx) => idx !== i))}>
                  <Feather name="x" size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              <View style={s.row}>
                <Stepper label="SETS" value={b.sets} min={1} max={20} onChange={(n) => patchBlock(i, { sets: n })} />
                <Stepper label="REPS" value={b.reps} min={1} max={50} onChange={(n) => patchBlock(i, { reps: n })} />
              </View>
            </View>
          ))}

          {blocks.length < MAX_BLOCKS_PER_DAY &&
            (picking ? (
              <View style={s.chips}>
                {exercises.map((e) => (
                  <TouchableOpacity
                    key={e.id}
                    style={[s.chip, { borderColor: colors.border, backgroundColor: colors.card }]}
                    onPress={() => {
                      setBlocks([...blocks, { exerciseId: e.id, sets: 3, reps: 8 }]);
                      setPicking(false);
                    }}
                  >
                    <Text style={{ color: colors.foreground, fontSize: 11 }}>{e.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <TouchableOpacity style={[s.action, { borderColor: colors.border }]} onPress={() => setPicking(true)}>
                <Feather name="plus" size={14} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground }}>Add exercise</Text>
              </TouchableOpacity>
            ))}
        </View>
      )}

      {(error ?? (name.trim() || enabledDays.length ? problem : null)) ? (
        <Text style={{ color: "#E05555", fontSize: 12 }}>{error ?? problem}</Text>
      ) : null}

      <View style={s.row}>
        <TouchableOpacity style={[s.action, { borderColor: colors.border }]} onPress={onCancel} disabled={saving}>
          <Text style={{ color: colors.mutedForeground }}>CANCEL</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.action, { borderColor: colors.primary, opacity: problem || saving ? 0.5 : 1 }]}
          onPress={() => onSave(draft)}
          disabled={!!problem || saving}
        >
          <Text style={{ color: colors.primary }}>{saving ? "SAVING" : "SAVE PLAN"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: 14, gap: 10 },
  title: { fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  sub: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  hint: { fontSize: 11 },
  input: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 7 },
  block: { borderWidth: 1, borderRadius: 4, padding: 10, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  action: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", gap: 8, alignItems: "center" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepLabel: { fontSize: 10, letterSpacing: 1 },
  stepBtn: { borderWidth: 1, borderRadius: 4, padding: 6 },
  stepValue: { fontFamily: "SpaceMono", minWidth: 24, textAlign: "center" },
});
