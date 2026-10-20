import { router, Stack } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

export default function NotFoundScreen() {
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ headerShown: false, statusBarStyle: "light" }} />
      <View style={[s.container, { backgroundColor: colors.background }]}>
        <SystemWindow title="NOT FOUND" style={s.window}>
          <Text style={[type.title, s.center, { color: colors.foreground }]}>This screen does not exist.</Text>
          <Button label="Go to Today" block onPress={() => router.replace("/")} style={s.action} />
        </SystemWindow>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg },
  window: { padding: space.lg, gap: space.md, width: "100%", maxWidth: 420 },
  center: { textAlign: "center" },
  action: { marginTop: space.sm },
});
