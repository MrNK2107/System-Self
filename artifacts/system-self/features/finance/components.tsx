// Small pieces shared by the finance screens (app/finance/*), built locally because the kit has no progress bar,
// status line or request helper. Text inputs reuse the gym's TextField (features/gym/components/Fields).
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { describeFinanceError } from "@/lib/finance/finance";
import type { MutationResult } from "@/lib/game/actions";

export const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

/** Thin spent/limit or saved/target bar in the WEALTH colour (destructive when over). */
export function Bar({ fraction, over }: { fraction: number; over?: boolean }) {
  const colors = useColors();
  return (
    <View style={[s.track, { backgroundColor: colors.muted }]}>
      <View style={[s.fill, { width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`, backgroundColor: over ? colors.destructive : colors.domain.WEALTH }]} />
    </View>
  );
}

/** A one-line result under a form: info in muted text, errors in destructive. */
export function StatusLine({ notice }: { notice: { tone: "info" | "error"; message: string } | null }) {
  const colors = useColors();
  if (!notice) return null;
  return (
    <Text style={[type.body, { color: notice.tone === "error" ? colors.destructive : colors.mutedForeground }]} accessibilityLiveRegion="polite">
      {notice.message}
    </Text>
  );
}

/** Loading, or the request's failure as a System line with Retry. */
export function LoadState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const colors = useColors();
  if (!error) return <Text style={[type.body, { color: colors.mutedForeground }]}>Loading.</Text>;
  return (
    <SystemWindow>
      <Text style={[type.title, { color: colors.foreground }]}>{describeFinanceError(error)}</Text>
      <Button label="Retry" onPress={onRetry} />
    </SystemWindow>
  );
}

/** Runs one finance mutation at a time and turns its outcome into a status line. */
export function useAttempt() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; message: string } | null>(null);
  const attempt = async (send: () => Promise<MutationResult<unknown>>, done?: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setNotice(null);
    try {
      const r = await send();
      if (!r.ok) setNotice({ tone: "error", message: SYNC_PENDING });
      else if (done) setNotice({ tone: "info", message: done });
      return r.ok;
    } catch (e) {
      setNotice({ tone: "error", message: describeFinanceError(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const fail = (message: string) => setNotice({ tone: "error", message });
  return { busy, notice, attempt, fail };
}

const s = StyleSheet.create({
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
});
