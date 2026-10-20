// The create / edit form of a custom domain (name, unit, log label, baseline, target, public). Validation lives in
// lib/custom/custom.ts; this only holds the text and shows the first problem.
import React, { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { AuthField } from "@/components/AuthField";
import { AuthNotice } from "@/components/AuthShell";
import { Button } from "@/components/ui/Button";
import { space, type } from "@/constants/type";
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
      <AuthField label="STARTING VALUE" value={draft.baseline} onChangeText={(v) => set("baseline", v)} keyboardType="numbers-and-punctuation" />
      <AuthField label="TARGET" value={draft.target} onChangeText={(v) => set("target", v)} keyboardType="numbers-and-punctuation" />
      <View style={[s.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={s.rowText}>
          <Text style={[type.bodyStrong, { color: colors.foreground }]}>Show to followers and clan</Text>
          <Text style={[type.meta, { color: colors.mutedForeground }]}>Only the name and score. Never your entries.</Text>
        </View>
        <Switch
          value={draft.isPublic}
          onValueChange={(v) => set("isPublic", v)}
          accessibilityLabel="Show to followers and clan"
          trackColor={{ true: colors.accentFill, false: colors.muted }}
        />
      </View>
      <Button label={submitLabel} loading={busy} onPress={submit} block />
    </View>
  );
}

const s = StyleSheet.create({
  form: { gap: space.md },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: space.md, borderWidth: 1, borderRadius: 4, paddingHorizontal: space.md, paddingVertical: space.sm },
  rowText: { flex: 1, gap: 2 },
});
