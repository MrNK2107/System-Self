import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { type } from "@/constants/type";
import { useTheme } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { TYPEWRITER_MS } from "@/lib/theme/theme";

interface SystemMessageProps {
  message: string;
  animate?: boolean;
  /**
   * Optional caption. Inside a SystemWindow leave it out: the window's bracketed title already names the message.
   */
  label?: string;
}

/** THE SYSTEM's line, typed out at the theme's speed. The block cursor shows only while typing. */
export function SystemMessage({ message, animate = true, label }: SystemMessageProps) {
  const colors = useColors();
  const { uiState } = useTheme();
  const speed = TYPEWRITER_MS[uiState];
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
    }, speed);
    return () => clearInterval(interval);
  }, [message, animate, speed]);

  const typing = animate && displayed.length < message.length;

  return (
    <View style={styles.container} accessible accessibilityLabel={message} accessibilityLiveRegion="polite">
      {label ? <Text style={[type.label, { color: colors.mutedForeground }]}>{label}</Text> : null}
      <Text style={[type.title, { color: colors.foreground }]}>
        {displayed}
        {typing ? <Text style={{ color: colors.primary }}>{"▊"}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
});
