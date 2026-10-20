import { reloadAppAsync } from "expo";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

/** Shown when a screen crashes: one System line and Restart. Development builds can expand the error details. */
export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [showDetails, setShowDetails] = useState(false);

  const handleRestart = async () => {
    try {
      await reloadAppAsync();
    } catch (restartError) {
      console.error("Failed to restart app:", restartError);
      resetError();
    }
  };

  const details = `Error: ${error.message}${error.stack ? `\n\nStack trace:\n${error.stack}` : ""}`;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[s.container, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}
    >
      <SystemWindow title="SYSTEM ERROR" style={s.window}>
        <Text style={[type.title, s.center, { color: colors.foreground }]}>Something broke. Restart to continue.</Text>
        <Button label="Restart" block onPress={() => void handleRestart()} style={s.action} />
        {__DEV__ ? (
          <Button
            label={showDetails ? "Hide details" : "Error details"}
            variant="text"
            block
            onPress={() => setShowDetails((v) => !v)}
          />
        ) : null}
      </SystemWindow>
      {__DEV__ && showDetails ? (
        <View style={[s.details, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[type.meta, { color: colors.foreground }]} selectable>
            {details}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space.lg, gap: space.md },
  window: { padding: space.lg, gap: space.md, width: "100%", maxWidth: 480, alignSelf: "center" },
  center: { textAlign: "center" },
  action: { marginTop: space.sm },
  details: { borderWidth: 1, borderRadius: 4, padding: space.md },
});
