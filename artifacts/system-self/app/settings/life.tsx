import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LifeContext, SeasonKind } from "@workspace/contracts";
import { lifeContext as lifeContextDef } from "@workspace/engine";

import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { SettingsCard } from "@/components/SettingsParts";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useGameStateQuery, useGameUserId } from "@/hooks/useGameState";
import { api } from "@/lib/api/client";
import { seasonsKey } from "@/lib/game/keys";
import {
  MAX_SEASON_DAYS,
  MIN_SEASON_DAYS,
  SEASON_LABELS,
  clampSeasonLength,
  describeSeasonError,
  fetchSeasons,
  lifeContextOptions,
  seasonChipLine,
  startDateChoices,
} from "@/lib/game/life";
import { applyProfile } from "@/lib/onboarding/actions";
import { describeSettingsError } from "@/lib/settings/actions";
import { settingsActions } from "@/lib/settings/instance";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

function localDateString(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[s.chip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}20` : "transparent" }]}
    >
      <Text style={[s.chipText, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function LifeSettingsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = useGameUserId();
  const { scheduleSeason, cancelSeason } = useApp();
  const profile = useGameStateQuery().data?.profile ?? null;
  const seasonsQ = useQuery({ queryKey: seasonsKey(userId), queryFn: () => fetchSeasons(api), enabled: !!userId });

  const [kind, setKind] = useState<SeasonKind | null>(null);
  const [startsOn, setStartsOn] = useState<string | null>(null);
  const [length, setLength] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seasons = seasonsQ.data ?? null;
  const kinds = seasons?.availableKinds ?? [];
  const chosenKind = kind && kinds.includes(kind) ? kind : (kinds[0] ?? null);
  const dates = startDateChoices(localDateString());
  const chosenStart = startsOn ?? dates[0]!.date;
  const taken = !!(seasons?.active || seasons?.scheduled);

  const refreshSeasons = () => queryClient.invalidateQueries({ queryKey: seasonsKey(userId) });

  const changeContext = async (key: LifeContext) => {
    if (busy || !user || profile?.lifeContext === key) return;
    setBusy(true);
    setError(null);
    try {
      applyProfile(queryClient, user.id, await settingsActions.updateLifeContext(key));
      setKind(null);
      await refreshSeasons();
    } catch (e) {
      setError(describeSettingsError(e, "identity").message);
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    if (busy || !chosenKind) return;
    setBusy(true);
    setError(null);
    const r = await scheduleSeason({ kind: chosenKind, startsOn: chosenStart, lengthDays: length });
    if (!r.ok) setError(r.reason === "sync_pending" ? SYNC_PENDING : describeSeasonError(r.error));
    await refreshSeasons();
    setBusy(false);
  };

  const cancel = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await cancelSeason(id);
    if (!r.ok) setError(r.reason === "sync_pending" ? SYNC_PENDING : describeSeasonError(r.error));
    await refreshSeasons();
    setBusy(false);
  };

  return (
    <AuthShell tag="LIFE" title="Life context" subtitle="Shapes the quests, never the score." back>
      {!profile ? (
        <AuthNotice tone="info" message="Loading." />
      ) : (
        <>
          <SettingsCard>
            <View style={s.panel}>
              <Text style={[s.label, { color: colors.mutedForeground }]}>CONTEXT</Text>
              <View style={s.chips}>
                {lifeContextOptions().map((o) => (
                  <Chip key={o.key} label={o.label} active={profile.lifeContext === o.key} onPress={() => void changeContext(o.key)} />
                ))}
              </View>
              <Text style={[s.hint, { color: colors.mutedForeground }]}>{lifeContextDef(profile.lifeContext).promptLine}</Text>
            </View>
          </SettingsCard>

          <SettingsCard>
            <View style={s.panel}>
              <Text style={[s.label, { color: colors.mutedForeground }]}>SEASON</Text>
              {seasons?.active ? (
                <View accessibilityLabel="Active season">
                  <Text style={[s.line, { color: colors.foreground }]}>{seasonChipLine(seasons.active).title}</Text>
                  <Text style={[s.hint, { color: colors.mutedForeground }]}>{seasonChipLine(seasons.active).meta}. It runs its course.</Text>
                </View>
              ) : null}
              {seasons?.scheduled ? (
                <View style={s.gap} accessibilityLabel="Scheduled season">
                  <Text style={[s.line, { color: colors.foreground }]}>{seasons.scheduled.line}</Text>
                  <Text style={[s.hint, { color: colors.mutedForeground }]}>
                    Scheduled {seasons.scheduled.startsOn} to {seasons.scheduled.endsOn}.
                  </Text>
                  <AuthLink label="CANCEL SEASON" onPress={() => void cancel(seasons.scheduled!.id)} />
                </View>
              ) : null}
              {!taken && seasonsQ.isSuccess ? (
                <>
                  <Text style={[s.hint, { color: colors.mutedForeground }]}>
                    Seasons are planned ahead. Quests shrink. The count and the scoring do not change.
                  </Text>
                  <View style={s.chips}>
                    {kinds.map((k) => (
                      <Chip key={k} label={SEASON_LABELS[k]} active={chosenKind === k} onPress={() => setKind(k)} />
                    ))}
                  </View>
                  <Text style={[s.label, { color: colors.mutedForeground }]}>STARTS</Text>
                  <View style={s.chips}>
                    {dates.map((d) => (
                      <Chip key={d.date} label={d.label} active={chosenStart === d.date} onPress={() => setStartsOn(d.date)} />
                    ))}
                  </View>
                  <Text style={[s.label, { color: colors.mutedForeground }]}>LENGTH</Text>
                  <View style={s.stepper}>
                    <Chip label="-" active={false} onPress={() => setLength((n) => clampSeasonLength(n - 1))} />
                    <Text style={[s.line, { color: colors.foreground }]} accessibilityLiveRegion="polite">
                      {length} {length === 1 ? "day" : "days"}
                    </Text>
                    <Chip label="+" active={false} onPress={() => setLength((n) => clampSeasonLength(n + 1))} />
                    <Text style={[s.hint, { color: colors.mutedForeground }]}>
                      {MIN_SEASON_DAYS} to {MAX_SEASON_DAYS}
                    </Text>
                  </View>
                  <AuthButton label="SCHEDULE SEASON" loading={busy} disabled={!chosenKind} onPress={() => void schedule()} />
                </>
              ) : null}
              {seasonsQ.isError ? <AuthNotice message="The system is out of reach." onRetry={() => void seasonsQ.refetch()} /> : null}
            </View>
          </SettingsCard>
        </>
      )}
      {error ? <AuthNotice message={error} /> : null}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  panel: { paddingVertical: 14, gap: 12 },
  gap: { gap: 8 },
  label: { fontSize: 9, letterSpacing: 2.5, fontWeight: "700" as const },
  hint: { fontSize: 11, lineHeight: 16 },
  line: { fontSize: 13, fontWeight: "700" as const, letterSpacing: 0.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: "600" as const, fontFamily: "monospace", letterSpacing: 0.5 },
});
