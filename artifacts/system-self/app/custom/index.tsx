// CUSTOM stats: user-defined, each with its own 0-100 score. Never part of rank. Free operators track 3, PRO 20.
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { CustomDomainForm } from "@/components/CustomDomainForm";
import { ProLock } from "@/components/ProLock";
import { useColors } from "@/hooks/useColors";
import { useCustomActions, useCustomDomainsQuery } from "@/hooks/useCustom";
import { customLimitLine, describeCustomError, isProRequired, progressLine, type CustomDomainInput } from "@/lib/custom/custom";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

export default function CustomIndexScreen() {
  const colors = useColors();
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
    <AuthShell
      tag="CUSTOM"
      title="Your stats"
      subtitle="Track anything with a number. Each has its own score and streak. None of it counts toward rank."
      back
    >
      {q.isError ? <AuthNotice message={describeCustomError(q.error)} onRetry={() => void q.refetch()} /> : null}
      {!q.data && !q.isError ? <AuthNotice tone="info" message="Loading." /> : null}
      {q.data && q.data.items.length === 0 ? <AuthNotice tone="info" message="Nothing tracked yet. Name a stat and set its target." /> : null}
      {q.data?.items.map((d) => {
        const p = progressLine(d);
        return (
          <TouchableOpacity
            key={d.id}
            onPress={() => router.push({ pathname: "/custom/[id]", params: { id: d.id } })}
            activeOpacity={0.75}
            accessibilityRole="link"
            accessibilityLabel={`Open ${d.name}`}
            style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={s.head}>
              <Text style={[s.name, { color: colors.foreground }]} numberOfLines={1}>
                {d.name}
              </Text>
              <Text style={[s.score, { color: colors.primary }]}>{d.score.toFixed(1)}</Text>
              <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
            </View>
            <View style={[s.track, { backgroundColor: colors.muted }]}>
              <View style={[s.fill, { backgroundColor: colors.primary, width: `${Math.round(p.fraction * 100)}%` }]} />
            </View>
            <Text style={[s.meta, { color: colors.mutedForeground }]}>
              {p.line}
              {d.streak > 0 ? `  ·  ${d.streak}D STREAK` : ""}
              {d.isPublic ? "  ·  PUBLIC" : ""}
            </Text>
          </TouchableOpacity>
        );
      })}
      {limit ? <Text style={[s.limit, { color: colors.mutedForeground }]}>{limit.line}</Text> : null}
      {limit && !limit.canCreate ? (
        limit.proHint ? (
          <ProLock label="MORE STATS" />
        ) : (
          <AuthNotice tone="info" message="20 custom stats is the limit. Archive one to make room." />
        )
      ) : creating ? (
        <>
          <CustomDomainForm submitLabel="START TRACKING" busy={busy} error={error} onSubmit={(i) => void create(i)} />
          {locked ? <ProLock label="MORE STATS" /> : null}
          <AuthLink label="CANCEL" onPress={() => setCreating(false)} />
        </>
      ) : limit ? (
        <AuthLink label="+ NEW STAT" onPress={() => setCreating(true)} />
      ) : null}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { flex: 1, fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
  score: { fontSize: 16, fontWeight: "800", fontFamily: "SpaceMono" },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  meta: { fontSize: 11, lineHeight: 16 },
  limit: { fontSize: 11, letterSpacing: 1 },
});
