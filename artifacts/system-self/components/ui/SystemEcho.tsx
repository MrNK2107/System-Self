import * as Haptics from "expo-haptics";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { SystemWindow } from "./SystemWindow";

interface Echo {
  /** Window title without brackets, e.g. "QUEST COMPLETE". */
  title: string;
  /** THE SYSTEM's reply, e.g. "+3 DISCIPLINE. Logged." */
  line: string;
}

const EchoContext = createContext<(e: Echo) => void>(() => {});

/** How long an echo stays readable before it fades. */
const HOLD_MS = 2600;
const TYPE_MS = 22;

/**
 * THE SYSTEM answering an action: a window that drops in under the status bar, types its line, and leaves on its own.
 * It never takes a tap (the screen behind stays usable); a newer echo replaces the current one.
 */
export function SystemEchoProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(Echo & { id: number }) | null>(null);
  const seq = useRef(0);
  const echo = useCallback((e: Echo) => {
    seq.current += 1;
    setCurrent({ ...e, id: seq.current });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);
  const value = useMemo(() => echo, [echo]);
  return (
    <EchoContext.Provider value={value}>
      {children}
      {current ? <EchoWindow key={current.id} echo={current} onDone={() => setCurrent((c) => (c?.id === current.id ? null : c))} /> : null}
    </EchoContext.Provider>
  );
}

export function useSystemEcho(): (e: Echo) => void {
  return useContext(EchoContext);
}

function EchoWindow({ echo, onDone }: { echo: Echo; onDone: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(-32)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let typer: ReturnType<typeof setInterval> | undefined;
    let hold: ReturnType<typeof setTimeout> | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      AccessibilityInfo.announceForAccessibility(`${echo.title}. ${echo.line}`);
      if (reduce) {
        y.setValue(0);
        opacity.setValue(1);
        setShown(echo.line.length);
      } else {
        Animated.parallel([
          Animated.timing(y, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]).start();
        let i = 0;
        typer = setInterval(() => {
          i += 1;
          setShown(i);
          if (i >= echo.line.length && typer) clearInterval(typer);
        }, TYPE_MS);
      }
      hold = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: reduce ? 0 : 220, useNativeDriver: true }).start(() => onDone());
      }, HOLD_MS + (reduce ? 0 : echo.line.length * TYPE_MS));
    });
    return () => {
      cancelled = true;
      if (typer) clearInterval(typer);
      if (hold) clearTimeout(hold);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View pointerEvents="none" style={[s.wrap, { top: insets.top + space.sm, opacity, transform: [{ translateY: y }] }]}>
      <SystemWindow title={echo.title} solid>
        <View>
          {/* The full line holds the layout; the typed part is drawn over it so nothing jumps. */}
          <Text style={[type.number, s.center, { color: "transparent" }]}>{echo.line}</Text>
          <Text style={[type.number, s.center, s.overlay, { color: colors.foreground }]}>{echo.line.slice(0, shown)}</Text>
        </View>
      </SystemWindow>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: space.md, right: space.md, zIndex: 100, elevation: 12 },
  center: { textAlign: "center" },
  overlay: { ...StyleSheet.absoluteFillObject },
});
