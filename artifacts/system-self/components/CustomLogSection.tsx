// CUSTOM section of the log modal: pick one of your own stats, enter a value and a note, log it. A custom entry is
// queued in the outbox like any log, but it scores only that stat (+2.5, its own streak); it is never ranked activity.
import React, { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useCustomActions, useCustomDomainsQuery } from "@/hooks/useCustom";
import { checkCustomLogForm } from "@/lib/custom/custom";

export function CustomLogSection({ onLogged, onNavigate }: { onLogged: () => void; onNavigate: () => void }) {
  const colors = useColors();
  const q = useCustomDomainsQuery();
  const actions = useCustomActions();
  const [selected, setSelected] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = q.data?.items ?? [];
  const domain = items.find((d) => d.id === selected) ?? null;

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
      setSelected(null);
      onLogged();
    } catch {
      setError("The entry could not be recorded on this device. Sign in again, then retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.section}>
      <Text style={[s.label, { color: colors.mutedForeground }]}>CUSTOM</Text>
      {items.length === 0 ? (
        <TouchableOpacity
          onPress={() => {
            onNavigate();
            router.push("/custom");
          }}
          accessibilityRole="link"
          accessibilityLabel="Add a custom stat"
        >
          <Text style={[s.hint, { color: colors.primary }]}>
            {q.data ? "+ TRACK YOUR OWN STAT" : "Your own stats appear here."}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={s.chips}>
          {items.map((d) => {
            const active = d.id === selected;
            return (
              <TouchableOpacity
                key={d.id}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelected(active ? null : d.id);
                  setError(null);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[s.chip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + "20" : "transparent" }]}
              >
                <Text style={[s.chipText, { color: active ? colors.primary : colors.mutedForeground }]} numberOfLines={1}>
                  {d.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {domain ? (
        <View style={s.form}>
          <Text style={[s.hint, { color: colors.mutedForeground }]}>
            {domain.logLabel.toUpperCase()}
            {domain.unit ? ` (${domain.unit.toUpperCase()})` : ""}  ·  +2.5 to {domain.name}, not to your rank
          </Text>
          <TextInput
            value={value}
            onChangeText={(v) => {
              setValue(v);
              setError(null);
            }}
            keyboardType="numbers-and-punctuation"
            placeholder="Value"
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel="Custom value"
            style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
          />
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Note (optional)"
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel="Custom note"
            maxLength={200}
            style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <TouchableOpacity
            onPress={() => void submit()}
            disabled={busy}
            activeOpacity={0.8}
            accessibilityRole="button"
            style={[s.submit, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
          >
            <Text style={[s.submitText, { color: colors.primaryForeground }]}>LOG {domain.name.toUpperCase()}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: 8, marginBottom: 24, gap: 10 },
  label: { fontSize: 9, fontWeight: "600", letterSpacing: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 2, maxWidth: "100%" },
  chipText: { fontSize: 11, fontWeight: "600" },
  form: { gap: 10 },
  hint: { fontSize: 10, letterSpacing: 0.6, lineHeight: 15 },
  input: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  error: { color: "#E05555", fontSize: 11, lineHeight: 16 },
  submit: { padding: 14, borderRadius: 2, alignItems: "center" },
  submitText: { fontSize: 11, fontWeight: "700", letterSpacing: 2.5 },
});
