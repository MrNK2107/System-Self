import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { CodenameCard, shareCodename } from "@/components/CodenameCard";
import { Separator, SettingsCard, SettingsRow } from "@/components/SettingsParts";
import { IDENTITY_OPTIONS } from "@/constants/identity";
import { useAuth } from "@/context/AuthContext";
import { useGym } from "@/features/gym/context/GymContext";
import { useColors } from "@/hooks/useColors";
import { useGameStateQuery } from "@/hooks/useGameState";
import { getOutbox } from "@/lib/api/outbox";
import { pendingLocalCount } from "@/lib/api/user-scope";
import { applyProfile } from "@/lib/onboarding/actions";
import { describeSettingsError, type IdentitySetting } from "@/lib/settings/actions";
import { settingsActions } from "@/lib/settings/instance";

const MORNING_TIMES = ["05:00", "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "09:00"];
const NIGHTLY_TIMES = ["19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];

function TimeChips({ times, selected, onSelect }: { times: string[]; selected: string; onSelect: (t: string) => void }) {
  const colors = useColors();
  return (
    <View style={s.chips}>
      {times.map((t) => {
        const active = selected === t;
        return (
          <TouchableOpacity
            key={t}
            onPress={() => onSelect(t)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              s.chip,
              { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}20` : "transparent" },
            ]}
          >
            <Text style={[s.chipText, { color: active ? colors.primary : colors.mutedForeground }]}>{t}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

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
    <AuthNotice
      tone={stateQ.isError ? "error" : "info"}
      message={stateQ.isError ? "The system is out of reach." : "Loading."}
      onRetry={stateQ.isError ? () => void stateQ.refetch() : undefined}
    />
  );

  return (
    <AuthShell tag="SETTINGS" title="Settings" back>
      <SettingsCard>
        <SettingsRow icon="user" label="Account" value={user?.email} onPress={() => router.push("/settings/account")} />
        <Separator />
        <SettingsRow
          icon="clock"
          label="Schedule"
          value={profile ? `${profile.morningTime} / ${profile.nightlyTime}` : undefined}
          trailing={open === "schedule" ? "chevron-up" : "chevron-down"}
          expanded={open === "schedule"}
          onPress={() => toggle("schedule")}
        />
        {open === "schedule" ? (
          <View style={s.panel}>
            {profile ? (
              <>
                <Text style={[s.panelLabel, { color: colors.mutedForeground }]}>MORNING BRIEFING</Text>
                <TimeChips times={MORNING_TIMES} selected={morningValue} onSelect={setMorning} />
                <Text style={[s.panelLabel, { color: colors.mutedForeground }]}>NIGHTLY DEBRIEF</Text>
                <TimeChips times={NIGHTLY_TIMES} selected={nightlyValue} onSelect={setNightly} />
                <AuthButton
                  label="SAVE SCHEDULE"
                  loading={saving}
                  disabled={!scheduleChanged}
                  onPress={() =>
                    void save(() => settingsActions.updateSchedule({ morningTime: morningValue, nightlyTime: nightlyValue }), "schedule")
                  }
                />
              </>
            ) : (
              unavailable
            )}
          </View>
        ) : null}
        <Separator />
        <SettingsRow
          icon="eye"
          label="Identity visibility"
          value={profile ? IDENTITY_OPTIONS.find((o) => o.value === profile.identitySetting)?.label : undefined}
          trailing={open === "identity" ? "chevron-up" : "chevron-down"}
          expanded={open === "identity"}
          onPress={() => toggle("identity")}
        />
        {open === "identity" ? (
          <View style={s.panel}>
            {profile
              ? IDENTITY_OPTIONS.map((opt) => {
                  const active = profile.identitySetting === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      disabled={saving}
                      onPress={() => !active && void save(() => settingsActions.updateIdentity(opt.value as IdentitySetting), "identity")}
                      activeOpacity={0.75}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, disabled: saving }}
                      style={[s.option, { borderColor: active ? colors.primary : colors.border, opacity: saving && !active ? 0.6 : 1 }]}
                    >
                      <Feather name={opt.icon} size={16} color={active ? colors.primary : colors.mutedForeground} />
                      <View style={s.optionText}>
                        <Text style={[s.optionLabel, { color: active ? colors.primary : colors.foreground }]}>{opt.label}</Text>
                        <Text style={[s.optionDesc, { color: colors.mutedForeground }]}>{opt.description}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              : unavailable}
          </View>
        ) : null}
        {profile ? (
          <>
            <Separator />
            {profile.identitySetting === "anonymous" ? (
              // Anonymous operators can't be searched: the codename is shown to copy, with no share action.
              <View style={s.codenameCopy}>
                <CodenameCard codename={profile.publicCodename} identity="anonymous" />
              </View>
            ) : (
              <SettingsRow
                icon="hash"
                label="Your codename"
                value={profile.publicCodename}
                trailing="share-2"
                onPress={() => void shareCodename(profile.publicCodename)}
              />
            )}
          </>
        ) : null}
      </SettingsCard>

      {error ? <AuthNotice message={error} /> : null}

      <SettingsCard>
        <SettingsRow icon="sliders" label="Custom stats" onPress={() => router.push("/custom")} />
        <Separator />
        <SettingsRow icon="sun" label="Life context" value={profile?.season ? "Season active" : undefined} onPress={() => router.push("/settings/life")} />
      </SettingsCard>

      <SettingsCard>
        <SettingsRow icon="life-buoy" label="Need support?" onPress={() => router.push("/settings/support")} />
        <Separator />
        <SettingsRow icon="file-text" label="Terms" onPress={() => router.push("/legal/terms")} />
        <Separator />
        <SettingsRow icon="shield" label="Privacy" onPress={() => router.push("/legal/privacy")} />
      </SettingsCard>

      <SettingsCard>
        <SettingsRow icon="log-out" label="Sign out" trailing={null} busy={signingOut} onPress={() => void handleSignOut()} />
      </SettingsCard>

      {unsent !== null ? (
        <View style={s.confirm}>
          <AuthNotice
            message={`${unsent} ${unsent === 1 ? "entry has" : "entries have"} not reached the System. Signing out erases them.`}
          />
          <AuthButton label="SIGN OUT ANYWAY" loading={signingOut} onPress={confirmSignOut} />
          <AuthLink label="CANCEL" onPress={() => setUnsent(null)} />
        </View>
      ) : null}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  panel: { paddingBottom: 16, gap: 12 },
  codenameCopy: { paddingVertical: 10 },
  confirm: { gap: 12 },
  panelLabel: { fontSize: 9, letterSpacing: 2.5, fontWeight: "700" as const },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: "600" as const, fontFamily: "monospace", letterSpacing: 0.5 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 4, padding: 12 },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 2 },
  optionDesc: { fontSize: 11, lineHeight: 16 },
});
