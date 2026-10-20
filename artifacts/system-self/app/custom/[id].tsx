// One custom stat: progress from its starting value to its target, its score and streak, a log form (value + note,
// queued in the outbox), recent entries, and edit / archive. Never part of rank.
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AuthField } from "@/components/AuthField";
import { AuthNotice } from "@/components/AuthShell";
import { CustomDomainForm } from "@/components/CustomDomainForm";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
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

  if (!domain || !detail) {
    return (
      <Screen title="Stat" back>
        {q.isError ? (
          <AuthNotice message={describeCustomError(q.error)} onRetry={() => void q.refetch()} />
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </Screen>
    );
  }

  const p = progressLine(domain);
  const pct = Math.round(p.fraction * 100);
  const entries = [
    ...unsent.map((l) => ({ key: l.clientId, value: l.value, note: l.note, when: l.occurredAt.slice(0, 10), pending: true })),
    ...detail.logs.map((l) => ({ key: l.id, value: l.value, note: l.note, when: l.localDate, pending: false })),
  ];

  return (
    <Screen title={domain.name} back>
      {/* The one figure: the stat's score. */}
      <View style={s.hero}>
        <Text style={[type.display, { color: colors.foreground }]}>{domain.score.toFixed(1)}</Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          {`Score · ${domain.streak}-day streak · separate from rank${domain.isPublic ? " · name and score are public" : " · private"}`}
        </Text>
      </View>

      <View style={s.progress}>
        <View style={[s.track, { backgroundColor: colors.muted }]}>
          <View style={[s.fill, { backgroundColor: colors.accentFill, width: `${pct}%` }]} />
        </View>
        <Text style={[type.body, { color: colors.foreground }]}>{p.line}</Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>{`${pct}% of the way`}</Text>
      </View>

      {error ? <AuthNotice message={error} /> : null}

      {archived ? (
        <AuthNotice tone="info" message="Archived. It keeps its history and takes no new entries." />
      ) : (
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
          <Button label={`${domain.logLabel}  +2.5`} loading={busy} onPress={() => void logIt()} block />
        </View>
      )}

      <View>
        <Text style={[type.label, s.section, { color: colors.mutedForeground }]}>RECENT</Text>
        {entries.length === 0 ? (
          <Text style={[type.body, { color: colors.mutedForeground }]}>No entries yet.</Text>
        ) : (
          <View style={s.flush}>
            {entries.map((l) => (
              <ListRow
                key={l.key}
                title={`${l.value}${domain.unit ? ` ${domain.unit}` : ""}`}
                subtitle={`${l.when}${l.pending ? "  ·  pending" : ""}${l.note ? `  ·  ${l.note}` : ""}`}
              />
            ))}
          </View>
        )}
      </View>

      {editing ? (
        <View style={s.form}>
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
          <Button label="Cancel" variant="text" onPress={() => setEditing(false)} block />
        </View>
      ) : archived ? null : (
        <View style={s.row}>
          <Button label="Edit stat" variant="text" onPress={() => setEditing(true)} />
          <Button
            label="Archive stat"
            variant="text"
            onPress={() => void attempt(() => actions.archive(id!), () => router.replace("/custom"))}
          />
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "flex-start", gap: space.xs },
  progress: { gap: space.sm },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  form: { gap: space.md },
  section: { marginTop: space.sm, marginBottom: space.xs },
  flush: { marginHorizontal: -space.md },
  row: { flexDirection: "row", justifyContent: "space-between" },
});
