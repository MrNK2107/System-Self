// Your own stats inside the manual log form: pick one of them (a chip beside the five domains), enter a value and a
// note, log it. A custom entry is queued in the outbox like any log, but it scores only that stat (+2.5, its own
// streak); it is never ranked activity. The sheet controls which chip is selected, so only one submit shows at a time.
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { Button } from "@/components/ui/Button";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useCustomActions, useCustomDomainsQuery } from "@/hooks/useCustom";
import { checkCustomLogForm } from "@/lib/custom/custom";
import { CUSTOM_LOG_DELTA } from "@workspace/engine";

/** What a custom log scores before its streak bonus (the server applies it). */
const CUSTOM_GAIN = CUSTOM_LOG_DELTA;

export function CustomLogSection({
  selectedId,
  onSelect,
  onLogged,
  onNavigate,
}: {
  /** The selected stat, or null when a ranked domain (or nothing) is chosen. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Logged: THE SYSTEM's line for it, e.g. "+2.5 Spanish. Logged." */
  onLogged: (line: string) => void;
  /** The sheet is about to navigate away (to create a stat). */
  onNavigate: () => void;
}) {
  const colors = useColors();
  const q = useCustomDomainsQuery();
  const actions = useCustomActions();
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = q.data?.items ?? [];
  const domain = items.find((d) => d.id === selectedId) ?? null;

  const submit = async () => {
    if (!domain || busy) return;
    const checked = checkCustomLogForm(value, note);
    if (!checked.ok) return setError(checked.message);
    setBusy(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await actions.log(domain.id, { value: checked.value, note: checked.note });
      setValue("");
      setNote("");
      onLogged(`+${CUSTOM_GAIN.toFixed(1)} ${domain.name}. Logged.`);
    } catch {
      setError("The entry could not be recorded on this device. Sign in again, then retry.");
    } finally {
      setBusy(false);
    }
  };

  if (items.length === 0) {
    // Nothing to pick yet: one quiet way to make the first stat (or nothing while the list loads).
    return q.data ? (
      <Button
        label="Track your own stat"
        variant="text"
        onPress={() => {
          onNavigate();
          router.push("/custom");
        }}
      />
    ) : null;
  }

  return (
    <View style={s.root}>
      <Text style={[type.label, { color: colors.mutedForeground }]}>YOUR STATS</Text>
      <View style={s.chips}>
        {items.map((d) => {
          const active = d.id === selectedId;
          return (
            <View key={d.id} style={[s.chipClip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.muted : "transparent" }]}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  onSelect(active ? null : d.id);
                  setError(null);
                }}
                android_ripple={{ color: "rgba(168,121,255,0.16)" }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={s.chip}
              >
                <Text style={[type.body, { color: active ? colors.primary : colors.mutedForeground }]} numberOfLines={1}>
                  {d.name}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      {domain ? (
        <View style={s.form}>
          <View style={s.field}>
            <Text style={[type.label, { color: colors.mutedForeground }]}>
              {`${domain.logLabel}${domain.unit ? ` (${domain.unit})` : ""}`.toUpperCase()}
            </Text>
            <TextInput
              value={value}
              onChangeText={(v) => {
                setValue(v);
                setError(null);
              }}
              keyboardType="numbers-and-punctuation"
              placeholder="Value"
              placeholderTextColor={colors.subtle}
              accessibilityLabel="Custom value"
              style={[type.body, s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
            />
          </View>
          <View style={s.field}>
            <Text style={[type.label, { color: colors.mutedForeground }]}>NOTE</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Optional"
              placeholderTextColor={colors.subtle}
              accessibilityLabel="Custom note"
              maxLength={200}
              style={[type.body, s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
            />
          </View>
          <Text style={[type.meta, { color: colors.subtle }]}>{`Scores ${domain.name} only, not your rank.`}</Text>
          {error ? <Text style={[type.body, { color: colors.destructive }]}>{error}</Text> : null}
          <Button label={`Log it · +${CUSTOM_GAIN.toFixed(1)} ${domain.name}`} onPress={() => void submit()} loading={busy} block />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chipClip: { borderWidth: 1, borderRadius: 4, overflow: "hidden", maxWidth: "100%" },
  chip: { minHeight: 48, paddingHorizontal: space.md, justifyContent: "center" },
  form: { gap: space.md, marginTop: space.md },
  field: { gap: space.sm },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 4, paddingHorizontal: space.md, paddingVertical: space.sm },
});
