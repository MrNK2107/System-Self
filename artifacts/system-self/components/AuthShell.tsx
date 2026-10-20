import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useOnline } from "@/lib/api/query";

interface AuthShellProps {
  tag: string;
  title: string;
  subtitle?: string;
  /** Show a back button in the app bar. */
  back?: boolean;
  children: ReactNode;
}

/** Shared frame for form screens: app bar (back + tag), offline bar, title, keyboard-safe scroll. */
export function AuthShell({ tag, title, subtitle, back, children }: AuthShellProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const online = useOnline();

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={{ paddingTop: insets.top, backgroundColor: colors.background }}>
        <View style={s.bar}>
          {back ? <IconButton icon="arrow-left" label="Back" onPress={() => router.back()} /> : <View style={s.side} />}
          <Text style={[type.label, s.tag, { color: colors.mutedForeground }]} numberOfLines={1}>
            {tag}
          </Text>
          <View style={s.side} />
        </View>
      </View>
      {!online ? (
        <View style={[s.offline, { backgroundColor: colors.muted }]} accessibilityLiveRegion="polite">
          <Feather name="wifi-off" size={16} color={colors.foreground} />
          <Text style={[type.meta, { color: colors.foreground }]}>Offline. A connection is required.</Text>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + space.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.titleBlock}>
          <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={[type.body, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
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
  /** Irreversible actions (account deletion) render in the destructive colour. */
  destructive?: boolean;
}

/** The form's primary action: the kit's full-width 48dp button. */
export function AuthButton({ label, onPress, loading, disabled, destructive }: AuthButtonProps) {
  return <Button label={label} onPress={onPress} loading={loading} disabled={disabled} variant={destructive ? "destructive" : "filled"} block />;
}

/** One line in SYSTEM voice: an error (destructive frame and icon, with RETRY when a retry can work) or info. */
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
  const error = tone === "error";
  return (
    <View
      style={[s.notice, { borderColor: error ? colors.destructive : colors.border, backgroundColor: colors.card }]}
      accessibilityLiveRegion="polite"
    >
      <Feather name={error ? "alert-circle" : "info"} size={18} color={error ? colors.destructive : colors.mutedForeground} />
      <Text style={[type.body, s.noticeText, { color: error ? colors.foreground : colors.mutedForeground }]}>{message}</Text>
      {onRetry ? <Button label="Retry" variant="text" onPress={onRetry} /> : null}
    </View>
  );
}

/** A secondary route out of the form (forgot password, create account): 48dp, ripple, accent label. */
export function AuthLink({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <View style={s.linkClip}>
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        android_ripple={{ color: "rgba(168,121,255,0.16)" }}
        style={s.link}
      >
        <Text style={[type.label, { color: colors.primary }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  bar: { height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs },
  side: { width: 48 },
  tag: { flex: 1, textAlign: "center" },
  offline: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 32, paddingHorizontal: space.md },
  scroll: { paddingHorizontal: space.md, paddingTop: space.lg, gap: space.md },
  titleBlock: { gap: space.sm, marginBottom: space.sm },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm + 4,
    borderWidth: 1,
    borderRadius: 4,
    paddingLeft: space.md,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    minHeight: 56,
  },
  noticeText: { flex: 1, paddingVertical: space.sm },
  linkClip: { borderRadius: 4, overflow: "hidden", alignSelf: "center" },
  link: { minHeight: 48, paddingHorizontal: space.md, alignItems: "center", justifyContent: "center" },
});
