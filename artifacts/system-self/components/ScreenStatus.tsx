import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";

/** Full-screen placeholder while a screen has no data: the spinner, or one SYSTEM line and RETRY once it failed. */
export function ScreenStatus({ failed, message, onRetry }: { failed: boolean; message: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {failed ? (
        <>
          <Text style={[styles.line, { color: colors.mutedForeground }]}>{message}</Text>
          <TouchableOpacity onPress={onRetry} accessibilityRole="button" style={styles.retryBtn}>
            <Text style={[styles.retryText, { color: colors.primary }]}>RETRY</Text>
          </TouchableOpacity>
        </>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 },
  line: { fontSize: 13, lineHeight: 20, textAlign: "center" },
  retryBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  retryText: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 3 },
});
