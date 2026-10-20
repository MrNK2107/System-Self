import { Feather } from "@expo/vector-icons";
import React, { type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { TOTAL_STEPS, stepNumber, type OnboardingStep } from "@/lib/onboarding/steps";

interface OnboardingFrameProps {
  step: OnboardingStep;
  /** App bar back action. Omit for none. */
  onBack?: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** The footer's primary action. */
  action: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean };
  /** Shown above the action while it is locked: what is still missing. */
  hint?: string | null;
  /** Extra footer content above the action (an error line). */
  footerTop?: ReactNode;
}

/**
 * One onboarding step: an app bar with back and a legible step indicator, one title, the step's content,
 * and a fixed footer holding the single primary action.
 */
export function OnboardingFrame({ step, onBack, title, subtitle, children, action, hint, footerTop }: OnboardingFrameProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const n = stepNumber(step);

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={{ paddingTop: insets.top, backgroundColor: colors.background }}>
        <View style={s.barRow}>
          {onBack ? <IconButton icon="arrow-left" label="Back" onPress={onBack} /> : <View style={s.barGap} />}
          <Text
            style={[type.label, s.barLabel, { color: colors.mutedForeground }]}
            accessibilityLabel={`Step ${n} of ${TOTAL_STEPS}`}
          >
            {`STEP ${n} OF ${TOTAL_STEPS}`}
          </Text>
          <View style={s.barGap} />
        </View>
        <View style={s.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View key={i} style={[s.seg, { backgroundColor: i < n ? colors.primary : colors.border }]} />
          ))}
        </View>
      </View>

      <ScrollView
        style={s.flex}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.head}>
          <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={[type.body, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + space.md, borderTopColor: colors.border }]}>
        {footerTop}
        {hint && action.disabled ? (
          <Text style={[type.meta, s.hint, { color: colors.mutedForeground }]} accessibilityLiveRegion="polite">
            {hint}
          </Text>
        ) : null}
        <Button label={action.label} onPress={action.onPress} disabled={action.disabled} loading={action.loading} block />
      </View>
    </KeyboardAvoidingView>
  );
}

interface OptionRowProps {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  /** Domain colour dot before the title. */
  dot?: string;
  /** "radio" (one of many, default) or "checkbox" (on/off). */
  kind?: "radio" | "checkbox";
}

/** A ListRow-shaped choice: 64dp, ripple, hairline divider, radio or checkbox mark on the right. */
export function OptionRow({ title, subtitle, selected, onPress, dot, kind = "radio" }: OptionRowProps) {
  const colors = useColors();
  const icon = kind === "radio" ? (selected ? "check-circle" : "circle") : selected ? "check-square" : "square";
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: "rgba(168,121,255,0.12)" }}
      accessibilityRole={kind}
      accessibilityState={kind === "radio" ? { selected } : { checked: selected }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={[s.row, { borderBottomColor: colors.border }]}
    >
      {dot ? <View style={[s.dot, { backgroundColor: dot }]} /> : null}
      <View style={s.rowText}>
        <Text style={[selected ? type.bodyStrong : type.body, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? <Text style={[type.meta, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      <Feather name={icon} size={22} color={selected ? colors.primary : colors.subtle} />
    </Pressable>
  );
}

/** A group of OptionRows with a top hairline so the list reads as one block. */
export function OptionList({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={[s.list, { borderTopColor: colors.border }]}>{children}</View>;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  barRow: { height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs },
  barGap: { width: 48 },
  barLabel: { flex: 1, textAlign: "center" },
  track: { flexDirection: "row", gap: space.xs, paddingHorizontal: space.md, paddingBottom: space.sm },
  seg: { flex: 1, height: 3, borderRadius: 2 },
  content: { paddingHorizontal: space.md, paddingTop: space.lg, paddingBottom: space.xl, gap: space.lg },
  head: { gap: space.sm },
  footer: { paddingHorizontal: space.md, paddingTop: space.md, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  hint: { textAlign: "center" },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowText: { flex: 1, gap: 2 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: -space.md },
});
