import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GridTexture } from "@/components/GridTexture";
import { NoticeHost } from "@/components/NoticeHost";
import { OfflineBar } from "@/components/OfflineBar";
import { TAB_BAR_HEIGHT } from "@/components/ui/Screen";
import { fonts } from "@/constants/type";
import { useTheme } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { LogSheetProvider, useLogSheet } from "@/hooks/useLogSheet";
import { QuestSchedulerProvider } from "@/hooks/useQuestScheduler";

type IconName = keyof typeof Feather.glyphMap;

/** Material navigation bar item: icon in a pill when active, label always visible. */
function TabIcon({ name, color, focused, label }: { name: IconName; color: string; focused: boolean; label: string }) {
  const colors = useColors();
  return (
    <View style={s.item}>
      <View style={[s.pill, focused && { backgroundColor: colors.muted }]}>
        <Feather name={name} size={22} color={color} />
      </View>
      <Text style={[s.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The centre Log action: a filled accent button that opens the log sheet. */
function LogIcon() {
  const colors = useColors();
  return (
    <View style={s.item}>
      <View style={[s.logButton, { backgroundColor: colors.accentFill }]}>
        <Feather name="plus" size={26} color={colors.primaryForeground} />
      </View>
      <Text style={[s.label, { color: colors.primary }]}>Log</Text>
    </View>
  );
}

function TabsInner() {
  const colors = useColors();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { openLog } = useLogSheet();

  const tab = (name: string, label: string, icon: IconName) => (
    <Tabs.Screen
      name={name}
      options={{
        title: label,
        tabBarAccessibilityLabel: label,
        tabBarIcon: ({ color, focused }) => <TabIcon name={icon} color={color} focused={focused} label={label} />,
      }}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.foreground,
          tabBarInactiveTintColor: colors.mutedForeground,
          tabBarShowLabel: false,
          tabBarStyle: {
            position: "absolute",
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            height: TAB_BAR_HEIGHT + insets.bottom,
            paddingTop: 10,
            elevation: 0,
          },
          tabBarItemStyle: { height: TAB_BAR_HEIGHT - 10 },
        }}
      >
        {tab("index", "Today", "sun")}
        {tab("quests", "Quests", "target")}
        <Tabs.Screen
          name="log"
          options={{
            title: "Log",
            tabBarAccessibilityLabel: "Log something",
            tabBarIcon: () => <LogIcon />,
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              openLog();
            },
          }}
        />
        {tab("arena", "Arena", "shield")}
        {tab("status", "Status", "user")}
      </Tabs>
      {theme.grid && <GridTexture color={theme.accent} />}
      <OfflineBar />
      {/* Server notices (rank changes, achievements, milestones, ...) as System windows, one at a time. */}
      <NoticeHost />
    </View>
  );
}

export default function TabLayout() {
  return (
    <QuestSchedulerProvider>
      <LogSheetProvider>
        <TabsInner />
      </LogSheetProvider>
    </QuestSchedulerProvider>
  );
}

const s = StyleSheet.create({
  item: { alignItems: "center", justifyContent: "center", gap: 4, width: 72 },
  pill: { width: 64, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 0.4 },
  logButton: { width: 48, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
