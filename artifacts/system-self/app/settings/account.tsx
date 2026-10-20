import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Linking, Platform, StyleSheet, Text } from "react-native";

import { AuthField } from "@/components/AuthField";
import { shareCodename } from "@/components/CodenameCard";
import { ExpandTrailing, SettingsNote, SettingsPanel, SettingsSection } from "@/components/SettingsParts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { type } from "@/constants/type";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useGameStateQuery } from "@/hooks/useGameState";
import { DELETE_KEEPS_SUBSCRIPTION_LINE, MANAGE_SUBSCRIPTION_LABEL, manageSubscriptionUrl } from "@/lib/billing/core";
import { describeSettingsError, validatePasswordChange } from "@/lib/settings/actions";
import { settingsActions } from "@/lib/settings/instance";
import { codenameShareOptions } from "@/lib/social/social";

const DELETE_WARNING = "This erases every log, score and rank. It cannot be undone.";

type Panel = "verify" | "password" | "delete" | null;

export default function AccountScreen() {
  const colors = useColors();
  const { user, verifyEmail, changePassword, deleteAccount } = useAuth();
  const profile = useGameStateQuery().data?.profile ?? null;
  const verified = !!user?.emailVerified;

  const [panel, setPanel] = useState<Panel>(null);

  // Email verification
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{ text: string; tone: "error" | "info" } | null>(null);

  // Password change
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ text: string; tone: "error" | "info" } | null>(null);

  // Account deletion
  const [deletePw, setDeletePw] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sendCode = async () => {
    if (verifyBusy) return;
    setVerifyBusy(true);
    setVerifyMsg(null);
    try {
      await settingsActions.requestEmailVerification();
      setCodeSent(true);
      setVerifyMsg({ text: `A code was sent to ${user?.email ?? "your email"}.`, tone: "info" });
    } catch (e) {
      setVerifyMsg({ text: describeSettingsError(e, "verify-request").message, tone: "error" });
    } finally {
      setVerifyBusy(false);
    }
  };

  const submitCode = async () => {
    if (verifyBusy) return;
    if (code.trim().length === 0) {
      setVerifyMsg({ text: "Enter the code from your email.", tone: "error" });
      return;
    }
    setVerifyBusy(true);
    setVerifyMsg(null);
    try {
      await verifyEmail(code);
      setCodeSent(false);
      setCode("");
      setPanel(null);
    } catch (e) {
      setVerifyMsg({ text: describeSettingsError(e, "verify").message, tone: "error" });
    } finally {
      setVerifyBusy(false);
    }
  };

  const submitPassword = async () => {
    if (pwBusy) return;
    const problem = validatePasswordChange(currentPw, newPw);
    if (problem) {
      setPwMsg({ text: problem, tone: "error" });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    try {
      await changePassword(currentPw, newPw);
      setCurrentPw("");
      setNewPw("");
      setPwMsg({ text: "Password changed. Other devices are signed out.", tone: "info" });
    } catch (e) {
      setPwMsg({ text: describeSettingsError(e, "password").message, tone: "error" });
    } finally {
      setPwBusy(false);
    }
  };

  const submitDelete = async () => {
    if (deleteBusy) return;
    if (!deletePw) {
      setDeleteError("Enter your password to confirm.");
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount(deletePw);
      router.replace("/auth/sign-in");
    } catch (e) {
      setDeleteError(describeSettingsError(e, "delete").message);
      setDeleteBusy(false);
    }
  };

  const manageUrl = manageSubscriptionUrl(Platform.OS);
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const share = profile ? codenameShareOptions(profile.identitySetting) : null;

  return (
    <Screen title="Account" back>
      <SettingsSection
        label="IDENTITY"
        footer={
          profile
            ? [
                profile.codename !== profile.username ? "Rival codename: what rivals see. It changes with your rank." : null,
                share?.note ?? "Search codename: how other players find you. Tap it to share.",
              ]
                .filter(Boolean)
                .join(" ")
            : undefined
        }
      >
        <ListRow
          title="Email"
          subtitle={user?.email ?? undefined}
          trailing={
            <Text style={[type.label, { color: verified ? colors.success : colors.warn }]}>{verified ? "VERIFIED" : "UNVERIFIED"}</Text>
          }
        />
        {!verified ? (
          <>
            <ListRow
              title="Verify email"
              subtitle="A code is sent to the address above"
              trailing={<ExpandTrailing open={panel === "verify"} />}
              onPress={() => toggle("verify")}
            />
            {panel === "verify" ? (
              <SettingsPanel>
                {codeSent ? (
                  <>
                    <AuthField
                      label="VERIFICATION CODE"
                      value={code}
                      onChangeText={setCode}
                      keyboardType="number-pad"
                      autoComplete="one-time-code"
                      maxLength={12}
                      mono
                      editable={!verifyBusy}
                    />
                    <Button label="Verify" block loading={verifyBusy} onPress={() => void submitCode()} />
                    <Button label="Send a new code" variant="text" block disabled={verifyBusy} onPress={() => void sendCode()} />
                  </>
                ) : (
                  <Button label="Send code" block loading={verifyBusy} onPress={() => void sendCode()} />
                )}
                {verifyMsg ? <SettingsNote message={verifyMsg.text} tone={verifyMsg.tone} /> : null}
              </SettingsPanel>
            ) : null}
          </>
        ) : null}
        <ListRow title="Username" subtitle={profile ? profile.username : "Loading."} />
        {profile && profile.codename !== profile.username ? (
          <ListRow title="Rival codename" subtitle={profile.codename} />
        ) : null}
        {profile ? (
          <ListRow
            title="Search codename"
            subtitle={profile.publicCodename}
            trailing={share?.canShare ? <Feather name="share-2" size={20} color={colors.primary} /> : null}
            onPress={share?.canShare ? () => void shareCodename(profile.publicCodename) : undefined}
            accessibilityLabel={`Search codename, ${profile.publicCodename}${share?.canShare ? ". Share" : ""}`}
          />
        ) : null}
      </SettingsSection>

      <SettingsSection label="SECURITY">
        <ListRow title="Change password" trailing={<ExpandTrailing open={panel === "password"} />} onPress={() => toggle("password")} />
        {panel === "password" ? (
          <SettingsPanel>
            <AuthField
              label="CURRENT PASSWORD"
              value={currentPw}
              onChangeText={setCurrentPw}
              secret
              autoComplete="current-password"
              editable={!pwBusy}
            />
            <AuthField
              label="NEW PASSWORD"
              value={newPw}
              onChangeText={setNewPw}
              secret
              autoComplete="new-password"
              hint="At least 10 characters."
              editable={!pwBusy}
            />
            <Button label="Change password" block loading={pwBusy} onPress={() => void submitPassword()} />
            {pwMsg ? <SettingsNote message={pwMsg.text} tone={pwMsg.tone} /> : null}
          </SettingsPanel>
        ) : null}
      </SettingsSection>

      <SettingsSection label="DELETE ACCOUNT">
        <ListRow
          title="Delete account"
          subtitle="Erases everything. Cannot be undone."
          trailing={<ExpandTrailing open={panel === "delete"} />}
          onPress={() => toggle("delete")}
        />
        {panel === "delete" ? (
          <SettingsPanel>
            <Text style={[type.body, { color: colors.foreground }]}>{DELETE_WARNING}</Text>
            <Text style={[type.body, { color: colors.mutedForeground }]}>{DELETE_KEEPS_SUBSCRIPTION_LINE}</Text>
            {manageUrl ? (
              <Button
                label={MANAGE_SUBSCRIPTION_LABEL}
                variant="text"
                onPress={() => void Linking.openURL(manageUrl).catch(() => undefined)}
                style={s.start}
              />
            ) : null}
            <AuthField
              label="PASSWORD"
              value={deletePw}
              onChangeText={setDeletePw}
              secret
              autoComplete="current-password"
              editable={!deleteBusy}
            />
            <Button label="Delete my account" variant="destructive" block loading={deleteBusy} onPress={() => void submitDelete()} />
            {deleteError ? <SettingsNote message={deleteError} /> : null}
          </SettingsPanel>
        ) : null}
      </SettingsSection>
    </Screen>
  );
}

const s = StyleSheet.create({
  start: { alignSelf: "flex-start" },
});
