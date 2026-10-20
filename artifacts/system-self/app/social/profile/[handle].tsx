// A player as the server projects them: rank, trajectory, shadow and (where allowed) domain scores. Follow is the
// main action; challenge and the Party of Two invite follow it; block and report sit at the bottom.
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ChallengeComposer } from "@/components/ChallengeComposer";
import { DuoInvite } from "@/components/DuoInvite";
import { ReportSheet } from "@/components/ReportSheet";
import { Group, Notice, Section, Sheet } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { ALL_DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useSocialActions, useSocialProfileQuery } from "@/hooks/useSocial";
import { describeSocialError } from "@/lib/social/social";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";
const TRAJECTORY_WORDS: Record<string, string> = { up: "Rising", stable: "Steady", down: "Falling" };

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
  const [challenging, setChallenging] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

  const view = q.data ?? null;
  const p = view?.profile;

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
    <Screen title={p?.handle ?? "Player"} back>
      {q.isError ? (
        <Notice message={describeSocialError(q.error)} onRetry={() => void q.refetch()} />
      ) : !view || !p ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <>
          <View style={s.head}>
            <View style={s.flex}>
              <Text style={[type.bodyStrong, { color: colors.foreground }]}>Rank {p.rank}</Text>
              <Text style={[type.meta, { color: colors.mutedForeground }]}>
                {[TRAJECTORY_WORDS[p.trajectory] ?? p.trajectory, p.shadowActive ? "Shadow active" : null, p.isCodename ? "Public codename" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          </View>

          {p.scores ? (
            <Group>
              {ALL_DOMAINS.map((d) => (
                <ListRow
                  key={d}
                  title={d}
                  dot={DOMAIN_COLORS[d]}
                  trailing={<Text style={[type.number, { color: colors.foreground }]}>{(p.scores![d] ?? 0).toFixed(1)}</Text>}
                />
              ))}
            </Group>
          ) : null}

          {error ? <Notice message={error} /> : null}
          {reported ? <Notice tone="info" message="Report received. It will be reviewed." /> : null}

          {view.isSelf ? (
            <Notice tone="info" message="This is you." />
          ) : (
            <>
              <View style={s.actions}>
                {view.following ? (
                  <Button label="Unfollow" variant="tonal" block loading={busy} onPress={() => void run(() => actions.unfollow(handle))} />
                ) : (
                  <Button label="Follow" block loading={busy} onPress={() => void run(() => actions.follow(handle))} />
                )}
                {view.following ? <Button label="Challenge" block onPress={() => setChallenging(true)} /> : null}
                <DuoInvite handle={p.handle} />
              </View>

              <Section label="Safety">
                {confirmBlock ? (
                  <View style={s.actions}>
                    <Text style={[type.body, { color: colors.mutedForeground }]}>
                      Blocking removes follows both ways. They will not find you, follow you or be matched with you.
                    </Text>
                    <Button
                      label="Confirm block"
                      variant="destructive"
                      block
                      loading={busy}
                      onPress={() =>
                        void run(
                          () => actions.block(handle),
                          () => router.back(),
                        )
                      }
                    />
                    <Button label="Cancel" variant="text" block onPress={() => setConfirmBlock(false)} />
                  </View>
                ) : (
                  <Group>
                    <ListRow title="Block" subtitle="Remove follows both ways and stop matching" onPress={() => setConfirmBlock(true)} />
                    <ListRow
                      title="Report"
                      subtitle="Sent to review"
                      onPress={() => {
                        setReportError(null);
                        setReporting(true);
                      }}
                    />
                  </Group>
                )}
              </Section>
            </>
          )}
        </>
      )}

      {p && view?.following ? (
        <Sheet visible={challenging} title={`Challenge ${p.handle}`} onClose={() => setChallenging(false)}>
          <ChallengeComposer opponent={p.handle} />
        </Sheet>
      ) : null}

      <ReportSheet
        visible={reporting}
        handle={p?.handle ?? handle}
        busy={busy}
        error={reportError}
        onCancel={() => setReporting(false)}
        onConfirm={(reason) => void sendReport(reason)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  actions: { gap: space.sm },
});
