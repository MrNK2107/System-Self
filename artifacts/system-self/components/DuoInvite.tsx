// Invite a player (from their social profile) to a Party of Two. The handle is exactly as shown to the viewer.
import React, { useState } from "react";
import { Notice } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { useDuoActions } from "@/hooks/useDuo";
import { describeDuoError } from "@/lib/duo/duo";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

export function DuoInvite({ handle }: { handle: string }) {
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
      {error ? <Notice message={error} /> : null}
      {sent ? (
        <Notice tone="info" message="Invite sent. They answer on their Party of Two screen. No score effect." />
      ) : (
        <Button label="Invite to Party of Two" variant="tonal" block loading={busy} onPress={() => void send()} />
      )}
    </>
  );
}
