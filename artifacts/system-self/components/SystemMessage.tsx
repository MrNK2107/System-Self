import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface SystemMessageProps {
  message: string;
  animate?: boolean;
  label?: string;
}

export function SystemMessage({ message, animate = true, label }: SystemMessageProps) {
  const colors = useColors();
  const [displayed, setDisplayed] = useState(animate ? "" : message);

  useEffect(() => {
    if (!animate) {
      setDisplayed(message);
      return;
    }
    setDisplayed("");
    let i = 0;
    const interval = setInterval(() => {
      if (i < message.length) {
        setDisplayed(message.slice(0, i + 1));
        i++;
      } else {
        clearInterval(interval);
      }
    }, 18);
    return () => clearInterval(interval);
  }, [message, animate]);

  return (
    <View style={[styles.container, { borderLeftColor: colors.primary, borderLeftWidth: 1, paddingLeft: 12 }]}>
      {label && (
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      )}
      <Text style={[styles.message, { color: colors.foreground }]}>
        {displayed}
        {animate && displayed.length < message.length && (
          <Text style={{ color: colors.primary }}>▊</Text>
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  label: {
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: "600" as const,
  },
  message: {
    fontSize: 13,
    lineHeight: 20,
    fontStyle: "italic",
  },
});
