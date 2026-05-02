import React, { useEffect, useState } from "react";
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const LINES = [
  "You opened this app for a reason.",
  "We're going to find out if you're serious about it.",
  "Answer honestly.",
  "These answers determine your baseline.",
  "You cannot game this.",
];

export default function OnboardingIntro() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [displayedLines, setDisplayedLines] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState(0);
  const [currentChar, setCurrentChar] = useState(0);
  const [done, setDone] = useState(false);
  const fadeAnim = new Animated.Value(0);

  useEffect(() => {
    if (currentLine >= LINES.length) {
      setDone(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }).start();
      return;
    }

    const line = LINES[currentLine];
    if (currentChar < line.length) {
      const timeout = setTimeout(() => {
        setDisplayedLines(prev => {
          const updated = [...prev];
          updated[currentLine] = line.slice(0, currentChar + 1);
          return updated;
        });
        setCurrentChar(c => c + 1);
      }, 30);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => {
        setCurrentLine(l => l + 1);
        setCurrentChar(0);
      }, 400);
      return () => clearTimeout(timeout);
    }
  }, [currentLine, currentChar]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad + 40, paddingBottom: insets.bottom + 40 }]}>
      <Text style={[styles.tag, { color: colors.mutedForeground }]}>SYSTEM // SELF</Text>

      <View style={styles.textContainer}>
        {displayedLines.map((line, i) => (
          <Text key={i} style={[styles.line, { color: i < displayedLines.length - 1 ? colors.mutedForeground : colors.foreground }]}>
            {line}
            {i === currentLine && currentChar < LINES[i]?.length && (
              <Text style={{ color: colors.primary }}>▊</Text>
            )}
          </Text>
        ))}
      </View>

      {done && (
        <Animated.View style={{ opacity: fadeAnim }}>
          <TouchableOpacity
            style={[styles.btn, { borderColor: colors.primary }]}
            onPress={() => router.push("/onboarding/assessment")}
            activeOpacity={0.8}
          >
            <Text style={[styles.btnText, { color: colors.primary }]}>BEGIN ASSESSMENT</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: "space-between",
  },
  tag: {
    fontSize: 9,
    letterSpacing: 4,
    fontWeight: "600" as const,
  },
  textContainer: {
    flex: 1,
    justifyContent: "center",
    gap: 16,
  },
  line: {
    fontSize: 22,
    lineHeight: 32,
    fontWeight: "400" as const,
  },
  btn: {
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    borderRadius: 2,
  },
  btnText: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
});
