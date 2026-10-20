// THE SYSTEM's notice window, shared by every notice and modal: a centred SystemWindow with a bracketed title over a
// dark scrim, THE SYSTEM's line typed out, and one filled button. The pieces (NoticeShell, Typewriter, NoticeLine,
// NoticeFigure) are exported so the dedicated modals (rank up, achievement, failure...) speak the same way.
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { setStatusBarStyle } from "expo-status-bar";
import { AccessibilityInfo, Animated, Easing, Modal, ScrollView, StyleSheet, Text, View, type TextStyle } from "react-native";

import { Button } from "@/components/ui/Button";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

/** The background colour at 92% for the scrim behind a notice (falls back to the ink ground). */
export function scrimOf(background: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(background);
  if (!m) return "rgba(7,6,11,0.92)";
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.92)`;
}

/** True when the OS asks for less motion; animations then jump to their end state. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

interface ShellProps {
  visible: boolean;
  /** Header without brackets, e.g. "RANK UP". */
  title: string;
  /** Frame and header colour (destructive for alerts, a domain or rank colour for scoped notices). */
  frameColor?: string;
  /** Android Back and the button both acknowledge. */
  onClose: () => void;
  children: ReactNode;
}

/** Modal frame: scrim, a centred SystemWindow that rises in, scrollable when the content is taller than the screen. */
export function NoticeShell({ visible, title, frameColor, onClose, children }: ShellProps) {
  const colors = useColors();
  const reduce = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(16)).current;

  // Android can hand back dark status-bar icons when a full-screen transparent modal closes; reassert light ones.
  useEffect(() => {
    if (!visible) setStatusBarStyle("light", false);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(reduce ? 1 : 0);
    lift.setValue(reduce ? 0 : 16);
    if (reduce) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(lift, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [visible, reduce, opacity, lift]);

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[s.scrim, { backgroundColor: scrimOf(colors.background), opacity }]}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} bounces={false}>
          <Animated.View style={[s.wrap, { transform: [{ translateY: lift }] }]} accessibilityViewIsModal>
            <SystemWindow title={title} frameColor={frameColor} style={s.window} solid>
              {children}
            </SystemWindow>
          </Animated.View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

/** Types `text` out once (about 1.5 s in total). The untyped rest is laid out invisibly so nothing jumps. */
export function Typewriter({ text, style }: { text: string; style?: TextStyle | TextStyle[] }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduce || !text) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const step = Math.max(12, Math.min(35, 1500 / text.length));
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) clearInterval(iv);
    }, step);
    return () => clearInterval(iv);
  }, [text, reduce]);

  return (
    <Text style={style} accessibilityLabel={text} accessibilityLiveRegion="polite">
      {text.slice(0, shown)}
      <Text style={s.hidden}>{text.slice(shown)}</Text>
    </Text>
  );
}

/** THE SYSTEM's line: title size, centred, typed out. */
export function NoticeLine({ text }: { text: string }) {
  const colors = useColors();
  return <Typewriter text={text} style={[type.title, s.center, { color: colors.foreground }]} />;
}

/** A number THE SYSTEM reports ("+2.5 BODY", "-1.6 DISCIPLINE"), as type.number with a caps unit. */
export function NoticeFigure({ value, unit, color }: { value: string; unit?: string; color?: string }) {
  const colors = useColors();
  const ink = color ?? colors.foreground;
  return (
    <View style={s.figure} accessible accessibilityLabel={unit ? `${value} ${unit}` : value}>
      <Text style={[type.number, { color: ink }]}>{value}</Text>
      {unit ? <Text style={[type.label, { color: ink }]}>{unit}</Text> : null}
    </View>
  );
}

/** Supporting copy under THE SYSTEM's line. */
export function NoticeBody({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={[type.body, s.center, { color: colors.mutedForeground }]}>{children}</Text>;
}

/** The one filled button that closes a notice. */
export function NoticeAction({ label = "Acknowledged", onPress }: { label?: string; onPress: () => void }) {
  return <Button label={label} onPress={onPress} block style={s.action} />;
}

interface Props {
  visible: boolean;
  label: string;
  title: string;
  body: string;
  tone: "alert" | "info";
  onAcknowledge: () => void;
}

/** A plain SYSTEM notice for events without a dedicated modal (chain complete, shadow, demotion, rivals...). */
export function SystemNoticeModal({ visible, label, title, body, tone, onAcknowledge }: Props) {
  const colors = useColors();
  return (
    <NoticeShell visible={visible} title={label} frameColor={tone === "alert" ? colors.destructive : undefined} onClose={onAcknowledge}>
      <NoticeLine text={title} />
      {body ? <NoticeBody>{body}</NoticeBody> : null}
      <NoticeAction onPress={onAcknowledge} />
    </NoticeShell>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space.lg, paddingVertical: space.xxl },
  wrap: { width: "100%", maxWidth: 420, alignSelf: "center" },
  window: { padding: space.lg, gap: space.md },
  center: { textAlign: "center" },
  hidden: { opacity: 0 },
  figure: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: space.sm },
  action: { marginTop: space.sm },
});
