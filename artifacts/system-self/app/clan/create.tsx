// Found a clan (PRO + verified email). A 402 shows the PRO lock; a 403 email_unverified sends to email verification.
import React, { useState } from "react";
import { router } from "expo-router";
import { CLAN_DESCRIPTION_MAX } from "@workspace/contracts";
import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { ProLock } from "@/components/ProLock";
import { useClanActions } from "@/hooks/useClan";
import {
  SYNC_PENDING_MESSAGE,
  VERIFY_EMAIL_ROUTE,
  createErrorOutcome,
  normalizeTag,
  validateClanDraft,
  type CreateOutcome,
} from "@/lib/clan/clan";

export default function CreateClanScreen() {
  const actions = useClanActions();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CreateOutcome | null>(null);

  const submit = async () => {
    if (busy) return;
    const draft = { name, tag, description };
    const problem = validateClanDraft(draft);
    if (problem) return setOutcome({ kind: "error", message: problem });
    setBusy(true);
    setOutcome(null);
    try {
      const r = await actions.create(draft);
      if (!r.ok) setOutcome({ kind: "error", message: SYNC_PENDING_MESSAGE });
      else router.replace({ pathname: "/(tabs)/arena", params: { tab: "clan" } });
    } catch (e) {
      setOutcome(createErrorOutcome(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell tag="CLAN" title="Found a clan" subtitle="Clans hold 8 to 30 operators. Below 8 the clan is forming: no raids, no rank. Founding requires PRO and a verified email." back>
      <AuthField label="NAME" value={name} onChangeText={setName} placeholder="3–24 characters" autoCapitalize="words" maxLength={24} />
      <AuthField label="TAG" value={tag} onChangeText={(t) => setTag(normalizeTag(t))} placeholder="2–5 letters" autoCapitalize="characters" mono />
      <AuthField
        label="DESCRIPTION (OPTIONAL)"
        value={description}
        onChangeText={setDescription}
        placeholder={`Up to ${CLAN_DESCRIPTION_MAX} characters`}
        maxLength={CLAN_DESCRIPTION_MAX}
        multiline
      />
      {outcome?.kind === "pro" ? <ProLock label="FOUND A CLAN" /> : null}
      {outcome?.kind === "verify_email" ? (
        <>
          <AuthNotice message="Verify your email to found a clan." />
          <AuthLink label="VERIFY EMAIL" onPress={() => router.push(VERIFY_EMAIL_ROUTE)} />
        </>
      ) : null}
      {outcome?.kind === "error" ? <AuthNotice message={outcome.message} /> : null}
      <AuthButton label="FOUND CLAN" onPress={() => void submit()} loading={busy} />
    </AuthShell>
  );
}
