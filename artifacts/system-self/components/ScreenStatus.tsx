import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

/** Full-screen placeholder while a screen has no data: the spinner, or one SYSTEM line and Retry once it failed. */
export function ScreenStatus({ failed, message, onRetry }: { failed: boolean; message: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {failed ? (
        <>
          <Text style={[type.title, styles.line, { color: colors.foreground }]}>{message}</Text>
          <Button label="Retry" variant="tonal" onPress={onRetry} style={styles.retry} />
        </>
      ) : (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg, paddingHorizontal: space.xl },
  line: { textAlign: "center" },
  retry: { alignSelf: "center" },
});
