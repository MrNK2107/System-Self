// The create / edit form of a custom domain (name, unit, log label, baseline, target, public). Validation lives in
// lib/custom/custom.ts; this only holds the text and shows the first problem.
import React, { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthNotice } from "@/components/AuthShell";
import { useColors } from "@/hooks/useColors";
import { checkCustomDomainForm, type CustomDomainDraft, type CustomDomainInput } from "@/lib/custom/custom";
import { CUSTOM_LOG_LABEL_MAX, CUSTOM_NAME_MAX, CUSTOM_UNIT_MAX } from "@workspace/contracts";

export const EMPTY_CUSTOM_DRAFT: CustomDomainDraft = { name: "", unit: "", logLabel: "", baseline: "0", target: "", isPublic: false };

export function CustomDomainForm({
  initial = EMPTY_CUSTOM_DRAFT,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  initial?: CustomDomainDraft;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: CustomDomainInput) => void;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState<CustomDomainDraft>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof CustomDomainDraft>(key: K, value: CustomDomainDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setProblem(null);
  };
  const submit = () => {
    const checked = checkCustomDomainForm(draft);
    if (!checked.ok) return setProblem(checked.message);
    onSubmit(checked.input);
  };
  return (
    <View style={s.form}>
      {problem ?? error ? <AuthNotice message={(problem ?? error)!} /> : null}
      <AuthField label="NAME" value={draft.name} onChangeText={(v) => set("name", v)} placeholder="Language" autoCapitalize="sentences" maxLength={CUSTOM_NAME_MAX} />
      <AuthField label="UNIT (OPTIONAL)" value={draft.unit} onChangeText={(v) => set("unit", v)} placeholder="min" maxLength={CUSTOM_UNIT_MAX} />
      <AuthField label="LOG BUTTON LABEL (OPTIONAL)" value={draft.logLabel} onChangeText={(v) => set("logLabel", v)} placeholder="Log" autoCapitalize="sentences" maxLength={CUSTOM_LOG_LABEL_MAX} />
      <AuthField label="STARTING VALUE" value={draft.baseline} onChangeText={(v) => set("baseline", v)} keyboardType="numbers-and-punctuation" mono />
      <AuthField label="TARGET" value={draft.target} onChangeText={(v) => set("target", v)} keyboardType="numbers-and-punctuation" mono />
      <View style={[s.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={s.rowText}>
          <Text style={[s.rowLabel, { color: colors.foreground }]}>SHOW TO FOLLOWERS AND CLAN</Text>
          <Text style={[s.rowHint, { color: colors.mutedForeground }]}>Only the name and score. Never your entries.</Text>
        </View>
        <Switch
          value={draft.isPublic}
          onValueChange={(v) => set("isPublic", v)}
          accessibilityLabel="Show to followers and clan"
          trackColor={{ true: colors.accentFill, false: colors.muted }}
        />
      </View>
      <AuthButton label={submitLabel} loading={busy} onPress={submit} />
    </View>
  );
}

const s = StyleSheet.create({
  form: { gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 4, padding: 12 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  rowHint: { fontSize: 11, lineHeight: 16 },
});
