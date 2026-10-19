// Invite a player (from their social profile) to a Party of Two. The handle is exactly as shown to the viewer.
import React, { useState } from "react";
import { Text } from "react-native";
import { AuthButton, AuthNotice } from "@/components/AuthShell";
import { useColors } from "@/hooks/useColors";
import { useDuoActions } from "@/hooks/useDuo";
import { describeDuoError } from "@/lib/duo/duo";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

export function DuoInvite({ handle }: { handle: string }) {
  const colors = useColors();
  const actions = useDuoActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await actions.invite(handle);
      if (!r.ok) setError(SYNC_PENDING);
      else setSent(true);
    } catch (e) {
      setError(describeDuoError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error ? <AuthNotice message={error} /> : null}
      {sent ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 10, letterSpacing: 1.5, fontWeight: "600" }}>
          Invite sent. They answer on their Party of Two screen. No score effect.
        </Text>
      ) : (
        <AuthButton label="INVITE TO PARTY OF TWO" loading={busy} onPress={() => void send()} />
      )}
    </>
  );
}
