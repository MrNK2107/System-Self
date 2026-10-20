// CUSTOM stats: user-defined, each with its own 0-100 score. Never part of rank. Free operators track 3, PRO 20.
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AuthNotice } from "@/components/AuthShell";
import { CustomDomainForm } from "@/components/CustomDomainForm";
import { ProLock } from "@/components/ProLock";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useCustomActions, useCustomDomainsQuery } from "@/hooks/useCustom";
import { useOnline } from "@/lib/api/query";
import { customLimitLine, describeCustomError, isProRequired, progressLine, type CustomDomainInput } from "@/lib/custom/custom";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

export default function CustomIndexScreen() {
  const colors = useColors();
  const online = useOnline();
  const q = useCustomDomainsQuery();
  const actions = useCustomActions();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const limit = q.data ? customLimitLine(q.data) : null;

  const create = async (input: CustomDomainInput) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setLocked(false);
    try {
      const r = await actions.create(input);
      if (!r.ok) setError(SYNC_PENDING);
      else {
        setCreating(false);
        router.push({ pathname: "/custom/[id]", params: { id: r.value.domain.id } });
      }
    } catch (e) {
      setLocked(isProRequired(e));
      setError(describeCustomError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Custom stats" back>
      <Text style={[type.body, { color: colors.mutedForeground }]}>
        Track anything with a number. Each has its own score and streak. None of it counts toward rank.
      </Text>
      {!online ? <Text style={[type.meta, { color: colors.warn }]}>Offline. Changes need a connection.</Text> : null}
      {q.isError ? <AuthNotice message={describeCustomError(q.error)} onRetry={() => void q.refetch()} /> : null}
      {!q.data && !q.isError ? <ActivityIndicator color={colors.primary} /> : null}

      {q.data && q.data.items.length > 0 ? (
        <View style={s.flush}>
          {q.data.items.map((d) => {
            const p = progressLine(d);
            const extra = [d.streak > 0 ? `${d.streak}-day streak` : null, d.isPublic ? "public" : null].filter(Boolean).join(" · ");
            return (
              <ListRow
                key={d.id}
                title={d.name}
                subtitle={extra ? `${p.line}  ·  ${extra}` : p.line}
                trailing={<Text style={[type.number, { color: colors.primary }]}>{d.score.toFixed(1)}</Text>}
                chevron
                onPress={() => router.push({ pathname: "/custom/[id]", params: { id: d.id } })}
                accessibilityLabel={`Open ${d.name}`}
              />
            );
          })}
        </View>
      ) : null}
      {q.data && q.data.items.length === 0 && !creating ? (
        <Text style={[type.body, { color: colors.foreground }]}>Nothing tracked yet. Name a stat and set its target.</Text>
      ) : null}

      {limit ? <Text style={[type.meta, { color: colors.mutedForeground }]}>{limit.line}</Text> : null}

      {limit && !limit.canCreate ? (
        limit.proHint ? (
          <ProLock label="MORE STATS" />
        ) : (
          <AuthNotice tone="info" message="20 custom stats is the limit. Archive one to make room." />
        )
      ) : creating ? (
        <View style={s.form}>
          <CustomDomainForm submitLabel="START TRACKING" busy={busy} error={error} onSubmit={(i) => void create(i)} />
          {locked ? <ProLock label="MORE STATS" /> : null}
          <Button label="Cancel" variant="text" onPress={() => setCreating(false)} block />
        </View>
      ) : limit ? (
        <Button label="New stat" onPress={() => setCreating(true)} block />
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  flush: { marginHorizontal: -space.md },
  form: { gap: space.sm },
});
