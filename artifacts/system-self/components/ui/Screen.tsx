import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

/** Height of the bottom navigation bar, so tab screens can pad their scroll content. */
export const TAB_BAR_HEIGHT = 80;

interface ScreenProps {
  /** App bar title. Omit for a bare screen. */
  title?: string;
  /** Show a back button in the app bar. */
  back?: boolean;
  /** App bar trailing action (an IconButton). */
  action?: ReactNode;
  /** Inside the tab navigator: pad for the bottom bar. */
  tab?: boolean;
  /** Content scrolls (default) or fills. */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

/**
 * Screen frame: an opaque app bar under the status bar (content never scrolls behind the clock), then the body.
 * Scroll views keep taps while the keyboard is up, so the first tap on a button is never swallowed.
 */
export function Screen({ title, back, action, tab, scroll = true, refreshing, onRefresh, children }: ScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottom = (tab ? TAB_BAR_HEIGHT : 0) + insets.bottom + space.lg;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <View style={[s.bar, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <View style={s.barRow}>
          {back ? <IconButton icon="arrow-left" label="Back" onPress={() => router.back()} /> : <View style={s.barGap} />}
          {title ? (
            <Text style={[type.title, s.barTitle, { color: colors.foreground }]} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
          ) : (
            <View style={s.flex} />
          )}
          {action ?? <View style={s.barGap} />}
        </View>
      </View>
      {scroll ? (
        <ScrollView
          style={s.flex}
          contentContainerStyle={[s.content, { paddingBottom: bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.accentFill]} progressBackgroundColor={colors.card} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[s.flex, { paddingBottom: bottom }]}>{children}</View>
      )}
    </View>
  );
}

/** 48dp icon button with ripple, for app bars. */
export function IconButton({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: "rgba(168,121,255,0.2)", borderless: true, radius: 24 }}
      style={s.icon}
    >
      <Feather name={icon} size={22} color={colors.foreground} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  bar: { zIndex: 1 },
  barRow: { height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs },
  barGap: { width: 48 },
  barTitle: { flex: 1, paddingHorizontal: space.xs },
  icon: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: space.md, paddingTop: space.sm, gap: space.lg },
});
