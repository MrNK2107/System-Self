// One custom stat: progress from its starting value to its target, its score and streak, a log form (value + note,
// queued in the outbox), recent entries, and edit / archive. Never part of rank.
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { CustomDomainForm } from "@/components/CustomDomainForm";
import { useColors } from "@/hooks/useColors";
import { useCustomActions, useCustomDomainQuery } from "@/hooks/useCustom";
import { useOutboxSnapshot } from "@/hooks/useGameState";
import { checkCustomLogForm, describeCustomError, pendingCustomLogs, progressLine, type CustomDomainInput } from "@/lib/custom/custom";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

export default function CustomDomainScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const q = useCustomDomainQuery(id);
  const actions = useCustomActions();
  const outbox = useOutboxSnapshot();
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detail = q.data;
  const domain = detail?.domain;
  const archived = !!domain?.archived;
  const pending = useMemo(() => (id ? pendingCustomLogs(outbox.pending, id) : []), [outbox.pending, id]);
  const serverIds = new Set((detail?.logs ?? []).map((l) => l.clientId));
  const unsent = pending.filter((p) => !serverIds.has(p.clientId));

  const attempt = async (send: () => Promise<{ ok: boolean }>, done?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send();
      if (!r.ok) setError(SYNC_PENDING);
      else done?.();
    } catch (e) {
      setError(describeCustomError(e));
    } finally {
      setBusy(false);
    }
  };

  const logIt = async () => {
    if (!id || busy) return;
    const checked = checkCustomLogForm(value, note);
    if (!checked.ok) return setError(checked.message);
    setBusy(true);
    setError(null);
    try {
      await actions.log(id, { value: checked.value, note: checked.note });
      setValue("");
      setNote("");
    } catch {
      setError("The entry could not be recorded on this device. Sign in again, then retry.");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = (input: CustomDomainInput) => void attempt(() => actions.update(id!, input), () => setEditing(false));

  if (!domain) {
    return (
      <AuthShell tag="CUSTOM" title="Stat" back>
        {q.isError ? (
          <AuthNotice message={describeCustomError(q.error)} onRetry={() => void q.refetch()} />
        ) : (
          <AuthNotice tone="info" message="Loading." />
        )}
      </AuthShell>
    );
  }

  const p = progressLine(domain);
  return (
    <AuthShell tag="CUSTOM" title={domain.name} subtitle={`Score ${domain.score.toFixed(1)}  ·  ${domain.streak}D streak  ·  separate from rank`} back>
      {error ? <AuthNotice message={error} /> : null}
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[s.track, { backgroundColor: colors.muted }]}>
          <View style={[s.fill, { backgroundColor: colors.primary, width: `${Math.round(p.fraction * 100)}%` }]} />
        </View>
        <Text style={[s.line, { color: colors.foreground }]}>{p.line}</Text>
        <Text style={[s.meta, { color: colors.mutedForeground }]}>
          {Math.round(p.fraction * 100)}% of the way{domain.isPublic ? "  ·  name and score are public" : "  ·  private"}
        </Text>
      </View>

      {archived ? <AuthNotice tone="info" message="Archived. It keeps its history and takes no new entries." /> : null}
      {!archived ? (
        <View style={s.form}>
          <AuthField
            label={`${domain.logLabel.toUpperCase()}${domain.unit ? ` (${domain.unit.toUpperCase()})` : ""}`}
            value={value}
            onChangeText={(v) => {
              setValue(v);
              setError(null);
            }}
            keyboardType="numbers-and-punctuation"
            mono
          />
          <AuthField label="NOTE (OPTIONAL)" value={note} onChangeText={setNote} autoCapitalize="sentences" maxLength={200} />
          <AuthButton label={`${domain.logLabel.toUpperCase()}  +2.5`} loading={busy} onPress={() => void logIt()} />
        </View>
      ) : null}

      <Text style={[s.section, { color: colors.mutedForeground }]}>RECENT</Text>
      {unsent.length === 0 && detail.logs.length === 0 ? <AuthNotice tone="info" message="No entries yet." /> : null}
      {[
        ...unsent.map((l) => ({ key: l.clientId, value: l.value, note: l.note, when: l.occurredAt.slice(0, 10), pending: true })),
        ...detail.logs.map((l) => ({ key: l.id, value: l.value, note: l.note, when: l.localDate, pending: false })),
      ].map((l) => (
        <View key={l.key} style={[s.entry, { borderColor: colors.border }]}>
          <Text style={[s.entryValue, { color: colors.foreground }]}>
            {l.value}
            {domain.unit ? ` ${domain.unit}` : ""}
          </Text>
          <Text style={[s.entryMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {l.when}
            {l.pending ? "  ·  PENDING" : ""}
            {l.note ? `  ·  ${l.note}` : ""}
          </Text>
        </View>
      ))}

      {editing ? (
        <>
          <CustomDomainForm
            initial={{
              name: domain.name,
              unit: domain.unit,
              logLabel: domain.logLabel,
              baseline: String(domain.baseline),
              target: String(domain.target),
              isPublic: domain.isPublic,
            }}
            submitLabel="SAVE"
            busy={busy}
            error={null}
            onSubmit={saveEdit}
          />
          <AuthLink label="CANCEL" onPress={() => setEditing(false)} />
        </>
      ) : archived ? null : (
        <>
          <AuthLink label="EDIT STAT" onPress={() => setEditing(true)} />
          <AuthLink
            label="ARCHIVE STAT"
            onPress={() => void attempt(() => actions.archive(id!), () => router.replace("/custom"))}
          />
        </>
      )}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: 14, gap: 10 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  line: { fontSize: 14, fontWeight: "700" },
  meta: { fontSize: 11, lineHeight: 16 },
  form: { gap: 14 },
  section: { fontSize: 10, fontWeight: "800", letterSpacing: 2, marginTop: 6 },
  entry: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8, gap: 2 },
  entryValue: { fontSize: 14, fontWeight: "700", fontFamily: "SpaceMono" },
  entryMeta: { fontSize: 11 },
});
