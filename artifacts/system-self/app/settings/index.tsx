import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";

import { ChoiceChips, ExpandTrailing, SettingsNote, SettingsPanel, SettingsSection } from "@/components/SettingsParts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { IDENTITY_OPTIONS } from "@/constants/identity";
import { space, type } from "@/constants/type";
import { useAuth } from "@/context/AuthContext";
import { useGym } from "@/features/gym/context/GymContext";
import { useColors } from "@/hooks/useColors";
import { useGameStateQuery } from "@/hooks/useGameState";
import { getOutbox } from "@/lib/api/outbox";
import { pendingLocalCount } from "@/lib/api/user-scope";
import { applyProfile } from "@/lib/onboarding/actions";
import { describeSettingsError, type IdentitySetting } from "@/lib/settings/actions";
import { shareExportOnDevice } from "@/lib/settings/export-device";
import { settingsActions } from "@/lib/settings/instance";

const MORNING_TIMES = ["05:00", "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "09:00"].map((t) => ({ key: t, label: t }));
const NIGHTLY_TIMES = ["19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"].map((t) => ({ key: t, label: t }));

/** Visibility names in plain words, from the stored setting (the onboarding names stay as the subtitle's lead). */
const visibilityLabel = (v: string) => IDENTITY_OPTIONS.find((o) => o.value === v);

export default function SettingsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();
  const { flushPendingSets } = useGym();
  const stateQ = useGameStateQuery();
  const profile = stateQ.data?.profile ?? null;

  const [open, setOpen] = useState<"schedule" | "identity" | null>(null);
  const [morning, setMorning] = useState<string | null>(null);
  const [nightly, setNightly] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  // Entries still on this device after a last flush; set while the sign-out waits for confirmation.
  const [unsent, setUnsent] = useState<number | null>(null);

  const toggle = (which: "schedule" | "identity") => {
    setError(null);
    setOpen((cur) => (cur === which ? null : which));
  };

  const morningValue = morning ?? profile?.morningTime ?? "";
  const nightlyValue = nightly ?? profile?.nightlyTime ?? "";
  const scheduleChanged = !!profile && (morningValue !== profile.morningTime || nightlyValue !== profile.nightlyTime);

  const save = async (run: () => ReturnType<typeof settingsActions.updateSchedule>, context: "schedule" | "identity") => {
    if (saving || !user) return;
    setSaving(true);
    setError(null);
    try {
      applyProfile(queryClient, user.id, await run());
      setMorning(null);
      setNightly(null);
    } catch (e) {
      setError(describeSettingsError(e, context).message);
    } finally {
      setSaving(false);
    }
  };

  const finishSignOut = async () => {
    setUnsent(null);
    try {
      await signOut();
    } catch {
      // The session is already cleared; the signed-out guard routes to sign-in.
    } finally {
      setSigningOut(false);
    }
  };

  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    setExportNote(null);
    setError(null);
    try {
      const outcome = await shareExportOnDevice(await settingsActions.exportMyData());
      if (outcome === "too-large") setExportNote("Your export is too large to share as text here. Open the app on a device that supports file sharing.");
    } catch (e) {
      setError(describeSettingsError(e, "export").message);
    } finally {
      setExporting(false);
    }
  };

  // Signing out wipes the device: send what is queued first, and ask before erasing what could not be sent.
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    await getOutbox()
      .flush()
      .catch(() => undefined);
    await flushPendingSets().catch(() => undefined);
    const left = await pendingLocalCount({ outbox: getOutbox(), storage: AsyncStorage, userId: user?.id ?? null }).catch(() => 0);
    if (left > 0) {
      setUnsent(left);
      setSigningOut(false);
      return;
    }
    await finishSignOut();
  };

  const confirmSignOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    void finishSignOut();
  };

  const unavailable = (
    <SettingsNote
      tone={stateQ.isError ? "error" : "info"}
      message={stateQ.isError ? "The system is out of reach." : "Loading."}
      onRetry={stateQ.isError ? () => void stateQ.refetch() : undefined}
    />
  );

  const visibility = profile ? visibilityLabel(profile.identitySetting) : undefined;

  return (
    <Screen title="Settings" back>
      <SettingsSection label="ACCOUNT">
        <ListRow
          title="Account"
          subtitle={[profile?.username, user?.email].filter(Boolean).join(" · ") || undefined}
          chevron
          onPress={() => router.push("/settings/account")}
        />
        <ListRow
          title="Visibility"
          subtitle={visibility ? `${visibility.label}: ${visibility.description}` : undefined}
          trailing={<ExpandTrailing open={open === "identity"} />}
          onPress={() => toggle("identity")}
          accessibilityLabel={`Visibility${visibility ? `, ${visibility.label}` : ""}. ${open === "identity" ? "Collapse" : "Expand"}`}
        />
        {open === "identity" ? (
          <SettingsPanel>
            {profile
              ? IDENTITY_OPTIONS.map((opt) => {
                  const active = profile.identitySetting === opt.value;
                  return (
                    <ListRow
                      key={opt.value}
                      title={opt.label}
                      subtitle={opt.description}
                      trailing={active ? <Feather name="check" size={20} color={colors.primary} /> : null}
                      accessibilityLabel={`${opt.label}${active ? ", current" : ""}. ${opt.description}`}
                      onPress={saving || active ? undefined : () => void save(() => settingsActions.updateIdentity(opt.value as IdentitySetting), "identity")}
                    />
                  );
                })
              : unavailable}
          </SettingsPanel>
        ) : null}
      </SettingsSection>

      <SettingsSection label="SCHEDULE">
        <ListRow
          title="Briefing times"
          subtitle="Morning briefing and nightly debrief"
          trailing={<ExpandTrailing value={profile ? `${profile.morningTime} / ${profile.nightlyTime}` : undefined} open={open === "schedule"} />}
          onPress={() => toggle("schedule")}
        />
        {open === "schedule" ? (
          <SettingsPanel>
            {profile ? (
              <>
                <Text style={[type.label, { color: colors.mutedForeground }]}>MORNING BRIEFING</Text>
                <ChoiceChips options={MORNING_TIMES} value={morningValue} onChange={setMorning} />
                <Text style={[type.label, s.gapAbove, { color: colors.mutedForeground }]}>NIGHTLY DEBRIEF</Text>
                <ChoiceChips options={NIGHTLY_TIMES} value={nightlyValue} onChange={setNightly} />
                <Button
                  label="Save times"
                  block
                  loading={saving}
                  disabled={!scheduleChanged}
                  onPress={() => void save(() => settingsActions.updateSchedule({ morningTime: morningValue, nightlyTime: nightlyValue }), "schedule")}
                  style={s.gapAbove}
                />
              </>
            ) : (
              unavailable
            )}
          </SettingsPanel>
        ) : null}
      </SettingsSection>

      {error ? <SettingsNote message={error} /> : null}

      <SettingsSection label="PREFERENCES">
        <ListRow title="Notifications" chevron onPress={() => router.push("/settings/notifications")} />
        <ListRow
          title="Life context"
          subtitle={profile?.season ? "Season active" : "Shapes the quests, never the score"}
          chevron
          onPress={() => router.push("/settings/life")}
        />
        <ListRow title="Custom stats" chevron onPress={() => router.push("/custom")} />
      </SettingsSection>

      <SettingsSection label="HELP AND LEGAL">
        <ListRow title="Need support?" chevron onPress={() => router.push("/settings/support")} />
        <ListRow title="Terms" chevron onPress={() => router.push("/legal/terms")} />
        <ListRow title="Privacy" chevron onPress={() => router.push("/legal/privacy")} />
        <ListRow title="Open-source licences" chevron onPress={() => router.push("/legal/licenses")} />
      </SettingsSection>

      <SettingsSection label="DATA">
        <ListRow
          title="Export my data"
          subtitle="Everything you have logged, as text"
          trailing={exporting ? <ActivityIndicator color={colors.primary} /> : null}
          onPress={exporting ? undefined : () => void exportData()}
        />
        <ListRow
          title="Sign out"
          trailing={signingOut ? <ActivityIndicator color={colors.primary} /> : null}
          onPress={signingOut ? undefined : () => void handleSignOut()}
        />
        {unsent !== null ? (
          <SettingsPanel>
            <SettingsNote message={`${unsent} ${unsent === 1 ? "entry has" : "entries have"} not reached the System. Signing out erases them.`} />
            <Button label="Sign out anyway" variant="destructive" block loading={signingOut} onPress={confirmSignOut} />
            <Button label="Cancel" variant="text" block onPress={() => setUnsent(null)} />
          </SettingsPanel>
        ) : null}
      </SettingsSection>

      {exportNote ? <SettingsNote tone="info" message={exportNote} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  gapAbove: { marginTop: space.sm },
});
