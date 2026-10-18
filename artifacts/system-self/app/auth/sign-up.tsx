import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { deviceTimezone, useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { describeAuthError, isRetryable, validateSignUp, type SignUpField } from "@/lib/auth/actions";

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
      />

      <View style={styles.termsWrap}>
        <TouchableOpacity
          style={styles.termsRow}
          onPress={() => {
            setAcceptTerms((a) => !a);
            clear("acceptTerms");
          }}
          activeOpacity={0.8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acceptTerms }}
          accessibilityLabel="I accept the Terms and Privacy Policy"
        >
          <View
            style={[
              styles.box,
              {
                borderColor: fieldErrors.acceptTerms ? colors.destructive : acceptTerms ? colors.primary : colors.border,
                backgroundColor: acceptTerms ? colors.primary : "transparent",
              },
            ]}
          >
            {acceptTerms ? <Feather name="check" size={12} color={colors.primaryForeground} /> : null}
          </View>
          <Text style={[styles.termsText, { color: colors.mutedForeground }]}>
            I accept the{" "}
            <Text style={{ color: colors.primary }} onPress={() => router.push("/legal/terms")}>
              Terms
            </Text>{" "}
            and{" "}
            <Text style={{ color: colors.primary }} onPress={() => router.push("/legal/privacy")}>
              Privacy Policy
            </Text>
          </Text>
        </TouchableOpacity>
        {fieldErrors.acceptTerms ? (
          <Text style={[styles.termsError, { color: colors.destructive }]}>{fieldErrors.acceptTerms}</Text>
        ) : null}
      </View>

      {formError ? <AuthNotice message={formError.message} onRetry={formError.retry ? submit : undefined} /> : null}
      <AuthButton label="CREATE ACCOUNT" onPress={submit} loading={busy} />
      <AuthLink label="ALREADY REGISTERED. SIGN IN" onPress={() => router.replace("/auth/sign-in")} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  termsWrap: { gap: 6 },
  termsRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  box: { width: 20, height: 20, borderWidth: 1, borderRadius: 2, alignItems: "center", justifyContent: "center" },
  termsText: { flex: 1, fontSize: 12, lineHeight: 18 },
  termsError: { fontSize: 12, lineHeight: 17 },
});
