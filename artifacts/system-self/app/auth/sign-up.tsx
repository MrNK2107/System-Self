import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { deviceTimezone, useAuth } from "@/context/AuthContext";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { MAX_EMAIL_LENGTH, describeAuthError, isRetryable, validateSignUp, type SignUpField } from "@/lib/auth/actions";

type FieldErrors = Partial<Record<SignUpField, string>>;

export default function SignUpScreen() {
  const colors = useColors();
  const { signUp } = useAuth();
  const passwordRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<{ message: string; retry: boolean } | null>(null);

  const clear = (field: SignUpField) => setFieldErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  const submit = async () => {
    if (busy) return;
    const errors = validateSignUp({ email, password, username, birthYear, acceptTerms });
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      await signUp({
        email,
        password,
        username,
        birthYear: Number(birthYear),
        acceptTerms: true,
        timezone: deviceTimezone(),
      });
      router.replace("/");
    } catch (e) {
      const info = describeAuthError(e, "sign_up");
      if (info.field) setFieldErrors({ [info.field]: info.message });
      else setFormError({ message: info.message, retry: isRetryable(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell tag="NEW OPERATIVE" title="IDENTIFY YOURSELF." subtitle="One account. Every device." back>
      <AuthField
        label="EMAIL"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          clear("email");
        }}
        error={fieldErrors.email}
        keyboardType="email-address"
        maxLength={MAX_EMAIL_LENGTH}
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        blurOnSubmit={false}
      />
      <AuthField
        ref={passwordRef}
        label="PASSWORD"
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          clear("password");
        }}
        error={fieldErrors.password}
        hint="At least 10 characters."
        secret
        autoComplete="new-password"
        textContentType="newPassword"
        maxLength={128}
        returnKeyType="next"
        onSubmitEditing={() => usernameRef.current?.focus()}
        blurOnSubmit={false}
      />
      <AuthField
        ref={usernameRef}
        label="CODENAME"
        value={username}
        onChangeText={(v) => {
          setUsername(v.toLowerCase());
          clear("username");
        }}
        error={fieldErrors.username}
        hint="3 to 20 characters: a-z, 0-9, underscore."
        autoComplete="username-new"
        maxLength={20}
        returnKeyType="next"
        onSubmitEditing={() => yearRef.current?.focus()}
        blurOnSubmit={false}
      />
      <AuthField
        ref={yearRef}
        label="BIRTH YEAR"
        value={birthYear}
        onChangeText={(v) => {
          setBirthYear(v.replace(/\D/g, ""));
          clear("birthYear");
        }}
        error={fieldErrors.birthYear}
        mono
        keyboardType="number-pad"
        maxLength={4}
        placeholder="YYYY"
        returnKeyType="done"
        onSubmitEditing={submit}
      />

      <View style={styles.termsWrap}>
        <Pressable
          style={styles.termsRow}
          onPress={() => {
            setAcceptTerms((a) => !a);
            clear("acceptTerms");
          }}
          android_ripple={{ color: "rgba(168,121,255,0.12)" }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acceptTerms }}
          accessibilityLabel="I accept the Terms and Privacy Policy"
        >
          <Feather
            name={acceptTerms ? "check-square" : "square"}
            size={22}
            color={fieldErrors.acceptTerms ? colors.destructive : acceptTerms ? colors.primary : colors.mutedForeground}
          />
          <Text style={[type.body, styles.termsText, { color: colors.mutedForeground }]}>
            I accept the{" "}
            <Text style={{ color: colors.primary }} onPress={() => router.push("/legal/terms")}>
              Terms
            </Text>{" "}
            and{" "}
            <Text style={{ color: colors.primary }} onPress={() => router.push("/legal/privacy")}>
              Privacy Policy
            </Text>
          </Text>
        </Pressable>
        {fieldErrors.acceptTerms ? (
          <View style={styles.termsErrorRow}>
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={[type.meta, styles.termsText, { color: colors.destructive }]}>{fieldErrors.acceptTerms}</Text>
          </View>
        ) : null}
      </View>

      {formError ? <AuthNotice message={formError.message} onRetry={formError.retry ? submit : undefined} /> : null}
      <AuthButton label="CREATE ACCOUNT" onPress={submit} loading={busy} />
      <AuthLink label="ALREADY REGISTERED. SIGN IN" onPress={() => router.replace("/auth/sign-in")} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  termsWrap: { gap: space.xs },
  termsRow: { flexDirection: "row", alignItems: "center", gap: space.sm + 4, minHeight: 48, paddingVertical: space.xs },
  termsText: { flex: 1 },
  termsErrorRow: { flexDirection: "row", alignItems: "center", gap: space.xs + 2 },
});
