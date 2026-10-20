import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LifeContext, SeasonKind } from "@workspace/contracts";
import { lifeContext as lifeContextDef } from "@workspace/engine";

import { ChoiceChips, SettingsNote, SettingsSection } from "@/components/SettingsParts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { IconButton, Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useApp } from "@/context/AppContext";
import { deviceTimezone, useAuth } from "@/context/AuthContext";
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
  todayInZone,
} from "@/lib/game/life";
import { applyProfile } from "@/lib/onboarding/actions";
import { describeSettingsError } from "@/lib/settings/actions";
import { settingsActions } from "@/lib/settings/instance";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

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
  // "Today" is the account's day (its timezone, else the device's), and the server says when the cooldown clears.
  const today = todayInZone(user?.timezone, new Date(), deviceTimezone());
  const earliest = seasons?.earliestStart;
  const dates = startDateChoices(today, 14, earliest);
  const chosenStart = startsOn && dates.some((d) => d.date === startsOn) ? startsOn : dates[0]!.date;
  const coolingDown = !!earliest && earliest > startDateChoices(today, 1)[0]!.date;
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
    <Screen title="Life context" back>
      <Text style={[type.body, { color: colors.mutedForeground }]}>Shapes the quests, never the score.</Text>
      {!profile ? (
        <SettingsNote tone="info" message="Loading." />
      ) : (
        <>
          <SettingsSection label="CONTEXT" footer={lifeContextDef(profile.lifeContext).blurb}>
            <View style={s.panel}>
              <ChoiceChips
                options={lifeContextOptions().map((o) => ({ key: o.key, label: o.label }))}
                value={profile.lifeContext}
                disabled={busy}
                onChange={(k) => void changeContext(k)}
              />
            </View>
          </SettingsSection>

          <SettingsSection label="SEASON">
            {seasons?.active ? (
              <ListRow title={seasonChipLine(seasons.active).title} subtitle={`${seasonChipLine(seasons.active).meta}. It runs its course.`} />
            ) : null}
            {seasons?.scheduled ? (
              <>
                <ListRow title={seasons.scheduled.line} subtitle={`Scheduled ${seasons.scheduled.startsOn} to ${seasons.scheduled.endsOn}.`} />
                <View style={s.panel}>
                  <Button label="Cancel season" variant="text" disabled={busy} onPress={() => void cancel(seasons.scheduled!.id)} />
                </View>
              </>
            ) : null}
            {!taken && seasonsQ.isSuccess ? (
              <View style={s.panel}>
                <Text style={[type.body, { color: colors.mutedForeground }]}>
                  Seasons are planned ahead. Quests shrink. The count and the scoring do not change.
                </Text>
                <ChoiceChips options={kinds.map((k) => ({ key: k, label: SEASON_LABELS[k] }))} value={chosenKind} onChange={setKind} />
                <Text style={[type.label, s.above, { color: colors.mutedForeground }]}>STARTS</Text>
                {coolingDown ? (
                  <Text style={[type.meta, { color: colors.mutedForeground }]}>Earliest start {earliest}. Seven days between seasons.</Text>
                ) : null}
                <ChoiceChips options={dates.map((d) => ({ key: d.date, label: d.label }))} value={chosenStart} onChange={setStartsOn} />
                <Text style={[type.label, s.above, { color: colors.mutedForeground }]}>LENGTH</Text>
                <View style={s.stepper}>
                  <IconButton icon="minus" label="One day shorter" onPress={() => setLength((n) => clampSeasonLength(n - 1))} />
                  <Text style={[type.number, s.count, { color: colors.foreground }]} accessibilityLiveRegion="polite">
                    {length} {length === 1 ? "day" : "days"}
                  </Text>
                  <IconButton icon="plus" label="One day longer" onPress={() => setLength((n) => clampSeasonLength(n + 1))} />
                  <Text style={[type.meta, { color: colors.subtle }]}>
                    {MIN_SEASON_DAYS} to {MAX_SEASON_DAYS}
                  </Text>
                </View>
                <Button label="Schedule season" block loading={busy} disabled={!chosenKind} onPress={() => void schedule()} />
              </View>
            ) : null}
            {seasonsQ.isError ? (
              <View style={s.panel}>
                <SettingsNote message="The system is out of reach." onRetry={() => void seasonsQ.refetch()} />
              </View>
            ) : null}
            {seasonsQ.isLoading ? (
              <View style={s.panel}>
                <SettingsNote tone="info" message="Loading." />
              </View>
            ) : null}
          </SettingsSection>
        </>
      )}
      {error ? <SettingsNote message={error} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  panel: { padding: space.md, gap: space.md },
  above: { marginTop: space.sm },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.sm },
  count: { minWidth: 88, textAlign: "center" },
});
