// Arena building blocks the kit does not have: a bottom sheet, a grouped list, a section, a notice line, choice
// chips, a rank mark and a gap figure coloured by meaning. Local to the Arena (components/ui stays untouched).
import { useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RankEmblem } from "@/components/ui/RankEmblem";
import { IconButton } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import type { Gap, GapTone } from "@/lib/social/arena";

/** Pull-to-refresh for a screen that hosts a panel: refetches every query the mounted panel is watching. */
export function usePullRefresh() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);
  return { refreshing, onRefresh: () => void onRefresh() };
}

/** Lead = success, trail = destructive, level = muted. Never green for a deficit. */
export function useToneColor() {
  const colors = useColors();
  return (tone: GapTone) => (tone === "lead" ? colors.success : tone === "trail" ? colors.destructive : colors.mutedForeground);
}

/** A signed gap figure in the row-number style, coloured by what it means for the user. */
export function GapFigure({ gap, size = "number" }: { gap: Gap; size?: "number" | "meta" }) {
  const tone = useToneColor();
  return (
    <Text style={[size === "number" ? type.number : type.bodyStrong, { color: tone(gap.tone) }]} accessibilityLabel={`Gap ${gap.label}`}>
      {gap.label}
    </Text>
  );
}

/** Bottom sheet: slides up over a dimmed backdrop; Android Back and a tap outside close it. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  dismissable = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** False while a request is in flight. */
  dismissable?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const close = () => {
    if (dismissable) onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.fill}>
        <Pressable style={s.backdrop} onPress={close} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + space.md }]}>
          <View style={s.head}>
            <Text style={[type.title, s.headTitle, { color: colors.foreground }]} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            <IconButton icon="x" label="Close" onPress={close} />
          </View>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A titled block of the page. The label is the heading; more space sits above it than below. */
export function Section({ label, children, trailing }: { label: string; children: ReactNode; trailing?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={[isCaps(label) ? type.label : type.bodyStrong, s.flex, { color: colors.mutedForeground }]} accessibilityRole="header">
          {label}
        </Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** Rows grouped on one surface (ListRow draws the hairlines between them). */
export function Group({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={[s.group, { backgroundColor: colors.card, borderColor: colors.border }]}>{children}</View>;
}

/** One line from THE SYSTEM: an error (with RETRY) or plain information. */
export function Notice({ message, tone = "error", onRetry }: { message: string; tone?: "error" | "info"; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View style={s.notice} accessibilityLiveRegion="polite">
      <Text style={[type.body, s.flex, { color: tone === "error" ? colors.destructive : colors.mutedForeground }]}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" android_ripple={{ color: "rgba(168,121,255,0.18)" }} style={s.retry}>
          <Text style={[type.label, { color: colors.primary }]}>RETRY</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A selectable chip (domain, length, rating). 48dp tall. */
export function Chip({
  label,
  selected,
  onPress,
  dot,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  dot?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  return (
    <View style={[s.chipClip, { opacity: disabled && !selected ? 0.45 : 1 }]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ selected, disabled: !!disabled }}
        android_ripple={{ color: "rgba(168,121,255,0.16)" }}
        style={[s.chip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.muted : "transparent" }]}
      >
        {dot ? <View style={[s.dot, { backgroundColor: dot }]} /> : null}
        <Text style={[type.label, { color: selected ? colors.primary : colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      </Pressable>
    </View>
  );
}

/** The rank glyph: the kit's hexagon emblem, small. Shown once per player; never with a second rank word beside it. */
export function RankMark({ rank, size = 36 }: { rank: string; size?: number }) {
  return <RankEmblem rank={rank} size={size} />;
}

/** type.label carries tracking, so it is only for ALL-CAPS labels; mixed-case headings use bodyStrong. */
function isCaps(label: string): boolean {
  return /[A-Z]/.test(label) && label === label.toUpperCase();
}

const s = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  flex: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { maxHeight: "88%", borderTopWidth: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  head: { flexDirection: "row", alignItems: "center", paddingLeft: space.md, paddingRight: space.xs, paddingTop: space.xs },
  headTitle: { flex: 1 },
  body: { paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.md },
  section: { gap: space.sm, marginTop: space.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 24 },
  group: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  notice: { flexDirection: "row", alignItems: "center", gap: space.sm },
  retry: { minHeight: 48, minWidth: 48, paddingHorizontal: space.sm, alignItems: "center", justifyContent: "center" },
  chipClip: { borderRadius: 4, overflow: "hidden" },
  chip: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.md, borderWidth: 1, borderRadius: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
