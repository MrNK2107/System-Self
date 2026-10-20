// Create a clan (PRO + verified email). A 402 shows the PRO lock; a 403 email_unverified sends to email verification.
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { CLAN_DESCRIPTION_MAX } from "@workspace/contracts";
import { AuthField } from "@/components/AuthField";
import { Notice } from "@/components/arena/parts";
import { ProLock } from "@/components/ProLock";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
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
  const colors = useColors();
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
    <Screen title="Create a clan" back>
      <Text style={[type.body, { color: colors.mutedForeground }]}>
        Name it and recruit. At 8 operators it starts raiding and ranking. Creating a clan needs PRO and a verified email.
      </Text>
      <View style={s.form}>
        <AuthField label="NAME" value={name} onChangeText={setName} placeholder="3–24 characters" autoCapitalize="words" maxLength={24} />
        <AuthField label="TAG" value={tag} onChangeText={(t) => setTag(normalizeTag(t))} placeholder="2–5 letters" autoCapitalize="characters" />
        <AuthField
          label="DESCRIPTION (OPTIONAL)"
          value={description}
          onChangeText={setDescription}
          placeholder={`Up to ${CLAN_DESCRIPTION_MAX} characters`}
          maxLength={CLAN_DESCRIPTION_MAX}
          multiline
        />
      </View>
      {outcome?.kind === "pro" ? <ProLock label="CREATE A CLAN" /> : null}
      {outcome?.kind === "verify_email" ? (
        <>
          <Notice message="Verify your email to create a clan." />
          <Button label="Verify email" variant="tonal" onPress={() => router.push(VERIFY_EMAIL_ROUTE)} />
        </>
      ) : null}
      {outcome?.kind === "error" ? <Notice message={outcome.message} /> : null}
      <Button label="Create clan" block loading={busy} onPress={() => void submit()} />
    </Screen>
  );
}

const s = StyleSheet.create({
  form: { gap: space.md },
});
