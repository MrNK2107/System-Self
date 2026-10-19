import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";

import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { SettingsCard } from "@/components/SettingsParts";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { describeSettingsError, validatePasswordChange } from "@/lib/settings/actions";
import { settingsActions } from "@/lib/settings/instance";
import { DELETE_KEEPS_SUBSCRIPTION_LINE, MANAGE_SUBSCRIPTION_LABEL, manageSubscriptionUrl } from "@/lib/billing/core";

const DELETE_WARNING = "This erases every log, score and rank. It cannot be undone.";

type Panel = "password" | "delete" | null;

export default function AccountScreen() {
  const colors = useColors();
  const { user, verifyEmail, changePassword, deleteAccount } = useAuth();
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

  return (
    <AuthShell tag="ACCOUNT" title="Account" back>
      <SettingsCard>
        <View style={s.emailRow}>
          <View style={s.emailText}>
            <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>EMAIL</Text>
            <Text style={[s.email, { color: colors.foreground }]} numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
          <View style={[s.badge, { borderColor: verified ? colors.primary : colors.border }]}>
            <Feather name={verified ? "check" : "alert-circle"} size={10} color={verified ? colors.primary : colors.mutedForeground} />
            <Text style={[s.badgeText, { color: verified ? colors.primary : colors.mutedForeground }]}>
              {verified ? "VERIFIED" : "UNVERIFIED"}
            </Text>
          </View>
        </View>
      </SettingsCard>

      {!verified ? (
        <View style={s.group}>
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
              <AuthButton label="VERIFY" loading={verifyBusy} onPress={() => void submitCode()} />
              <AuthLink label="Send a new code" onPress={() => void sendCode()} />
            </>
          ) : (
            <AuthButton label="VERIFY EMAIL" loading={verifyBusy} onPress={() => void sendCode()} />
          )}
          {verifyMsg ? <AuthNotice message={verifyMsg.text} tone={verifyMsg.tone} /> : null}
        </View>
      ) : null}

      <View style={s.group}>
        <AuthLink label={panel === "password" ? "Close" : "Change password"} onPress={() => toggle("password")} />
        {panel === "password" ? (
          <>
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
            <AuthButton label="CHANGE PASSWORD" loading={pwBusy} onPress={() => void submitPassword()} />
            {pwMsg ? <AuthNotice message={pwMsg.text} tone={pwMsg.tone} /> : null}
          </>
        ) : null}
      </View>

      <View style={[s.danger, { borderColor: colors.destructive }]}>
        <AuthLink label={panel === "delete" ? "Close" : "Delete account"} onPress={() => toggle("delete")} />
        {panel === "delete" ? (
          <>
            <Text style={[s.warning, { color: colors.foreground }]}>{DELETE_WARNING}</Text>
            <Text style={[s.warning, { color: colors.foreground }]}>{DELETE_KEEPS_SUBSCRIPTION_LINE}</Text>
            {manageUrl ? <AuthLink label={MANAGE_SUBSCRIPTION_LABEL} onPress={() => void Linking.openURL(manageUrl).catch(() => undefined)} /> : null}
            <AuthField
              label="PASSWORD"
              value={deletePw}
              onChangeText={setDeletePw}
              secret
              autoComplete="current-password"
              editable={!deleteBusy}
            />
            <AuthButton label="DELETE MY ACCOUNT" loading={deleteBusy} onPress={() => void submitDelete()} />
            {deleteError ? <AuthNotice message={deleteError} /> : null}
          </>
        ) : null}
      </View>
    </AuthShell>
  );
}

const s = StyleSheet.create({
  emailRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64 },
  emailText: { flex: 1, gap: 4 },
  fieldLabel: { fontSize: 9, letterSpacing: 2.5, fontWeight: "700" as const },
  email: { fontSize: 14 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 2, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { fontSize: 8, fontWeight: "700" as const, letterSpacing: 2 },
  group: { gap: 12 },
  danger: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 12 },
  warning: { fontSize: 13, lineHeight: 20 },
});
