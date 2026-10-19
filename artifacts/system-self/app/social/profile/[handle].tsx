import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { RankBadge } from "@/components/RankBadge";
import { ChallengeComposer } from "@/components/ChallengeComposer";
import { ReportSheet } from "@/components/ReportSheet";
import { SettingsCard } from "@/components/SettingsParts";
import { useColors } from "@/hooks/useColors";
import { useSocialActions, useSocialProfileQuery } from "@/hooks/useSocial";
import { describeSocialError, profileSummary } from "@/lib/social/social";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

type Sent = { ok: true } | { ok: false; reason: "sync_pending" };

export default function SocialProfileScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ handle?: string | string[] }>();
  const handle = (Array.isArray(params.handle) ? params.handle[0] : params.handle) ?? "";
  const q = useSocialProfileQuery(handle);
  const actions = useSocialActions();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

  const view = q.data ?? null;
  const summary = view ? profileSummary(view.profile) : null;

  const run = async (fn: () => Promise<Sent>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(SYNC_PENDING);
      else after?.();
    } catch (e) {
      setError(describeSocialError(e));
    } finally {
      setBusy(false);
    }
  };

  const sendReport = async (reason: string) => {
    if (busy) return;
    setBusy(true);
    setReportError(null);
    try {
      const r = await actions.report(handle, reason);
      if (!r.ok) setReportError(SYNC_PENDING);
      else {
        setReporting(false);
        setReported(true);
      }
    } catch (e) {
      setReportError(describeSocialError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell tag="PLAYER" title={view?.profile.handle ?? "Player"} subtitle={view?.profile.isCodename ? "Public codename." : undefined} back>
      {q.isError ? (
        <AuthNotice message={describeSocialError(q.error)} onRetry={() => void q.refetch()} />
      ) : !view || !summary ? (
        <AuthNotice tone="info" message="Loading." />
      ) : (
        <>
          <SettingsCard>
            <View style={s.panel}>
              <View style={s.rankRow}>
                <RankBadge rank={view.profile.rank} size="md" />
                <View style={s.rankText}>
                  <Text style={[s.line, { color: colors.foreground }]}>{summary.rankLine}</Text>
                  <Text style={[s.hint, { color: colors.mutedForeground }]}>{summary.trajectoryLine}</Text>
                  {summary.shadowLine ? <Text style={[s.hint, { color: colors.mutedForeground }]}>{summary.shadowLine}</Text> : null}
                </View>
              </View>
              {summary.scores ? (
                <View style={s.scores}>
                  {summary.scores.map((x) => (
                    <View key={x.domain} style={s.scoreRow}>
                      <Text style={[s.hint, { color: colors.mutedForeground }]}>{x.domain}</Text>
                      <Text style={[s.line, { color: colors.foreground }]}>{x.value}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </SettingsCard>

          {error ? <AuthNotice message={error} /> : null}
          {reported ? <AuthNotice tone="info" message="Report received. It will be reviewed." /> : null}

          {view.isSelf ? (
            <AuthNotice tone="info" message="This is you." />
          ) : (
            <>
            {view.following ? (
              <AuthButton label="UNFOLLOW" loading={busy} onPress={() => void run(() => actions.unfollow(handle))} />
            ) : (
              <AuthButton label="FOLLOW" loading={busy} onPress={() => void run(() => actions.follow(handle))} />
            )}

            {view.following ? <ChallengeComposer opponent={view.profile.handle} /> : null}

            {confirmBlock ? (
              <View style={s.confirm}>
                <Text style={[s.hint, { color: colors.mutedForeground }]}>
                  Blocking removes follows both ways. They will not find you, follow you or be matched with you.
                </Text>
                <AuthButton
                  label="CONFIRM BLOCK"
                  loading={busy}
                  onPress={() =>
                    void run(
                      () => actions.block(handle),
                      () => router.back(),
                    )
                  }
                />
                <AuthLink label="CANCEL" onPress={() => setConfirmBlock(false)} />
              </View>
            ) : (
              <AuthLink label="BLOCK" onPress={() => setConfirmBlock(true)} />
            )}
            <AuthLink
              label="REPORT"
              onPress={() => {
                setReportError(null);
                setReporting(true);
              }}
            />
            </>
          )}
        </>
      )}
      <ReportSheet
        visible={reporting}
        handle={view?.profile.handle ?? handle}
        busy={busy}
        error={reportError}
        onCancel={() => setReporting(false)}
        onConfirm={(reason) => void sendReport(reason)}
      />
    </AuthShell>
  );
}

const s = StyleSheet.create({
  panel: { paddingVertical: 14, gap: 14 },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  rankText: { gap: 3, flex: 1 },
  line: { fontSize: 13, fontWeight: "700" as const, letterSpacing: 0.5 },
  hint: { fontSize: 10, letterSpacing: 1.5, fontWeight: "600" as const },
  scores: { gap: 8 },
  scoreRow: { flexDirection: "row", justifyContent: "space-between" },
  confirm: { gap: 8 },
});
