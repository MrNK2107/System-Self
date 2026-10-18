import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useOnline } from "@/lib/api/query";

interface AuthShellProps {
  tag: string;
  title: string;
  subtitle?: string;
  /** Show a back chevron in the header. */
  back?: boolean;
  children: ReactNode;
}

/** Shared frame for the accounts screens: header tag, title, offline bar, keyboard-safe scroll. */
export function AuthShell({ tag, title, subtitle, back, children }: AuthShellProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const online = useOnline();

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[s.header, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <View style={s.side}>
          {back ? (
            <TouchableOpacity
              onPress={() => router.back()}
              style={s.back}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Feather name="chevron-left" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={[s.tag, { color: colors.subtle }]}>{tag}</Text>
        <View style={s.side} />
      </View>
      {!online ? (
        <View style={[s.offline, { backgroundColor: colors.muted }]}>
          <Text style={[s.offlineText, { color: colors.mutedForeground }]}>OFFLINE — CONNECTION REQUIRED</Text>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.titleBlock}>
          <Text style={[s.title, { color: colors.foreground }]}>{title}</Text>
          {subtitle ? <Text style={[s.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface AuthButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function AuthButton({ label, onPress, loading, disabled }: AuthButtonProps) {
  const colors = useColors();
  const inactive = disabled || loading;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={[s.button, { backgroundColor: inactive ? colors.muted : colors.primary }]}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryForeground} />
      ) : (
        <Text style={[s.buttonText, { color: inactive ? colors.subtle : colors.primaryForeground }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

/** One line of error in SYSTEM voice with an optional RETRY. */
export function AuthNotice({
  message,
  tone = "error",
  onRetry,
}: {
  message: string;
  tone?: "error" | "info";
  onRetry?: () => void;
}) {
  const colors = useColors();
  const color = tone === "error" ? colors.destructive : colors.mutedForeground;
  return (
    <View style={[s.notice, { borderColor: color }]}>
      <Text style={[s.noticeText, { color: tone === "error" ? colors.foreground : colors.mutedForeground }]}>
        {message}
      </Text>
      {onRetry ? (
        <TouchableOpacity onPress={onRetry} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[s.retry, { color: colors.primary }]}>RETRY</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function AuthLink({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="link"
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={s.link}
    >
      <Text style={[s.linkText, { color: colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { width: 36 },
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  tag: { flex: 1, textAlign: "center", fontSize: 9, letterSpacing: 3, fontWeight: "700" as const },
  offline: { paddingVertical: 4, alignItems: "center" },
  offlineText: { fontSize: 9, letterSpacing: 2, fontWeight: "700" as const },
  scroll: { paddingHorizontal: 16, paddingTop: 24, gap: 16 },
  titleBlock: { gap: 8, paddingHorizontal: 4, marginBottom: 4 },
  title: { fontSize: 28, fontWeight: "800" as const, lineHeight: 36, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, lineHeight: 20 },
  button: { borderRadius: 2, paddingVertical: 16, alignItems: "center", justifyContent: "center", minHeight: 50 },
  buttonText: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 3 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  retry: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 2 },
  link: { alignItems: "center", paddingVertical: 6 },
  linkText: { fontSize: 12, letterSpacing: 1, fontWeight: "600" as const },
});
